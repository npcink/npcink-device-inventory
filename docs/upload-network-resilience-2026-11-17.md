# 桌面上传网络错误与有限重试验收（2026-11-17）

## 本次修改文件

- `ele-rs/src/upload.rs`：错误分类、签名刷新、重试预算与上传 fixture。
- `ele-rs/src-tauri/src/lib.rs`：调用进度 Channel、尝试日志、URL 脱敏及测试。
- `ele-rs/src/main.ts`：尝试状态、验证/上传互斥、过期消息隔离与 toast 清理。
- `ele-rs/Cargo.toml`、`ele-rs/Cargo.lock`、`ele-rs/src-tauri/Cargo.lock`：macOS 代理 feature 与已有网络类型依赖。
- `ele-rs/README.md`、`docs/device-upload-troubleshooting-and-operations.md`、`docs/github-release.md`、本文：策略、运维、发布验收与结果。

开始时已有的工作流、打包配置/脚本、README 和后台界面改动均保留；本次未修改 `ele-rs/src-tauri/Cargo.toml`，上传依赖由共享 crate 管理。

## 事实与判断

原 `ele-rs/src/upload.rs` 对 `RequestBuilder::send()` 的任何错误都添加同一句“无法连接站点，请检查网络、地址和 HTTPS 证书：URL”。Tauri 仅显示最外层 `error.to_string()`，因此 DNS、超时、连接拒绝、代理或 TLS 的底层差异在界面中丢失。原代码只有单次请求，没有应用层重试。

M4 曾失败、稍后成功，与暂时性网络异常相容，但没有当时的错误链、HTTP 状态、代理配置和服务端日志，无法确定具体原因。本次没有向真实业务站点上传，也不将问题归因为服务器故障或代理故障。

已有安全合同继续保留：仅 HTTPS、不跟随 3xx、请求最多 2 MiB、响应最多 64 KiB、payload 结构预检、成功响应合同验证、HMAC v2。服务端 ingest 已按 `observation_id` 与原始内容哈希返回原 receipt；同编号不同内容返回 409，因此对同一请求体重发具有幂等基础。

## 错误分类与处理

| 错误 | 自动重试 | 界面建议 |
| --- | --- | --- |
| DNS 明确暂时失败，如 resolver 报 temporary failure/try again | 是 | 核对域名、DNS、网络与代理 |
| 域名不存在、其他未确认暂时性的 DNS 失败 | 否 | 修正地址或联系管理员 |
| 建连或响应读取超时 | 是，但已收到永久 HTTP 状态后不重试 | 检查网络、代理和站点可用性 |
| 连接重置、连接中断、broken pipe、unexpected EOF | 是 | 检查网络稳定性及代理 |
| 连接被拒绝 | 否 | 检查服务、端口、防火墙或代理 |
| TLS 证书或握手错误 | 否 | 核对系统时间、证书链、HTTPS 代理，联系管理员 |
| 代理超时/重置 | 是 | 检查代理运行、端口、认证及代理到站点的连接 |
| 代理拒绝、认证/隧道错误，未确认暂时性的连接错误 | 否 | 先修正网络或代理配置 |
| 3xx | 否，完全不跟随 | 直接配置最终 HTTPS 地址，不向跳转目标转发签名 |
| 401 | 否 | 更新签名版本、校准系统时间，或重新获取授权码 |
| 403 / 404 | 否 | 核对上传权限 / 插件启用与接口地址 |
| 409 | 否 | 核对采集编号冲突、归档资产或设备身份冲突 |
| 413 / 422 | 否 | 核对数据规模、结构和设备身份，重新采集或联系管理员 |
| 429 | 否 | 按有效 Retry-After 等待后人工再试 |
| 502 / 503 / 504 | 是 | 保留 HTTP 状态，检查网关、站点可用性并联系管理员 |
| 500 / 501 / 其他 HTTP 错误 | 否 | 将 HTTP 状态和已知错误码提供给管理员 |
| HTML / 非 JSON | 仅 502/503/504 可按状态重试 | 无法确认结果；核对接口、登录限制、防火墙和代理，不回显内容 |
| 响应超限、非法 UTF-8、成功 JSON 合同不符 | 否 | 核对地址、插件版本及服务器日志 |
| 地址、HTTPS、授权码、本地 payload、设备身份校验失败 | 否，在发送前停止 | 处理原因后再试，不要反复点击上传 |

即使 HTTP 状态是 502/503/504，已知签名、授权、身份、数据校验等业务错误码也禁止自动重试。401/403/404/409/413/429 等状态的响应体读取超时不会覆盖这一规则。

## 次数、时间和签名

- 最多 3 次尝试，即最多 2 次自动重试；成功即停止。
- 第一次退避 400–550ms，第二次 800–950ms，包含 0–150ms jitter。
- 建连上限 8 秒；每次完整请求（含响应读取）最多 15 秒；所有请求与退避共享 45 秒网络预算，末次请求使用剩余时间。采集、payload 编码、客户端初始化和本地日志 I/O 不计入网络预算。
- 有效 `Retry-After` 支持整数秒和 HTTP 日期。503 的退避不得早于该时间；等待超过剩余预算时直接结束。429 不在本轮自动等待/重试，只显示本地格式化后的等待建议。非法值不回显，极大值不会导致溢出或长时间睡眠。
- 每次尝试重新生成 timestamp、32 字符随机 nonce 和 HMAC。服务端 timestamp 使用秒精度，快速重试采用 `max(当前秒, 上次秒+1)`；正常时钟下最多提前两秒，仍在服务端 ±300 秒窗口内。
- 请求体只编码一次，采集编号、采集事实、上传时间字段和 body hash 在重试间保持一致。禁用 reqwest 默认的协议级透明重试，避免隐藏重发复用 nonce。

Tauri 继续在 `spawn_blocking` 中执行阻塞 HTTP 与退避，不占用界面线程。没有新增关闭/退出拦截；现有客户端没有上传取消按钮。窗口消失后 IPC 发送失败被忽略，剩余工作仍受网络预算约束。本次没有把“关闭窗口”定义为撤销已经送达服务端的请求。

上传和连接验证通过各自调用的 IPC Channel 显示“第几次尝试”及“正在重试”。两种操作互斥；完成后使旧 channel 消息失效。上传成功清除过程 toast，只展示正常成功结果；最终失败给出当前尝试次数与操作建议。

## macOS 系统代理证据与依赖

锁文件中的上传 reqwest 为 0.12.28。原配置 `default-features = false`，仅开启 blocking/json/rustls-tls；其默认 features 中的 `system-proxy` 因而没有启用。核对 reqwest 的 `proxy.rs` 与 hyper-util 0.1.20 的 `client/proxy/matcher.rs` 后确认：原上传客户端读取环境代理，但不会读取 macOS 系统手动 HTTP(S) 代理。

现在仅在 `cfg(target_os = "macos")` 上开启 reqwest 内置 `system-proxy`，使用 macOS SystemConfiguration。环境 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 及 NO_PROXY 规则继续由现有 matcher 处理；每轮操作重建客户端，下一轮即可读取代理变化。HTTPS 限制、证书验证和签名合同均未放宽。

直接使用已在 reqwest 依赖树中的 hyper-util 做代理路由诊断，使用已有 rustls 类型识别证书/握手错误，没有新增另一套网络栈。新增传递包主要为 system-configuration 0.7.0、system-configuration-sys 0.6.0，以及锁文件需要覆盖的平台包；共享库锁文件还增加 core-foundation 0.9.4。两个 lockfile 均已更新，未升级现有网络依赖版本。

`cargo tree --locked -e features -i hyper-util --target x86_64-pc-windows-msvc` 与 Linux 对应命令均确认没有 client-proxy-system feature；Windows/Linux 上传仍采用原环境代理策略。锁文件包含 windows-registry 不代表 Windows 构建开启了系统代理。

当前上游实现只读取 macOS 手动 HTTP(S) 代理，不执行 PAC，不读取系统 SOCKS 与系统例外列表；绕过规则使用 NO_PROXY。系统代理设置和环境代理在请求发起瞬间变化时，诊断 matcher 与客户端读取的快照可能不同。代理路由超时也无法仅凭客户端判断故障在代理本身还是上游站点，因此提示同时要求检查两段连接。

## 日志与远端输入安全

桌面 `upload.attempt` 记录 category、http_status、attempt、retries、elapsed_ms、retry_delay_ms。elapsed_ms 是本轮累计耗时。站点仅保留 scheme/host/port；删除 userinfo、路径、query、fragment，非法地址只记 invalid。

不记录 token、secret、完整签名、代理 URL/认证信息、响应体、远端 message/堆栈或原始硬件。签名相关请求头标记 sensitive。网络源错误只在内存中用于分类，不拼入提示或日志。远端 code 只有命中本地已知列表才展示；不再将任意 64 字节合法字符串视为可展示机器码。本地 payload 错误也不再反射可能含硬件数据或凭据的对象键路径。

## 验证结果

2026-11-17 在本机 Apple Silicon/macOS 执行：

| 检查 | 结果 |
| --- | --- |
| ele-rs：cargo fmt --check | 通过 |
| ele-rs：cargo clippy --locked --all-targets -- -D warnings | 通过 |
| ele-rs：cargo test --locked | 74 项通过，其中上传测试 23 项 |
| ele-rs/src-tauri：同样三项 Rust 检查 | 全部通过，13 项测试通过 |
| ele-rs：npm run build | TypeScript 与 Vite 构建通过，最终 bundle 构建也再次执行此检查 |
| npm run tauri:build:macos | app、DMG 构建通过，目标 aarch64-apple-darwin |
| npm run check:macos-bundle -- 指向本次 DMG | 镜像 checksum、版本/identifier、arm64、资源封装与完整包签名通过 |
| git diff --check | 通过 |

fixture 使用合成数据，不使用真实授权码或硬件。覆盖暂时性错误有限重试、503 后成功、502/503/504 耗尽、真实请求与响应读取超时、共享总预算、每次请求的新 timestamp/nonce/有效 HMAC、相同 body、3xx 不跟随、401/403/404/409/413/429 等不重试、业务码否决重试、Retry-After 超预算、代理端口不可达、真实保留域名解析失败、TLS 类型分类、HTML/token/签名不泄漏、响应超限及成功上传/连接验证合同。原采集、身份与 payload 回归一并通过。

本地 fixture 的接受 socket 已显式设回阻塞模式，避免 macOS 非阻塞 listener 接受连接后偶发 WouldBlock 造成测试误报。

本次 DMG：`ele-rs/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Npcink Device Agent_0.4.6_aarch64.dmg`，SHA-256 `ae4e383027086ac8acc42d071316f70c54613a4b67f025bc485cc0eaf6fef747`。采用现有 ad-hoc 签名，没有 Developer ID/公证；Gatekeeper 实际判定 rejected，不能把包完整性校验通过写成 Apple 信任通过。构建还报告已有 STATIC_VCRUNTIME 配置弃用提示，本次未改动打包策略。

## 尚未验证的范围

- 原 M4 故障没有复现，不能补写其真实根因。
- DNS 错误缺乏统一跨平台类型，采用已知 resolver 文本加结构化错误链分类；未知错误保守停止，不保证识别所有系统语言和 resolver 实现。
- 没有改动本机系统代理配置做真实代理切换验收，没有在真实 HTTPS 业务站点发送数据，没有完整桌面 GUI 交互/退出实测。
- 未进行 Windows/Linux 目标编译或实机运行；这里只核对其依赖 feature 树与共用代码。
- 未发布、安装或替换现有客户端；新版本制品仍按正式候选发布流程验收。

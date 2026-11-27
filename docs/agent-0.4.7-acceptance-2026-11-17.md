# Agent 0.4.7 验收候选准备（2026-11-17）

## 当前状态

插件候选保持 3.2.4，桌面版本从内部预览 0.4.6 递增到 0.4.7，避免不同字节继续共用同一客户端版本。版本准备提交为 `3b55a64ac3fd8fdfd0a03fa3b5d339d776b39895`，工作分支为 `codex/agent-047-acceptance`。本记录不将 preview 构建认定为正式签名候选或实机安装验收。

本轮在独立 worktree 准备版本，未改写主工作区正在收尾的文档。此前后台修正、冗余清理、依赖修复和 macOS CI 签名检查均已分别提交，包含在版本准备提交的祖先历史中。

本轮开发收尾状态：上传实现、Rust / 前端检查、0.4.7 双平台 preview 和 M4 Docker 后端链路验收完成；正式发布保持 hold，剩余安装版、系统代理、Windows 与正式签名制品验收见本文下方清单。收尾复核时远端 preview 为 success，专用 Docker 容器和数据卷均已清理。

`codex/agent-047-acceptance` 已推送，但尚未合入 `master`；该分支还包含此前其他已提交工作的历史，集成时需按完整差异审查并运行受影响检查，再冻结正式候选源。自动更新的旧正式 GUI 实测须在既有 draft 发布后、工作设备推广前完成，不能提前记为通过。

## 已完成的本地验证

执行主机是 Apple M5、macOS 27.0.1，不是原故障发生的 M4。`/Applications` 中未找到已安装的 Device Agent，未执行覆盖安装，不把本机合成验收计作 M4 安装或退出实测。

| 项目 | 结果 |
| --- | --- |
| Node / Tauri / 两套 Cargo 与锁文件版本合同 | 全部为 0.4.7，插件保持 3.2.4，通过 |
| 两个 Rust crate 的 fmt / 严格 all-target Clippy | 通过 |
| Rust 测试 | 共享库 74 项、桌面 13 项全部通过 |
| 前端 TypeScript / Vite 构建 | 通过 |
| 干净 npm ci 与 npm audit | 通过，0 漏洞 |
| arm64 App / DMG 构建 | 通过 |
| DMG、版本、identifier、arm64、完整资源签名检查 | 通过 |
| Gatekeeper / 公证 | ad-hoc 签名；Gatekeeper rejected；未公证 |

浏览器验收通过 Playwright 驱动实际前端和 Tauri JS Channel，后端 IPC 使用合成 fixture，没有访问业务站点或系统密钥链。验收包括：重试状态可见、等待时切换技术详情仍响应、上传与验证互斥、成功清除过程 toast、最终 401 显示尝试次数及不要重复重试建议、错误后控件恢复、旧调用迟到消息不能覆盖新调用或成功结果。浏览器控制台仅出现 favicon 404，没有应用异常。

浏览器测试基于 27463fa 的前端；已逐字节核对其 `src/main.ts` 与 0.4.7 候选相同。合成数据中显示的 Synthetic M4 是 fixture 文本，不代表执行主机型号。

另用真实本地 HTTPS 服务和自签名证书调用生产 `verify_connection_with_progress`：客户端在约 16ms 内返回 TLS 分类，只发起 1 次尝试、无自动重试；TLS 服务统计 1 次连接、1 次证书握手拒绝、0 次 HTTP 请求。仅使用合成 token，没有发送真实硬件或授权信息。没有关闭证书校验。

合成浏览器截图、IPC fixture、TLS 日志和服务端计数保存在 `.local-backups/agent-047-acceptance-20261117/`。前端浏览器验收不替代 Tauri 原生窗口关闭、系统代理切换或真实 HTTPS 业务上传。

## M4 原生安装、启动与正常退出

按用户后续选择，本阶段仅执行无需桌面操作的安装、启动和退出检查，不建立外部测试隧道，GUI 交互稍后验收。M4 控制台为登录但锁屏状态；远程 UI 脚本查询超时，未更改自动化权限或解锁设置，也未据此推断权限被拒绝。

将原 CI DMG 复制到 M4 并再次核对 SHA256 `4554a5987074534c7a7e8ec94d36b89fc8e75c0fe246090832fffd76581a6cb4`，只读挂载后安装到 `/Users/muze/Applications/Npcink Device Agent.app`。安装前没有同名应用、配置文件或对应上传凭据；没有覆盖既有安装或授权。

| 检查 | 结果与范围 |
| --- | --- |
| 已安装 App 的版本 / identifier / 完整签名 | 0.4.7 / ink.npc.npcink-device-agent / 完整签名验证通过 |
| Gatekeeper / quarantine | Gatekeeper 拒绝；包未带 quarantine 属性；未删除属性或修改安全策略，仍不代表 Developer ID 信任或公证 |
| Launch Services 启动 | `open -n -a` 返回 0，原生进程实际运行 |
| 前端启动后的真实采集 | 原生 IPC 生成 macos、collector 0.4.7、schema npcink-hardware-inventory-v3 的快照，身份就绪；只记录结论，未复制原始快照 |
| 正常退出 | 发送 macOS quit AppleEvent 返回 0，退出后客户端进程不存在；没有强制终止 |
| 配置与上传 | 未导入站点或 token；验收后配置文件仍不存在，对应 Keychain 项仍不存在；未执行上传 |

正常退出发生在空闲采集完成后，不计作菜单/窗口交互或重试期间退出通过。界面渲染、toast、关闭按钮、系统代理和可信 HTTPS 上传均保持 pending。已安装 App 留在 M4 供后续 GUI 验收；应用正常生成的本地缓存与日志留在 M4，没有导出共享。

脱敏证据位于 `.local-backups/m4-native-acceptance-20261117/`，另打包为 `release-preview/agent-0.4.7-20261117/m4-native-startup-evidence-20261117.tar.gz`，SHA256 `c9707fd8fb58b02cdb31a3091e5adc72c3bf1b2d1bafdefacbd523e7eba74470`。该证据包仅含安装、启动、退出与最终状态 JSON 及校验和，不含硬件明细或凭据。

## 本地安装包

目录：`release-preview/agent-0.4.7-20261117/`。

- DMG：`Npcink Device Agent_0.4.7_aarch64.dmg`。
- SHA256：`971d7c44dede874412d39137cb2d2dc3c6240511f7a0aebc10ea555387e48712`。
- `local-build.json` 记录版本、源提交、执行主机与签名判定，`SHA256SUMS` 对应安装包原始字节。
- 本地包与 CI 包分别验收和记录哈希，不能认为两个构建字节相同。

## 远端构建

0.4.7 双平台 preview：[run 44059661608](https://github.com/npcink/npcink-device-inventory/actions/runs/44059661608)，源提交 `3b55a64`。macOS 构建成功，下载后独立检查 DMG 校验和、0.4.7 版本、identifier、arm64 和完整 App 资源签名全部通过。签名为 ad-hoc，Gatekeeper rejected，未公证。Windows 的 Rust / Tauri / 前端检查、NSIS 安装包构建和无上传采集 smoke 全部成功；整轮 preview 为 success。插件任务本轮按 desktop 参数跳过。

CI macOS DMG 的 SHA256 为 `4554a5987074534c7a7e8ec94d36b89fc8e75c0fe246090832fffd76581a6cb4`，保存于 `release-preview/agent-0.4.7-20261117/ci-macos/`。与本地构建哈希不同，两者独立记录。

CI Windows 安装包 `Npcink Device Agent_0.4.7_x64-setup.exe` 的 SHA256 为 `1213de7dbe197d64263bd3aae75d74a3e2bfae5a1085550061214495ff23814b`，下载后检查 PE 文件头有效，保存于 `release-preview/agent-0.4.7-20261117/ci-windows/`。未在本机执行 Windows 安装包，也未据此确认平台签名。

Windows smoke 报告为 `source-cli-smoke`，在管理员身份的 GitHub Windows runner 上完成：hardware.inspect、hardware.upload-inspect、device-id 通过，采集耗时 9320ms，查询状态 ok 27 项、empty 4 项。明确跳过 upload.submit 和 diagnostics；报告中的 installation_verified、update_verified、platform_signing_verified 均为 false。因此该成功结果不代替普通用户权限、真实业务上传、覆盖安装或签名验收。

前置 0.4.6 基线：全平台 run 44056324930 的 WordPress / macOS 成功；Windows 最初因本地拒绝连接返回慢于 fixture 的 1 秒预算而失败，27463fa 将该测试预算调为 5 秒，Windows 重跑 [44057127865](https://github.com/npcink/npcink-device-inventory/actions/runs/44057127865) 成功。这是测试预算修正，没有改变生产重试策略。0.4.6 的结果不能替代 0.4.7 制品验收。

本机直接到 github.com:443 的 Git 推送建连失败，GitHub API 可访问。本机已有系统 HTTP(S) 代理；仅对该次 git push 使用现有系统 HTTPS 代理后成功，未修改系统或 Git 全局配置。此证据只描述 M5 上的 Git 网络路径，不证明原 M4 上传偶发故障原因。

## 实机验收与正式候选的剩余条件

| 验收项 | 当前状态 | 完成证据 |
| --- | --- | --- |
| 原 M4 直连与手动系统 HTTPS 代理上传 | M4 Docker 直连探针已通过；安装版及系统代理待执行 | 客户端版本、脱敏尝试日志、服务器 receipt 与原资产归属 |
| 暂时断网后恢复、重试成功、无重复观测 | M4 原生探针到 Docker 后端已覆盖；安装版待执行 | 一次稳定采集编号、多次新签名、最终同一 receipt |
| 认证失败不重试、成功无残留失败提示 | M4 后端真实 401、Rust / 浏览器已覆盖；原生 GUI 待执行 | 原生 GUI 操作记录与脱敏日志 |
| 重试期间关闭原生窗口 / 退出 | M4 空闲正常退出已通过；重试期间与窗口交互待执行 | 实际关闭行为与无残留客户端进程 |
| Windows 普通用户 / 管理员采集、覆盖安装与配置保留 | 待 Windows 设备 | 安装前后版本、配置 / 授权保留、重采与 HTTPS receipt |
| 正式 updater 签名与 manifest / candidate.json / 校验和 | 待实机与候选冻结后 | 按 github-release.md 验收同一批字节 |

用户已明确本阶段先完成本地验收和候选准备，实机环境稍后提供。

设备和站点就绪后按[实机验收执行与交接](agent-0.4.7-real-device-handoff.md)逐项操作并记录；该清单已准备，不表示实机项目已执行。

后续已在 M4 自建隔离 Docker 站点，完成真实采集、后端写入、重试幂等及故障注入，见[M4 Docker 验收记录](m4-docker-upload-acceptance-2026-11-17.md)。成功链路使用探针专用临时 CA 和回环直连，不代替原样发布包的可信 HTTPS、GUI 或系统代理验收。

隔离 HTTPS 站点需安装配套 3.2.4 插件，并单独导入测试授权码；不能在现有工作台账里随意造资产，也不要求在聊天中发送 secret。未创建 tag、正式 Release 或更新公开 updater 清单。

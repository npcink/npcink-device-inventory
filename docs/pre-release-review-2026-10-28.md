# Windows 实机与发布前复查（2026-10-28）

后续落实状态见 [候选准备与验证记录](release-candidate-preparation-2026-10-28.md)。下文保留复查时的发现，不代表后续修复尚未实施。

## 结论与范围

可以开始 Windows 采集预验收；当前还不能判定正式发布就绪。已确认的问题集中在候选版本、制品一致性、烟测可靠性和签名更新的发布流程。本轮没有获得新的 Windows 实机证据，也没有确认新的内存、显存采集实现故障。

复查基于本地工作区；HEAD 为 `43563d03acd28922b2f4ef6f83a47162390c519b`，存在大量未提交及未跟踪源码，因此 HEAD 不代表本次完整候选。没有提交、推送、打标签、运行远端 CI 或发布，也没有向 `device.local` 写入测试数据。本轮仅新增这份复查记录及文档索引，未修改运行代码、版本或发布 ZIP。

## 发布前必须处理

| 优先级 | 已确认的问题 | 影响与处理要求 |
| --- | --- | --- |
| 高 | 插件仍为 3.2.3，Agent 仍为 0.4.4；两者已正式发布 | GitHub `v3.2.3` 于 2026-09-17 发布，资产含 Agent 0.4.4。为两端选择递增版本，例如 3.2.4 / 0.4.5；同步插件头、Stable tag、Node/Cargo/Tauri 及锁文件。现有版本门禁只验证内部一致，不能证明版本未发布过或可升级 |
| 高 | 当前发布 ZIP 与工作区构建不一致 | 35 个当前 dist 文件中，3 个新 chunk 缺失，入口和 manifest 不同；`check:package` 通过仅代表结构和规则合格。冻结源码后重新构建，执行完整门禁和隔离 Docker 验收，以最终 SHA-256 标记候选；不得直接使用现有 ZIP 验收或发布 |
| 高 | tag 工作流没有实机验收后再正式发布的环节 | `.github/workflows/release.yml` 会直接 `gh release create`，已有 Release 则 `--clobber`。preview 不生成 updater 签名制品。需要在正式发布前提供最终签名候选制品和人工放行环节，例如独立候选构建或 draft 流程；发布时复用验过的字节，禁止覆盖已有正式版本 |
| 高 | 签名 v2 是两端配套升级要求 | 新插件不回退旧签名，旧 Agent 的上传会被拒绝。发布说明必须写明升级顺序、失败提示及恢复办法；现有授权码无需重发。本次包含客户端功能变化，不能采用纯插件发布并沿用旧 Agent 的策略 |
| 验收必需 | 尚无本轮 Windows 安装包、更新签名和实机升级证据 | 源码 CLI 成功不代表 NSIS、WebView2、Credential Manager、GUI 或 updater 成功。需要对本轮最终 exe、`.sig`、manifest 和哈希验签，并完成上一正式版本 → 新版的安装更新验收 |

ZIP 对比证据：本轮检查时 `release/npcink-device-inventory.zip` 的 SHA-256 为 `dad0c3bbb670c0e44f8026af0e0cc99a11fadc7b20917ace4abd40f7df69176d`。缺少 `AnalysisWorkspace-EeWLdnLy.js`、`AssetWorkspace-ANCHrlje.js`、`DetailDrawer-DwGFPsoR.js`；`index.js` 和 `.vite/manifest.json` 字节不同。该哈希仅记录被检查的旧包，不是候选验收通过标识。

## Windows 验收工具的遗漏

证据来自 `ele-rs/scripts/windows-smoke-test.ps1` 和同名 BAT。以下静态事实与平台风险分开记录，不把未经 Windows 执行的风险写成已复现故障。

| 类型 | 发现 | 建议 |
| --- | --- | --- |
| 确定漏检 | `-OpenDev` 启动 `npm run tauri:dev` 后不检查退出码，随后可写入 `summary.status = passed` | 把启动失败记为失败；手工窗口验收单独记录，不由 CLI 总状态替代 |
| 确定覆盖缺口 | 上传、诊断可跳过，报告仍可 passed；该脚本主要执行 `cargo run` | 报告必须同时检查各步骤和 skipped，不能把总状态视作全链路通过；最终安装包另验 |
| 确定证据缺口 | 耗时/字节数正则未匹配不会失败 | 性能验收要求这两项必填，区分采集耗时、Cargo/进程墙钟耗时和实际 HTTP 大小 |
| 待 Windows 验证 | `$ErrorActionPreference = Stop` 与原生命令 stderr 重定向混用；`upload-inspect` 正常会向 stderr 写指标，Cargo 也使用 stderr | 在 Windows PowerShell 5.1 验证是否触发 NativeCommandError，按原生退出码判断执行失败并可靠保存两条流 |
| 待 Windows 验证 | 未明确设置原生输出 UTF-8 解码，PowerShell 5.1 的重定向不是原始 stdout 字节复制 | 用中文品牌、路径和设备名核对 JSON及日志，防止采集正确而烟测报告乱码 |
| 确定保护缺口 | 外部命令没有统一墙钟超时，诊断探针较多 | 为命令增加超时、失败状态及进程树清理；先跳过扩展诊断，单独测核心采集预算和超时后的残留子进程 |
| 确定权限偏差 | BAT 会主动 UAC 提权 | 普通用户首轮直接执行 PS1；管理员第二轮对照。BAT 成功不能代表普通用户成功 |

普通用户在 `ele-rs` 目录首轮可运行下面的源码预验收，保留各 JSON、stderr 及 summary；这不等于安装包验收。当前脚本的 PowerShell 5.1 兼容风险尚未解除，脚本失败时应先区分采集器和脚本原因。

```powershell
.\scripts\windows-smoke-test.ps1 -SkipSubmit -SkipDiagnostics
```

现有 `check:desktop-update-transition` 使用 macOS `.app` 和 PlistBuddy，只覆盖 macOS 预检，不覆盖 Windows 升级路径。

## 签名、站点及数据保护

- Tauri updater 签名验证更新包来源，不等同 Windows Authenticode 或 Apple Developer ID 签名/公证。当前 Windows NSIS 没有配置 Authenticode；内部信任环境测试与正式外部分发应分别记录验收结论。
- GitHub 已有 updater 私钥 secret 名称，但这不能证明其值有效或与当前公钥匹配；以最终产物的实际验签为准，不读取或输出私钥。
- Rust 客户端强制 HTTPS 且不跟随重定向。`http://device.local/` 不能用于新版客户端上传验收。准备独立 HTTPS 验收站点、可信证书、最终无跳转 URL 和独立测试授权码；继续不向 `device.local` 写入测试数据。
- 历史兼容清理已获授权，但仍需验证实际升级和恢复：在隔离环境使用本人上一正式版本的数据副本，核对资产、身份、最新观测指针、财务值、归档和设置。按 ADR-017，同版本 3.2.3 备份可恢复当前数据，停用 v1 身份会提示并跳过；其他旧结构不保证直接导入。正式升级前保留完整数据库和旧插件/安装包，回退演练不能只依赖新版导出。

## 实机验收建议顺序

1. **准备候选。** 修正烟测和候选发布环节，确定两端新版本，冻结并记录候选 commit。后续源码有改动就生成新候选，不能沿用旧哈希的通过结论。
2. **采集预验收。** 普通用户 / 管理员各一轮；核对真实内存条数、容量、品牌、料号及速度单位，已确认 8GiB 的独显，多卡歧义、物理盘与卷关系、健康读取权限及 partial 状态。记录冷采集、缓存读取、partial 60秒后重试、子进程回收、中文路径和大外设列表。详细矩阵见 [Windows 采集清单](windows-collection-acceptance-2026-10-27.md)。
3. **隔离联验。** 运行本地 `check:release` 与独立 Docker 门禁；新采集 → 签名 v2 上传 → 库存详情 → 导出/恢复逐值核对。测试幂等重试、旧签名拒绝、nonce重放、归档/身份冲突、TLS错误和离线失败。不要公开包含设备标识的原始报告。
4. **最终安装包。** 在干净 Windows 上安装候选 exe，检查 WebView2 依赖、中文路径、普通用户启动、配置和授权码保存、采集上传及日志导出。覆盖首次安装、覆盖安装和卸载时约定的数据保留行为。
5. **正式版本升级。** 从已发布 Agent 0.4.4 升到候选新版；验证设置页和菜单更新入口、版本递增、下载/验签/安装/重启、配置及凭据保留、失败提示和恢复办法。先在候选更新环境验证，不能提前切换现有用户的正式 latest 入口。
6. **放行。** 远端质量/Windows构建通过；候选所有阻塞项关闭，记录最终 commit、exe/ZIP/signature/manifest 的哈希及实机结果，再发布已验过的制品。WordPress.org 提交必须复用 Docker 测过的同一 ZIP，不在验收后再次无记录重建。

## 本轮验证与证据边界

| 检查 | 本轮结果 |
| --- | --- |
| 版本契约、发布范围、Actions runtime | 通过；不代表版本可复用或远端 workflow 已运行 |
| 发布包结构 / WordPress.org 静态规则 | 通过；另外的逐字节对比确认该包陈旧 |
| 桌面前端生产构建、两 crate fmt/Clippy | 通过（本机 macOS） |
| Rust 单元测试 | 采集器63项、桌面14项通过；没有在 Windows 执行 |
| `npm run check:fixtures` | 完整通过：备份恢复、搜索/写入、上传边界、当前schema、身份/占用/事务、Windows身份探针自检、生命周期及观测仓库；均为本地夹具，不向验收站点上传 |
| `git diff --check` | 通过 |
| 两个 Node 项目的 npm audit、Composer locked audit | 通过，未报告相应安全漏洞 |
| Collector cargo audit | 通过 |
| Desktop cargo audit | 首次因 RustSec 网络错误中断，单独联网重试通过；数据库加载1380条 advisory，仍报告5条 allowed warnings，未添加忽略规则 |

5条 Rust 提示为 `proc-macro-error`、`zbus_names`、`zvariant`、`zvariant_derive` 的 unmaintained 和 `glib` 的 unsound（RUSTSEC-2024-0429）。用 `cargo tree --locked --target x86_64-pc-windows-msvc` 反查这5个包未得到活动依赖链；不能据此宣称所有目标零风险。当前重点是保留上游风险记录和追踪 Tauri/Linux 依赖升级，不为本次 Windows 验收仓促大改依赖。

先前本地只读验收覆盖180台存量电脑、32,240行详情及数据库→REST逐值一致，见 [本地验收记录](local-acceptance-2026-10-27.md)。这些旧快照中没有新 DXGI 来源、速度单位和查询级诊断，不能用于替代新版采集实机验证。

## 发布文档需同步的内容

- `github-release.md`：制品数量、preview 实际 fmt/Clippy/test、schema与签名版本区分、tag示例、后台源码随包规则，以及 E2E 会写入资产/令牌，必须使用隔离站点。
- `release-readiness-checklist.md`：旧本地域名、已删除迁移夹具的描述、Windows升级覆盖、平台签名区别及配套升级要求；末尾“再次 build:submission”与前文“Docker后不重建同一制品”矛盾，应统一。
- `release-candidate-verification-template.md`：增加 exe/ZIP/manifest SHA-256、普通/管理员权限、WebView2、凭据保留、升级失败恢复及候选正式放行记录。
- `README.txt`：新版本变更记录应明确签名v2和客户端配套要求，修正既有3.2.3记录中 Agent版本与正式0.4.4资产不一致的表述。
- `ADR-017` 中数据库修订标识仍写 `20261027_current_model`，运行代码已是 `20261027_observation_receipts`，需同步文档。

这些文档和工具问题本轮登记为待处理，不以审查报告代替修复或实机通过结论。

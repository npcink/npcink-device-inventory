# 发布候选准备与验证（2026-10-28）

> 这是用户授权Docker和测试分支构建之前的阶段记录。后续Docker、联网完整门禁和Windows构建进展见[Windows测试包与隔离验收记录](windows-preview-build-2026-10-28.md)；当前插件ZIP哈希以该后续记录为准。

## 当前结论

发布前复查中可在本地落实的版本、验收工具、候选流程和文档问题已处理，插件本地候选包已重建。现在可以安排 Windows 实机预验收；不能标记正式发布通过。Windows实机、最终exe/平台签名、远端CI和本轮候选的真实WordPress/MariaDB验收均尚未完成。

工作区原有未提交改动全部保留，本轮不提交、不推送、不创建tag或远端Release，不向device.local写入测试数据。插件ZIP是本地预验收制品，不是已冻结commit对应的远端正式候选。

## 已落实

| 复查问题 | 处理结果 |
| --- | --- |
| 已发布版本号复用 | 插件统一为3.2.4，Agent Node/Tauri/Cargo及锁文件统一为0.4.5；版本门禁补充锁文件自有包一致性。tag流程读取最近正式Release，检查版本严格递增且拒绝任何已有draft/正式版本；只读核对v3.2.3 → v3.2.4基线通过 |
| 旧ZIP | 重新构建当前源码；35个dist文件、插件头和README逐字节与包内一致。结构/WordPress.org静态规则通过，共155项 |
| 烟测stderr与编码 | Node无shell执行原生程序，凭据通过stdin交给执行层且不记录命令参数；stdout/stderr分别按原始字节保存。JSON读取显式UTF-8，npm shim通过编码PowerShell命令调用 |
| 漏检与挂起 | 命令超时、Windows taskkill进程树清理、输出上限与清理等待上限；构建和采集分别计时。缺少elapsed/bytes指标失败；OpenDev检查退出码；未指定SkipSubmit时必须提供HTTPS站点/授权码 |
| 误解总状态 | 报告schema v2、scope为source-cli-smoke；completed只表示所请求步骤结束，另列skipped/optional失败/manual，安装/更新/平台签名始终待单独验证；BAT不主动提权，记录实际管理员权限 |
| 直接公开发布/覆盖制品 | tag只创建draft，无clobber；candidate.json记录tag/commit/版本/scope/原构建run_id。下载核对完整文件集合及校验和，按公钥验证updater签名；原构建另保留90天独立证明，公开发布后对照原证明，防止替换制品及其校验和后自洽通过 |
| 实机验收接入 | 质量workflow增加Windows PowerShell5.1/7包装层回归与原生进程树测试；未运行远端，只验证流程定义 |
| 文档过期 | 同步发布流程、验收模板、Windows清单、Agent说明、签名v2升级说明及ADR-017修订号；增加ADR-018。E2E原错误检查schema4，修正为schema5；仅在隔离HTTPS站点执行 |

## 本地制品

- 文件：`release/npcink-device-inventory.zip`
- 插件版本：3.2.4
- SHA-256：`694d64683acba8393c2f1acee4590b8d0e910c046f40f9b3767b9a368194d23e`
- 当前后台构建共35个文件逐字节匹配。该哈希未经过本轮Docker验收；后续重建必须记录新哈希并验证，不继承本次结论。
- 本机没有本轮Windows exe或`.sig`。草稿流程、候选元数据与独立证明仅完成本地代码和模拟传输验证，没有真实远端执行结果。

## 本轮检查证据

| 检查 | 结果 |
| --- | --- |
| 发布工具回归 | 8项通过：UTF-8/stderr与参数边界、退出码/启动失败、超时及后代进程、校验和安全/完整性、候选草稿/公开下载源commit绑定、替换制品且重算校验和仍拒绝、双端版本递增与纯插件策略 |
| PowerShell脚本 | 用临时便携PowerShell7.6.9在macOS完成3个PS1语法解析和包装层回归；Windows npm shim明确跳过。不代表PowerShell5.1、CIM、DXGI或taskkill已实测 |
| GitHub Actions定义 | actionlint1.7.12检查release、quality、preview、verify-published-release四份流程通过；runtime检查通过。没有触发远端工作流 |
| 插件/管理端 | 完整PHP fixtures、PHPStan、PHPCS、管理端lint/TypeScript/生产构建、硬件/分页fixture、包体预算通过 |
| 桌面 | 前端构建、两个crate的fmt/Clippy、采集器63项及桌面14项测试通过（macOS） |
| 版本/包 | 版本一致性、只读正式基线检查、包结构/WordPress.org静态规则、35个dist逐字节对比、git diff --check通过 |
| Rust安全审计 | 完整release门禁在联网刷新RustSec时中断；独立重试及git fetch也遇网络错误。随后两份lockfile用已有近期数据库执行no-fetch审计通过；桌面仍5条上游unmaintained/unsound提示，没有加ignore。数据库commit为99670cfc0bc574433034b75876a4b791ccaa2efb（提交日期2026-10-27），不能把它写成最新联网门禁通过 |
| 隔离Docker | docker CLI存在，但当前desktop-linux daemon socket不可用，也未发现可启动的Docker/OrbStack/Colima运行时。本轮无法运行真实数据库与Plugin Check，不以夹具替代 |

`npm run check:release`没有整体通过：其此前代码门均通过，在RustSec联网处停止。后续ZIP/逐字节/空白检查已单独执行并通过；仍需网络恢复后重跑完整门禁。两个crate审计现在顺序使用同一份数据库：先强制正常联网刷新，成功后第二份lockfile使用no-fetch，避免重复拉取；不自动离线回退或允许过期数据库。

临时测试工具位于`/tmp`，下载后按官方SHA-256验证；没有安装到系统路径或加入项目依赖。包装层测试使用合成字符串，不采集本机或Windows真实资产。E2E只完成bash语法检查，未向站点执行写入。

## 下一步按顺序执行

1. Windows普通用户先在`ele-rs`运行`.\scripts\windows-smoke-test.ps1 -SkipSubmit -SkipDiagnostics`，再用管理员权限对照；审阅coverage及每个查询状态，按[Windows清单](windows-collection-acceptance-2026-10-27.md)核对真实内存、8GiB显存、存储关系和耗时。
2. 网络和Docker环境可用时跑完整release与独立Docker门；验证本人上一正式版数据库副本的升级/恢复、签名v2配套上传及实际详情。设备原始报告和授权码不上传公开CI。
3. 确认源码后冻结commit；按[发布流程](github-release.md)构建签名draft，保存独立证明和最终哈希，测试该exe的安装、凭据保留及0.4.4 → 0.4.5安装升级；当前不自动执行tag/push。
4. 人工发布已验草稿后，在指定测试安装补官方设置/菜单自动更新smoke，通过后再推广。旧版固定latest入口看不到draft，不能把发布前的手动安装升级当作官方自动更新通过。
5. Windows Authenticode与macOS Developer ID/公证仍未配置；当前按信任的内部环境验收，公开外部分发前另完成平台签名。

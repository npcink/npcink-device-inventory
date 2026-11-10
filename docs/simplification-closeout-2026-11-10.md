# 精简工作收尾与发布准备（2026-11-10）

## 当前结论

停止扩大冗余排查范围。本轮已完成源码精简、回归和隔离验收，现按用户授权分批本地提交。当前是已收尾的开发源码，不是已放行的正式发布候选。

工作分支：`codex/scope-simplification-closeout`，从 `codex/windows-0.4.5-acceptance` 的 `747ddd8` 建立。原分支及已有历史保留。本次未推送、合并、创建 tag、创建 Release 或部署。

| 本地提交 | 范围 |
| --- | --- |
| `5fa7d1f` | 桌面仅保留设置、排障与技术详情，删除监控和系统维修入口，收缩上传排障包，合并 Windows 编号脚本并移除闲置依赖 |
| `658ceef` | 删除手工身份 POST、全局快照 GET 及无消费者的统计配置；保留身份认领、设备快照、分析和备份；补齐兼容与路由回归 |
| `5f7e613` | 后台分析、财务未知 / 零值、保存与导入边界、名称 / 价格主记录、缓存和导出精简、说明提示及新增弹窗重开修复 |
| 本文所在文档提交 | 范围决策、数据契约、实施与验收证据、历史入口及发布前待办 |

此前各阶段文档中的“未提交”记录是当时状态；当前提交状态以本文为准。完整变更依据见 [ADR-019](decisions/ADR-019-focus-on-inventory-and-upload.md)、[实施记录](scope-simplification-2026-11-10.md)及[后续 7 项结果](redundancy-review-2026-11-10.md)。

## 已有验证与证据

- 后台构建、ESLint、硬件 / 财务 / 导入 / 保存 / 缓存 fixture、分析分页、PHP fixture、PHPStan、PHPCS、版本契约及包体预算已通过。
- 桌面精简后的生产构建、两 crate 格式 / Clippy、65 项采集器测试与 12 项桌面测试已通过；桌面预览和排障包脱敏回归已完成。
- M4 最终精简包通过完整隔离 Docker 门禁：WordPress 7.1.4、PHP 8.3、MariaDB 11，官方 Plugin Check、真实 REST 权限 / 路由、上传、防重放、限流、事务回滚、备份恢复及多站点验收。
- 浏览器验证分别记录真实 WordPress 和合成 REST 的范围；末轮合成接口覆盖新增、重复开关、编辑、缓存、审计及导出，下载 Excel / CSV 后已独立读回。
- 本次收尾没有新增产品代码。额外执行 `npm run check:release`：发布工具回归通过，随后在后台 npm moderate 审计处失败，后续步骤未由该次总命令执行；上述已通过检查依据此前独立运行记录，不据此声称完整总门禁通过。

最终本地验收 ZIP：`.local-backups/redundancy-implementation-2026-11-10/evidence/acceptance-plugin-final.zip`。

SHA256：`16d0ea2144b11995fe203eec75c2725ebb510dadbe4865070f2f377152e67c9e`。

收尾时将包内 132 个存在对应本地文件的条目逐一比较，全部字节一致，涵盖插件源码、前端审查源码 / 锁文件及构建产物。结果位于 `.local-backups/simplification-closeout-2026-11-10/acceptance-package-match.json`。该 ZIP 是本地验收证据，不是随后 CI 签名候选，也没有覆盖本地正式 `release/` 或 `sj/` 包。

源码备份、末轮差分和验收证据见实施记录；提交前另备份到 `.local-backups/simplification-closeout-2026-11-10/`。这些材料位于忽略目录，不随 Git 提交或发布包分发。

## 发布前仍需完成

2026-11-10 只读查询 GitHub Release，最新正式版本仍为 `v3.2.3`；当前源码保留插件 `3.2.4` / Agent `0.4.5`。此次未改变版本。因包含 `ele-rs/` 修改，正式候选必须按完整桌面范围准备，不能只发插件后宣称桌面精简已交付。

| 次序 | 待办 | 完成条件 |
| --- | --- | --- |
| 1 | 独立处理后台依赖告警 | 当前 10 项 moderate 来自 ESLint / TypeScript ESLint 的 minimatch 依赖链；评估兼容性、更新后重跑相关检查，`check:release` 不再被阻断；不使用 force 或忽略规则绕过 |
| 2 | 刷新 RustSec 联网审计 | 之前联网失败，仅使用 2026-10-29 缓存公告库检查；正式候选需成功刷新并检查两个 lockfile，记录 5 条既有上游提示的实际状态 |
| 3 | 冻结最终源码并构建新候选 | 基于最终 commit 依发布流程生成 Windows / macOS、updater 签名、manifest、candidate.json 与校验和；旧 Windows preview 不含本轮精简，不能复用其验收结论 |
| 4 | Windows 及候选实机验收 | 普通用户 / 管理员采集、合并后的 BAT / PowerShell、上传排障 ZIP、安装、0.4.4 升级与配置保留，明确 skipped / manual，不以 macOS 测试代替 |
| 5 | 对最终候选字节复验与人工放行 | 同一批制品完成插件升级 / 恢复、HTTPS 上传、签名和哈希核对；按 ADR-018 发布已验草稿，不覆盖已验制品；发布后补正式 GUI 更新验证 |

Windows Authenticode、macOS Developer ID / 公证及旧正式 GUI 更新的边界继续遵循 [GitHub 发布流程](github-release.md)与 [ADR-018](decisions/ADR-018-accept-immutable-release-candidates.md)。本轮未把这些前置或后置事项标为已完成。

后续只围绕上述发布任务或真实使用反馈推进，不继续以“还能删什么”为目标扩大范围。前序身份续办和上传问题仍保留在[前次收尾](session-closeout-2026-10-30.md)，不在本轮重新操作真实数据。

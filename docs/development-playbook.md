# 开发收尾与工作手册

## 目的与适用范围

这份手册把项目截至 2026-08-03 的真实试点、范围收缩和 3.1.0 发布经验整理为后续开发的默认工作方式。它不是另一套功能需求；现行功能契约仍以数据模型、身份契约和 ADR 为准。

产品的核心价值很窄且明确：管理员维护资产；Device Agent 上传电脑硬件事实；系统以可解释、可审计的规则匹配资产并保留观测与事件。它不是公开查询门户、ITSM、远程运维、工单或趋势/价值分析平台。

## 当前不可随意突破的边界

- 顶层资产类型只有 `computer` 和 `custom`；其余分类使用 `category`。
- 资产、身份、观测、事件四表分别承担业务记录、匹配证据、硬件快照和审计时间线，不能混为一个“设备指纹”字段。
- 所有资产查询和管理操作留在已授权的 WordPress 管理端；不恢复匿名查询或访问码。
- 分析中心只展示从当前事实派生的只读结果；不新增“已处理”、工单、趋势或批量处置状态。
- 服务端根据上传事实计算身份，不信任客户端传入的身份哈希；身份冲突必须失败关闭，绝不自动合并资产。
- 资产编号是可变管理字段，不是硬件身份；编号复用前必须先处理旧资产并核对身份、观测和 latest 指针。
- 磁盘、内存、显卡、USB 网卡、当前 MAC 和 CPU `ProcessorId` 是快照或辅助核对信息，不进入自动身份摘要。
- observation 原始数据只在管理员单条详情中按需读取；列表不得携带完整 raw。桌面端普通上传先写本地私有快照，再发起网络请求；深度排障包继续人工发送。

边界来源见 [`ADR-003`](decisions/ADR-003-pre-ga-scope-reset.md)、[`ADR-004`](decisions/ADR-004-hardware-identity-v2.md) 和 [`ADR-005`](decisions/ADR-005-observation-troubleshooting-boundary.md)。新需求若要改变其中任一条，应先补 ADR，说明真实使用场景、权限边界、失败行为、迁移方式和验收指标。

## 从历史中得到的开发方法

### 先用真实事实缩小问题

先检查已有数据、真实设备或可复现 fixture，再决定是否改模型。35、103、133、174 的实机试点证明：两台同型号 Dell 的 CPU `ProcessorId` 可以相同，而 UUID、主板序列号和永久 PCI MAC 不同；133 的固件 UUID 和主板序列号是占位值，却有可用的永久 PCI MAC。由此形成了当前“独立强信号 + 受约束的 PCI 永久 MAC”规则，而不是凭直觉把 CPU 型号或当前 MAC 当主键。

结论应同时记录反例和边界：TPM 在试点中不可用，`notUserRemovable` 不能可靠区分板载网卡，USB/虚拟网卡不能用于自动匹配。

### 以可解释的多个信号替代黑盒指纹

身份事实可以多条并存，但每条都有名称、来源和置信度。当前 v2 身份为：有效系统 UUID、有效主板序列号，以及仅限物理非虚拟 PCI 网卡的永久 MAC。服务端一次计算全部证据；证据属于不同资产时返回 `409 identity_evidence_conflict`。这让“为何匹配、为何拒绝”都可追溯。

兼容代码必须有退出条件。v1 仅在 v2 首次上传找不到拥有者时用于查找旧资产，并在同一事务中补写 v2；新资产不再写 v1。观察完已有资产升级后，应单独决定删除这条过渡查询的版本和条件。

旧身份迁移不能只验证“旧哈希命中”。目标资产最近观测和本次上传都能计算出 v2 身份时，至少要共享一个证据；完全不相交必须在事务前返回 409。32/35 串号事件证明，迁移兼容层比新算法本身更容易固化历史错误。

### 控制复杂度：删除未证实的承诺

复杂度不只来自代码行数，也来自可见功能、API、状态、迁移和测试组合。此前已经删除或收缩了公开查询、多代长期兼容、可写分析流程和多种顶层资产类型；不要仅因“以后可能需要”恢复它们。已有可靠边界（四表模型、事务化上传、HMAC、备份恢复、发布门禁）也不要为追求“更整洁”而整体重写。

对大组件的拆分以清楚的工作区边界和可独立验证为前提，不以文件行数作为唯一理由。

### 排查能力从证据链开始，不从日志堆积开始

先确认系统是否已经保存原始事实，再判断需要补存储、接口还是解释能力。原始事实、标准化结果和按需派生的身份解释/差异必须分层。列表只返回轻量摘要，完整 raw 由管理员按需读取；展示“为什么匹配”时复用真实身份服务，不复制近似规则。

客户端采集上传遵循“采集 → 私有落盘 → 上传”。常规 observation 与深度排障信息保持不同隐私边界，不能因为方便排查就自动上传事件日志、进程或 dump。详细经验见 [`observation-troubleshooting-development-summary-2026-08-04.md`](observation-troubleshooting-development-summary-2026-08-04.md)。

## 变更工作流

1. **定范围**：写清用户动作、数据写入、权限、失败结果和不做什么；判断是 bug 修复、局部增强还是需要 ADR 的架构改变。
2. **找证据**：优先读取现有契约、fixture 和真实样本；把可验证的假设写成最小复现或 golden vector。
3. **先改契约，再改实现**：涉及上传、身份、备份或 REST 的修改，先更新相应契约和 fixture；服务器仍是写入规则的唯一裁决者。
4. **保持失败安全**：身份冲突、无有效身份、权限不足、签名无效和备份冲突都应拒绝写入，并返回可行动的错误。
5. **分层验收**：先跑受影响的 fixture/单测，再跑静态检查与构建；发布候选还要验证最终 ZIP、Docker WordPress 和真实桌面升级路径。
6. **收尾**：更新当前文档入口、ADR 或发布记录；把一次性探针、试验或兼容层写明用途和删除条件，不把临时产物提交到仓库。

生产数据修复必须使用“完整备份 → 固定目标预检 → 单事务执行 → 审计记录 → 修复后完整备份 → 删除一次性工具”的闭环。禁止凭显示编号或数组下标直接改库；必须同时核对资产 UUID、身份值、观测硬件事实和预期数量。

## 最小验证矩阵

| 改动范围 | 至少执行 |
| --- | --- |
| WordPress 身份、上传、迁移或备份 | `npm run check:fixtures`、`composer run phpstan`、`composer run phpcs` |
| Rust 采集或桌面端 | `npm run check:desktop-quality` |
| Windows 身份探针 | `npm run check:windows-identity-probe`，并用真实机器样本确认边界 |
| 管理端界面 | `npm run check:fixtures`、`npm ci --prefix vite-admin && npm run build --prefix vite-admin`，再做受影响流程的后台冒烟 |
| 正式发布候选 | `npm run build:release && npm run check:release`；可用 Docker 时再执行 `npm run check:docker`；按 [`release-readiness-checklist.md`](release-readiness-checklist.md) 记录人工与桌面验收 |

不要把“本地构建通过”当作发布完成。正式桌面发布还要核对 tag、版本契约、Windows/macOS 资产、更新清单和签名；插件发布还要核对最终 ZIP 与 Plugin Check。

## 当前运行与后续观察

- 当前正式版本为 WordPress 插件 3.1.0 与 Device Agent 0.3.0，发布记录见 [`release-verification-2026-08-03-v3.1.0.md`](release-verification-2026-08-03-v3.1.0.md)。
- 部署顺序必须是先升级插件，再部署 Agent 0.3.0；否则 schema 5 的身份事实无法按 v2 契约处理。
- 观察已有 v1 资产首次上传是否唯一命中并补写 v2；在实际覆盖完成前，不删除 v1 过渡查询。
- 对 133 这类只依赖 PCI 永久 MAC 的设备，网卡更换后需要人工确认资产关系，不能自动把新身份并入旧资产。
- 未出现重复、可量化的真实使用需求前，不扩张功能范围；出现后从本手册第一步重新开始。

## 文档导航

- [`asset-data-model.md`](asset-data-model.md)：运行时数据模型。
- [`identity-contract.md`](identity-contract.md)：身份算法、请求 schema 与错误语义。
- [`decisions/ADR-003-pre-ga-scope-reset.md`](decisions/ADR-003-pre-ga-scope-reset.md)：产品范围。
- [`decisions/ADR-004-hardware-identity-v2.md`](decisions/ADR-004-hardware-identity-v2.md)：v2 身份选择与迁移理由。
- [`decisions/ADR-005-observation-troubleshooting-boundary.md`](decisions/ADR-005-observation-troubleshooting-boundary.md)：原始采集留档与在线排查边界。
- [`decisions/ADR-006-guard-legacy-identity-migration.md`](decisions/ADR-006-guard-legacy-identity-migration.md)：旧 v1 → v2 迁移的证据连续性保护。
- [`observation-troubleshooting-development-summary-2026-08-04.md`](observation-troubleshooting-development-summary-2026-08-04.md)：本轮实现过程、经验和后续规范。
- [`windows-identity-and-asset-reconciliation-incident-2026-08-05.md`](windows-identity-and-asset-reconciliation-incident-2026-08-05.md)：133 采集故障与 32/35 串号的完整复盘和修复规范。
- [`release-readiness-checklist.md`](release-readiness-checklist.md)：发布门禁。
- [`windows-hardware-identity-pilot.md`](windows-hardware-identity-pilot.md)：实机试点方法与原始结论。

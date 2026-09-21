# 设备身份契约

## 状态

已接受。自 WordPress 插件 3.1.0 和 Device Agent 0.3.0 起适用；详细决策见 `docs/decisions/ADR-004-hardware-identity-v2.md`。

## 身份事实与优先级

服务端只从上传的硬件事实重新计算身份，不接受客户端声明的哈希。一次观测可以产生多个独立身份，按下列顺序排列：

1. `system_uuid_v2`：有效 SMBIOS/系统 UUID，置信度 100。
2. `baseboard_serial_v2`：主板厂商、型号和有效序列号的组合，置信度 100。
3. `pci_permanent_mac_v2`：仅当强信号不可用或未来暂时缺失时使用；由 PCI 物理网卡永久 MAC、主板厂商/型号和 CPU 型号组合，置信度 80。

同一设备可以保存两个强身份和多个 PCI 次级身份。这样某次采集暂时缺少一个信号时，仍可由另一个既有身份匹配。若本次上传的不同身份已经分别属于不同资产，服务端返回 `409 identity_evidence_conflict`，不自动合并。

所有身份值都对规范化事实计算 SHA-256，并只保存带版本前缀的摘要。PHP 与 Rust 使用同一无效值矩阵，拒绝全零/全 `F` UUID、已知共享 UUID、OEM 默认串和其他占位值。

## 明确排除

- CPU `ProcessorId`、CPU 序列号：只作为反馈诊断事实，不作为唯一身份；真实样本中两台同型号 Dell 返回了相同 `ProcessorId`。
- USB 网卡：可拔插，不参与自动身份。
- 只有当前 MAC、没有永久 MAC 的网卡：只适合人工核对。
- 硬盘、内存、显卡：属于常换部件，不参与身份。
- TPM：本阶段采集结果不稳定且样本均不可用，不作为上传前置条件。

`notUserRemovable` 也不作为硬条件；真实 PCI 网卡样本没有提供可靠的一致值。身份网卡可来自 Windows `Get-NetAdapter` 或 `root/StandardCimv2:MSFT_NetAdapter`。无论查询来源，PNP 标识必须以 `PCI\\` 开头、`Virtual` 不为真，并且必须包含有效的永久地址。

## 上传决策

1. 服务端计算本次全部 v2 身份，并查找所有已有拥有者。
2. 没有 v2 拥有者时，仅用同一批事实计算旧 `device_uuid_v1` / `fallback_device_v1`，查找升级前已存在的资产。
3. 旧 v1 命中资产且目标最近观测可重算出 v2 身份时，两组证据必须至少有一个相同身份；完全不相交则返回 `409 legacy_identity_migration_conflict`，不开始事务。
4. 找到唯一且证据连续的资产后，把本次 v2 身份原子地补写到该资产，再保存观测。
5. 找不到资产时，以第一个 v2 身份创建新资产并声明全部 v2 身份。
6. 无法计算任何 v2 身份时返回 `422 missing_identity`；身份证据冲突时返回 409；两种情况都不创建资产、观测或事件。

旧 v1 算法仅用于升级后的首次定位，不会为新资产继续写入 v1 身份，也不会信任客户端传入的 v1 值。等真实部署中的现有资产都完成一次 0.3.0 上传后，可在后续版本删除该过渡查询。

管理员手工新增身份接口只接受三种 v2 类型；备份恢复仍能原样恢复已有 v1 行，以保证升级期间的数据可恢复性。

资产编号、上传备注、使用人、主机名和设备型号不参与身份匹配。资产编号可以调整，但已归档资产仍占用原编号；复用编号前必须先给旧资产重编号，再按需要归档，并显式核对身份和观测归属。旧迁移冲突的决策背景见 `docs/decisions/ADR-006-guard-legacy-identity-migration.md`。

## 采集结构

上传 `_npcink_device.schema_version` 为 5。相对 schema 4 只新增：

- `asset.hardware.processors[]`：Windows 处理器核对事实；
- `asset.hardware.network.identityInterfaces[]`：物理网卡永久地址、PNP 标识和接口元数据。

其余硬件和管理字段保持不变。

## 轻量采集与可解释降级（2026-09-16 修复）

普通上传必须执行主板、处理器身份和永久 PCI 网卡查询；Windows 完整采集与轻量采集共用该身份采集函数。0.4.4 预览同时为普通上传补齐显卡、显示器、电池基础数据，轻量快照标记为 `npcink-upload-light-v3`，上传 observation 仍为 schema 5。可更换的显示设备和电池只进入观测，不改变设备身份。

网卡按以下顺序查询，只有取得有效永久 PCI MAC 才停止；查询失败、空结果、仅有当前 MAC 或虚拟网卡，都继续降级：

1. `Get-NetAdapter -Physical -IncludeHidden`
2. `Get-NetAdapter -Physical`
3. `Get-NetAdapter -IncludeHidden`
4. `Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetAdapter`

保留每次查询的来源、结果数量、有效永久 PCI MAC 数量和失败类别；查询失败不会伪装成设备不存在该字段。PowerShell 输出统一 UTF-8，支持单对象、数组、空输出和 BOM。多个来源的结果保留为事实，身份层仍按规范化 MAC 去重。

本地快照/硬件反馈新增 `identityDiagnostics`，区分字段 `valid`、`invalid_placeholder`、`missing`，包含查询尝试与最终 `ready` / `needs_review` 决策。它不参与服务端匹配。无身份时，在发起上传之前显示中文分项说明；本地应用日志记录状态，不记录原始身份值。旧版轻量快照、其他版本快照和无法计算身份的快照不再作为有效缓存使用。

当前 MAC、MachineGuid、本地生成的 Agent ID 不升级为硬件身份。它们不能单独证明两次上报属于同一物理设备；没有可信硬件证据时，本版本保留本地反馈并提示管理员核对，不创建服务端“待确认资产”或自动合并。

本次不调整身份摘要、置信度、v1 过渡和冲突保护。修复采集能恢复身份计算，但不自动修复此前已经产生的重复资产，也不能仅凭编号把无身份旧资产绑定到新上报。

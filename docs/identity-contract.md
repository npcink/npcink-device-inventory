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

`notUserRemovable` 也不作为硬条件；真实 PCI 网卡样本没有提供可靠的一致值。身份网卡必须来自 Windows `Get-NetAdapter -Physical -IncludeHidden`，并且 PNP 标识以 `PCI\\` 开头、`Virtual` 不为真。

## 上传决策

1. 服务端计算本次全部 v2 身份，并查找所有已有拥有者。
2. 没有 v2 拥有者时，仅用同一批事实计算旧 `device_uuid_v1` / `fallback_device_v1`，查找升级前已存在的资产。
3. 找到唯一资产后，把本次 v2 身份原子地补写到该资产，再保存观测。
4. 找不到资产时，以第一个 v2 身份创建新资产并声明全部 v2 身份。
5. 无法计算任何 v2 身份时返回 `422 missing_identity`；身份证据冲突时返回 409；两种情况都不创建资产、观测或事件。

旧 v1 算法仅用于升级后的首次定位，不会为新资产继续写入 v1 身份，也不会信任客户端传入的 v1 值。等真实部署中的现有资产都完成一次 0.3.0 上传后，可在后续版本删除该过渡查询。

管理员手工新增身份接口只接受三种 v2 类型；备份恢复仍能原样恢复已有 v1 行，以保证升级期间的数据可恢复性。

## 采集结构

上传 `_npcink_device.schema_version` 为 5。相对 schema 4 只新增：

- `asset.hardware.processors[]`：Windows 处理器核对事实；
- `asset.hardware.network.identityInterfaces[]`：物理网卡永久地址、PNP 标识和接口元数据。

其余硬件和管理字段保持不变。

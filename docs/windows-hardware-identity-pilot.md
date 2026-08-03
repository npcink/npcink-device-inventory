# Windows 硬件身份探针试点

## 目的

在修改正式采集器和服务端身份规则之前，先确认真实 Windows 设备能否稳定提供以下信号：

- SMBIOS 整机 UUID；
- 主板序列号；
- 物理网卡当前 MAC、永久 MAC 和 PNP 标识；
- 物理网卡 PCI 位置和是否可由用户移除，用于辅助判断板载网卡；
- CPU 型号和 `ProcessorId`（只作为配置校验）；
- TPM 是否存在且已就绪（本阶段不读取 TPM 唯一密钥）。

探针不读取硬盘、内存和显卡身份，不连接站点，也不上传数据。

## 在 Windows 设备上运行

推荐直接使用与设备编号对应的双击脚本，并保持 BAT 和 PowerShell 探针在同一目录：

```text
windows-hardware-identity-probe-35.bat
windows-hardware-identity-probe-161.bat
windows-hardware-identity-probe-103.bat
windows-hardware-identity-probe-174.bat
windows-hardware-identity-probe-133.bat
windows-hardware-identity-probe.ps1
```

双击对应的 BAT 后，JSON 会自动保存到当前用户桌面。

需要手动运行时，将 `ele-rs/scripts/windows-hardware-identity-probe.ps1` 复制到设备上，在 PowerShell 中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-hardware-identity-probe.ps1 -AssetNumber "35"
```

其他设备把命令中的 `35` 改成 `161`、`103`、`174` 或替代fallback样本 `133`。未指定 `OutputPath` 时，探针会按设备编号把 JSON 自动保存到当前用户桌面。

生成的 JSON 包含 SMBIOS UUID、主板/CPU 序列和标识、MAC 地址、PNPDeviceID、InterfaceGuid 及 PCI 位置信息，发送前应按私密硬件身份资料处理；文件不包含站点地址、上传令牌、IP 地址、磁盘、内存或显卡信息。

四台设备会分别生成：

```text
35-windows-hardware-identity-probe.json
161-windows-hardware-identity-probe.json
103-windows-hardware-identity-probe.json
174-windows-hardware-identity-probe.json
133-windows-hardware-identity-probe.json
```

## 离线检查

在项目根目录执行：

```bash
npm run check:windows-identity-probe -- /path/to/35-windows-hardware-identity-probe.json
```

结果分为：

- `strong`：取得有效 UUID，或取得带主板厂商/型号校验的有效主板序列号；
- `fallback_candidate`：取得 PNP 标识为 `PCI\` 的物理网卡永久 MAC，同时主板和 CPU 校验信息完整；
- `manual_candidate`：PCI 物理网卡只有当前 MAC，暂时只适合人工确认；
- `insufficient`：仍缺少足够信号，需要继续调查网卡或 TPM 方案。

这些等级用于验证身份 v2 的输入事实；探针本身仍不会写入站点。正式采集由 Device Agent 0.3.0 完成，服务端按 `docs/identity-contract.md` 重新计算身份。

## 第一轮结果

- 35、103、174：`strong`，均取得有效系统 UUID、主板序列号和永久 PCI MAC。
- 103 与 174：相同 Dell 型号、主板型号、CPU 型号及 `ProcessorId`，但三个强硬件信号不同，证明不能把 CPU `ProcessorId` 当唯一值。
- 133：`fallback_candidate`，固件 UUID和主板序列号为占位值，但永久 PCI MAC、主板描述和 CPU 型号完整。
- 四台样本 TPM 信息均不可用；`notUserRemovable` 也不能作为硬性过滤条件。

第一轮已满足进入正式实现的门槛，无需继续收集其他设备才可开始本地开发。

## 通过标准

第一轮中，161用于验证缺少有效主板序列号和UUID时的fallback候选；若161受系统策略限制，则使用同类KOLOE H610设备133替代。35用于正常台式机对照；103和174用于验证同型号Dell设备仍能正确区分。所有设备都不能把虚拟网卡或 `USB\` 网卡作为身份信号。PCI 网卡仍可能是独立扩展卡，Windows 没有跨厂商绝对可靠的“主板集成网卡”字段，因此还要结合 `notUserRemovable` 和 PCI 位置信息人工核对一次。

第一轮通过后，在其中一台设备重启并切换一次有线/Wi-Fi状态，再采集第二份结果。永久 MAC、主板描述和 CPU 描述应保持不变；硬盘、内存和显卡不参与判断。

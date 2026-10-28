# 完整硬件采集与详细信息展示（2026-10-27）

## 决定与状态

用户要求采集阶段尽可能取得完整硬件事实，详细信息 TAB 尽可能展示全部采集结果；概览继续使用原来的紧凑卡片。本次已落实到当前工作区及 device.local 使用的插件构建，未发布安装包，未改写已有资产或观测。

原问题包含三个断点：普通上传使用较少的查询、上传转换只选择固定类别、详情使用固定字段白名单。现在普通上传、本地检查、JSON 导出共用完整采集路径，上传保留新增类别，详情递归展示每个已保存字段。来源无法取得的数据仍明确保留未知，不从总容量或卷数猜测硬件。

## 采集与上传契约

快照标记为 `npcink-hardware-inventory-v3`，旧轻量缓存失效；HTTP observation 的 `_npcink_device.schema_version` 仍为 5。实际客户端发送 `{ "observation": { "_npcink_device": {}, "asset": {}, "raw": {} } }`，不上传客户端身份摘要。服务端仅接受上述包装及 schema 5；`_npcink_device.observation_id` 必须为每次采集生成的稳定 UUIDv4，重试返回原记录，修改内容复用编号则冲突。身份类型、匹配算法与更换部件边界不变。

本说明记录已实现的范围，不能作为全部采集准确、原始信息完全保真的证明。[后续采集与接口审计](collector-and-ingest-audit-2026-10-27.md)已复现原始字符串清洗、长键冲突、未知值回填及上传重定向问题，并列出尚未落实的改进。

| hardware 字段 | 内容与展示规则 |
| --- | --- |
| cpu / processors | CPU 规格及每插槽身份事实；currentFrequency 为采集时 MHz，不冒充基准频率 |
| memory.system / modules / arrays / kind | 系统容量、逐条模块、内存阵列、dimm/unified；展示条数、容量组合，有真实阵列证据才计算槽数 |
| disks / volumes | 物理盘与文件系统卷独立保存；卷标和盘符不叫物理型号，不能由卷数量推断硬盘数量 |
| network | 主接口、全部接口和身份网卡；保留 IPv6、永久地址、网关、DNS 等来源事实 |
| system / os / chassis / baseboard / bios / hardwareUuid | 整机、操作系统、机箱、主板、固件和硬件 UUID；主机名独立，不回退为设备型号 |
| graphics / battery | 控制器、屏幕及电池可用字段，包含驱动、制造信息和容量；零电量与零循环有效 |
| peripherals | 声卡、摄像头、USB、打印机 |
| storage / security | 系统报告的物理存储和可靠性计数器，Secure Boot 与 TPM 状态；查询失败允许部分结果继续上传 |
| collection | 采集器版本、时间、硬件/身份查询状态和耗时、身份诊断 |
| platformData | 平台原始查询结果；保留未规范化字段，未知键原名展示 |
| 其他类别 | 上传不丢弃新增类别，详情提供其他采集字段入口 |

Windows 查询系统硬件 CIM 类、EDID、内存阵列、网络配置、Get-PhysicalDisk、Get-StorageReliabilityCounter 和硬件安全状态。CIM 基础设施元数据剔除，其余来源字段保留。TPM 仅选择状态字段，不查询 OwnerAuth。密码、上传授权码、系统产品密钥不属于硬件采集范围。

macOS 的 system_profiler 分硬件/显示/内存/电源、NVMe/SATA、USB/音频/摄像头/打印机三组执行并记录状态。Intel DIMM 记录按系统实际返回解析；Apple 统一内存不称为一根内存条。各组独立失败，已取得字段仍保留。

系统命令每次最多 12 秒，共享 60 秒预算；system_profiler 使用内部 8 秒参数。部分查询失败后继续尝试其余查询；Windows 串行查询仍可能先耗尽共享预算，导致后续核心项没有采集机会，见后续审计。

## 存储与显示边界

接口保留 2 MiB 请求体上限、每数组/对象 512 项、字符串 10000 字节；为嵌套硬件树将最大深度设为 24、总节点数设为 20000。上述超限会拒绝，但字段键尚未按相同规则校验，入库会截断到 128 字节并可能覆盖同名键；原始字符串还会经过文本清洗。这些保真缺陷尚未修复。通用清理深度同步到 24，已有 MariaDB 回归确认嵌套数据、false 和 0 持久化不变，其覆盖范围不足以排除上述问题。

详细信息按部件分组，取消每十个属性分页，避免一根内存被拆成两页。所有已保存字段均可查看；默认隐藏空字段、空集合及没有有效内容的分类，可勾选“显示空字段”查看缺失项。零值、否值和查询失败诊断保留，未知字段保留原名。导航合并为资产、处理器、内存、存储、图形与显示、网络与外设、系统与固件、采集诊断八类。存储内分别保留物理盘、卷及健康信息的分组；系统与固件包含整机、OS、主板、BIOS、机箱、电池、安全状态及 UUID；采集诊断包含查询状态、平台原始字段和其他采集字段。合并只改变导航组织，保留全部字段与部件标题。字段通过 React 文本渲染，不能解释为 HTML。

内存配置/标称速度分别保留。新电压字段 configuredVoltageMv/minVoltageMv/maxVoltageMv 明确为 mV；已有 voltageConfigured/Min/Max 按 V 展示。内存类型按 SMBIOS 枚举解析，涵盖 DDR4/DDR5、LPDDR/LPDDR5 与 HBM；未知代码不猜类型。未知厂商代码原样标注，不猜品牌。没有 DIMM 明细时不能从容量推测条数；没有物理盘事实时不能把 C/D 卷算作两块硬盘。

## 验证与实际限制

- Rust 采集库 43 项、桌面库 14 项回归与两侧 Clippy；覆盖共用路径、完整上传、未知字段、查询失败、DIMM/统一内存和缓存失效。
- 前端硬件详情回归、lint、TypeScript/生产构建、插件打包及体积预算。
- PHP fixtures、PHPStan、PHPCS；隔离 WordPress/MariaDB/Plugin Check 和多站点回归通过，包含深层硬件字段实际存储。
- 本机 macOS 只采集不上传，约 0.95 秒完成，约 18 KB 紧凑 JSON，三组 profiler 成功，保留 1 块物理盘和 2 个卷。
- device.local 读取现有资产 97 验证两条内存、4 GB × 2、Ramaxel、料号、3200 MHz 和电压。未写入演示资产。

已有 180 台电脑的旧观测中，40 台缺少内存条事实、63 台只有卷记录。新版界面能展示已保存事实，但不能补出从未采集的数据；需使用更新后的采集器重新采集上传。

Windows 实机采集、安装、签名更新及远端 CI 按用户安排后续执行。系统未报告的逐屏刷新率、磁盘与卷对应关系或健康指标仍受平台来源限制，不据其他字段猜测。

## 显存来源与导航滚动修复

RTX 5060 现有观测的 vram 为 4,293,918,720 字节，原页面四舍五入后显示 4 GB。Windows 的 Win32_VideoController.AdapterRAM 为 UInt32，不能可靠表达大于 4 GiB 的显存；该数值不能作为显卡实际容量。

- 新增固定 DXGI 查询，读取 IDXGIAdapter1::GetDesc1 的 SIZE_T DedicatedVideoMemory，保存为 64 位字节数。来源使用 vramSource 明确标注，SharedSystemMemory 独立保存，不能相加当作独立显存。
- 以 PCI Vendor/Device/SubSystem ID 唯一匹配 WMI 控制器与 DXGI 适配器，不按型号或数组顺序猜。相同型号多卡无法唯一匹配、软件适配器或查询失败时保留原始适配器结果，vram 留空并报告状态。
- 旧 AdapterRAM 保留为 vramReportedBytes；旧观测中未标来源的 Windows vram 在展示时转为“旧接口报告，待核实”，显示精确字节和截断说明，不回写数据库，不按型号硬改为 8 GB。
- 缺少 graphics_memory 查询记录的 Windows 本地缓存失效，重新采集；查询失败本身不阻断上传。
- 桌面导航 overflow-x 设为 hidden，保留必要的纵向滚动并允许长标题换行；窄窗口导航自动换行，取消横向滚动。

回归覆盖 8 GiB 与截断 WMI 值、反序双显卡、重复/不匹配/软件适配器、来源保留、共享系统内存、完整上传、旧缓存拒绝，以及 Windows/macOS 展示隔离。Windows DXGI 命令本身仍待后续实机执行，当前未声称用户设备已重采到 8 GB。

来源：[Win32_VideoController](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller)、[DXGI_ADAPTER_DESC1](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc1)。

## 采集与接口整改补充

安全边界、分组调度、幂等、内存速度单位及实际验收以[采集与接口整改记录](collector-remediation-2026-10-27.md)为准。Windows 批处理和 DXGI 尚待已延期的实机验收；完整采集不意味着系统必然报告所有硬件属性。

库存 v3 新增系统来源的物理盘→分区→卷关联和健康记录设备对应，细化显卡/显示器匹配状态，并在原八类详情内展示相关诊断；空字段仍默认隐藏。字段、取舍与本地验收见[部件关系与采集质量合同](component-relations-2026-10-27.md)。

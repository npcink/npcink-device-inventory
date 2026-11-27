# 采集系统与采集接口审计

日期：2026-10-27。对象：当前工作区中的 Rust 采集器、Tauri 客户端、WordPress 观测接口、存储与详情字段语义。工作区含前序未提交变更，本报告以当前文件内容为准。

> 本文为整改前审计快照；后续已实施项目和验证结果见[整改记录](collector-remediation-2026-10-27.md)，不应将下表全部理解为仍未处理。

## 结论与范围

完整采集、上传保留新增类别、平台原始字段、详情通用展示已经接通。但“查得多”还没有形成“准确、有来源、可证明完整、可靠入库”的闭环。当前主要问题集中在上传边界、原始数据保真、查询预算分配与未知值语义；继续堆叠更多查询前应先修复这些问题。

本轮进行源码核查、真实 WordPress 函数的只读边界复现、直接复用当前 Rust 源码的合成输入复现，以及本地 HTTPS/HTTP 重定向实验。没有向 device.local 写入演示资产或观测，没有执行下载的开源代码，没有启动 Windows 实机、安装、签名更新或远端 CI 验收。

优先级：P1 为应在下一轮功能扩展前处理的安全或核心数据可靠性问题；P2 为明确的准确性、可靠性和契约问题；P3 为后续覆盖完善。代码确认和本地复现不等同于已在全部硬件上验证。

## 已确认的问题

| 编号 | 优先级 | 问题与触发条件 | 影响 | 建议 |
|---|---|---|---|---|
| A01 | P1 | 上传只检查初始 HTTPS URL，reqwest 使用默认重定向策略。可信 HTTPS 起点返回跨主机/端口的 307 时，仍转发自定义签名头与完整 body；本地实验进一步确认允许降级 HTTP。 | 硬件内容可被发送到重定向目标；签名秘密本身没有被直接发送，但签名头和可在有效期内使用的已签名请求会外流。 | 设备写入接口默认禁止自动重定向，并启用 HTTPS-only；确需迁移地址时显式配置新站点。不要只依赖库清除 Authorization，因为当前鉴权使用自定义头。 |
| A02 | P1 | hardware 和 raw 都经过 `sanitize_textarea_field`；键经过 `sanitize_text_field` 并截断到 128 字节，接口却没有校验键长度或清洗后的冲突。 | 原始型号/序列号会改变；两个合法请求键可能静默覆盖。原始来源区无法用于准确追溯，历史备份也复制失真结果。 | 业务文本与硬件 JSON 分开处理：业务字段按语义清洗；JSON 校验 UTF-8、类型、大小、深度，保留合法字符与键。在输出处转义。超长/非法/冲突键明确拒绝，不能静默截断。 |
| A03 | P1 | Windows 先查 UUID，再串行查主板、CPU、最多四轮网卡，再执行 22 项硬件查询；每个命令最多 12 秒，共享 60 秒。内存位于视频、显示器、电池、BIOS 之后。 | 故障或不适用的前置查询可耗尽预算，使内存/硬盘等核心信息缺失；单独查询失败后继续调用，并不保证后续仍有预算。大量独立 PowerShell 启动也增加固定成本。 | 身份、内存、物理盘、GPU 作为核心任务保留预算；外设和可选诊断后置。消除重复 UUID 查询，使用受控持久 worker 或原生 WMI，采用有界并发与可取消查询。不要用不可取消线程冒充超时控制。 |
| A04 | P2 | Mac 将 `SPHardwareDataType.physical_memory` 写入 `baseboard.memMax`，详情将其显示为“最大支持内存”。 | 已安装 16 GB 会被解释成最大支持 16 GB，Intel 可升级机型尤其明显。 | 已安装容量只写 installed/total；最大支持容量仅在有可靠来源时填写，否则 null。统一内存、板载内存、插槽内存分开表达。 |
| A05 | P2 | `primary_ip` 在没有地址时返回 `127.0.0.1`；Windows 以“有网关”标记默认网卡，上传选择第一个默认项；基础 operstate 用历史收发字节推断。 | 离线设备出现虚构主 IP；双网卡/VPN/多默认路由可能选错；已断开的接口仍可能被标为 up。 | 未知 IP 留空；按实际路由和 metric 选择，IPv4/IPv6 分开；用接口真实链路状态。保留全部 IP 地址数组，避免只留首个 IPv4/IPv6。 |
| A06 | P2 | 上传规范化已剔除伪装成物理盘的卷，但摘要 `disk_bytes` 仍直接求和原始 `diskLayout`。物理盘查询失败时，该数组是文件系统卷。 | 同一份观测可能“物理盘 0 块、总硬盘容量非零”；分区遗漏、共享容量、虚拟/网络卷会让摘要与实际物理容量不一致。 | 摘要只汇总已确认物理盘；物理盘未知则标注未知。逻辑卷容量单独统计，按真实 disk/partition/volume/container 关联去重。 |
| A07 | P2 | 接口只有结构规模限制，没有限定当前 schema 或核心字段类型；build 阶段接受 schema 999、缺省回退 1。包装对象与直接根对象都接受。 | 新旧或畸形契约容易被默默接纳；客户端/服务端升级出现问题时缺乏明确错误。与“仅维护当前版本”目标不符。 | 固定一个当前合同：当前客户端实际发送 `{observation: ...}`、schema 5。校验核心字段类型/范围，错误返回字段路径；原始扩展区允许未知键。移除直接根对象回退前统一测试与文档。 |
| A08 | P2 | nonce 是请求防重放机制，服务端没有 observation UUID/幂等键，每次已认证提交都创建观测与事件。 | 响应在提交后丢失，用户重试会生成重复记录；复用原 nonce 只会返回重放错误，不能查询首次结果。 | 每次采集生成稳定 observationId；重试使用新 nonce、同一 observationId。以 token/设备及 observationId 建唯一约束，同 ID 不同内容返回冲突，同内容返回首次结果。 |
| A09 | P2 | 命令 stdout/stderr 各截断到 4 MiB，但返回值没有 truncated 标记；上传又受 2 MiB、512 项、2 万节点等限制，客户端无对应预检。 | 大外设/嵌套来源数据可能被误报 invalid_json，或完整采集后才在服务端失败；无法分辨没有数据与数据被截断。 | 输出超限显式报 `output_too_large` 并保留计数；客户端镜像校验接口预算并指出具体路径。核心库存与大诊断附件分开传输，避免盲目放大服务端上限。 |
| A10 | P2 | 客户端读取整个响应正文，无字节上限；任何 2xx 有效 JSON 都当作成功。 | 地址误配或代理返回无关 JSON 仍可能显示连接/上传成功；异常大响应增加内存占用。 | 校验 verify 的 `data.connected` 和上传结果的资产/观测标识；限制响应字节数，对超限与格式错误给出清晰诊断。 |
| A11 | P2 | 数据在 normalized 与 platformData 中重复；服务端再将包含完整 hardware 的 payload 写入 raw_json，上传成功响应又回传 hardware 和 raw。 | 随着完整采集扩展，存储、备份、请求响应与解析开销同步增长。不是“当前已经达到性能瓶颈”的测量结论，但重复结构可直接确认。 | 规范视图与原始来源各保留一份，raw 使用来源引用或必要元数据；上传响应返回 receipt/ID，详情按需读取。先量化真实包大小与查询耗时再决定压缩/分页。 |
| A12 | P2 | 未知值仍有默认事实：Windows battery 缺失容量变成 0；CPU WMI 空结果会把已有 sysinfo 核心数覆盖为 0；基础 CPU processors 固定 1；hostname 复制成 fqdn。 | 无法区分未报告与真实零值；成功启动查询不代表取得有效硬件字段。 | 按字段使用可空类型；只有有效新证据才能覆盖已有值。区分 unknown/not_present/unsupported/permission_denied/timeout/invalid，不把猜测作为事实。 |
| A13 | P2 | Windows 查询失败只记录退出码；Mac profiler 按三大组标 ok，CPU/路由/DNS 补充命令失败没有完整探针记录；失败 GPU 结果也可缓存 10 分钟。 | 看见“没有内存/没有安全状态”时，不能直接定位不存在、权限不足、来源未支持、局部缺失或超时。 | 每类探针统一 source、status、elapsed、records、errorCode、truncated、采集版本；大组内报告各子类型是否返回。失败和部分成功使用更短缓存，提供明确重试入口。 |

### 核心代码位置

- A01、A10：`ele-rs/src/upload.rs:87`（HTTP client）、`:114`（整段响应读取）、`:154`（成功响应解析）。实际依赖 `reqwest 0.12.28` 的 redirect 实现只自动剔除标准 Authorization/Cookie 等头，并未剔除 `x-npcink-device-*`。
- A02：`includes/v3/class-npcink-device-inventory-v3-sanitizer.php:19`、`:37`；`includes/v3/rest/class-npcink-device-inventory-device-observations-controller.php:83`；`includes/v3/repositories/class-npcink-device-inventory-observation-repository.php:67`。
- A03：`ele-rs/src/collector/platform.rs:12`、`:71`、`:114`、`:217`、`:281`、`:626`。单次 12 秒和全局 60 秒都已实现，问题在分配、执行顺序和来源重复，并非完全没有超时。
- A04：`ele-rs/src/collector/platform.rs:478`、`:499`；显示标签 `vite-admin/src/pages/shared/collectedFields.ts:51`。
- A05：`ele-rs/src/upload.rs:357`、`:386`；`ele-rs/src/collector/platform.rs:769`；`ele-rs/src/collector/mod.rs:941`、`:1004`。
- A06：`ele-rs/src/collector/mod.rs:894`；`ele-rs/src/upload.rs:205`、`:265`、`:446`。
- A07：`includes/v3/services/class-npcink-device-inventory-observation-ingest-service.php:36`、`:352`；`ele-rs/src/upload.rs:20`、`:243`。原有 ingest fixture 仍使用 schema 3，说明测试也未收敛到当前合同。
- A08、A11：`includes/v3/services/class-npcink-device-inventory-observation-ingest-service.php:159`、`:178`、`:369`、`:433`；`includes/v3/repositories/class-npcink-device-inventory-observation-repository.php:59`。
- A09：`ele-rs/src/command.rs:8`、`:17`；`includes/v3/rest/class-npcink-device-inventory-device-observations-controller.php:9`。
- A12：`ele-rs/src/collector/platform.rs:708`、`:1064`；`ele-rs/src/collector/mod.rs:843`、`:855`。
- A13：`ele-rs/src/collector/platform.rs:291`、`:318`、`:370`、`:397`；`ele-rs/src-tauri/src/lib.rs:28`、`:161`。

## 本地复现与验证结果

所有输入均为虚构边界值，未作为资产或观测写入站点。

1. 在本地 WordPress 加载环境直接调用真实 sanitizer，并通过 Reflection 调用结构校验与 observation 输入构建，未调用 ingest/鉴权/仓库写入：

   ```text
   long_keys_pass_shape_validation = true
   keys_before = 2, keys_after = 1, surviving_value = second
   "GPU <Engineering> Board" -> "GPU  Board"
   "SN%20A" -> "SNA"
   unsupported_schema_build_result = 999
   ```

   长键为相同 128 个 a 加不同后缀，两个字段均通过结构校验，随后被截断为相同键。schema 实验只证明构建阶段未限制版本，不代表没有身份事实的请求能成功创建资产。

2. 使用项目已编译的 reqwest 库，复用默认 redirect 行为；HTTPS 源站和 HTTP 接收站均只绑定本机回环地址。使用单次测试证书与 `audit-no-secret` 虚构签名，未禁用证书校验：

   ```text
   HTTPS localhost -> 307 -> HTTP 127.0.0.1（不同端口）
   final_scheme = http
   signature_forwarded = true
   body_forwarded = true
   ```

   此实验确认客户端行为；没有证明现有站点正在发出恶意重定向，也没有读取或发送真实授权码。

3. 临时 Rust harness 直接 include 当前 `upload.rs`、`collector/platform.rs`，只替换与本测试无关的身份前置检查，验证实际映射函数：

   ```json
   {
     "missing_primary_ip": "127.0.0.1",
     "mac_max_memory_from_installed_memory": "16 GB",
     "volume_only_physical_disk_count": 0,
     "volume_only_summary_disk_bytes": 1000,
     "accepts_unrelated_200_json": true
   }
   ```

   两个虚构卷各 500 字节，只用于证明摘要和硬件明细使用不同数据口径；没有模拟真实硬盘容量或真实采集耗时。

4. 本轮再次运行 `php tests/device-upload-boundary-fixtures.php` 与 `php tests/observation-ingest-fixtures.php`，均通过。这说明已有测试覆盖的限制/事务逻辑仍工作，也说明这些测试尚未覆盖上述缺陷。未将前序 43 项 Rust/14 项桌面测试通过当作 Windows API 实机验证。

实验脚本与结果暂存在 `/tmp/npcink-collector-reference-audit/`；测试证书私钥已删除。持久审计证据为本报告中的输入、输出与代码位置。

## 采集覆盖还欠缺什么

| 类别 | 已实现 | 剩余问题与建议 |
|---|---|---|
| 内存 | Windows 每模块容量、品牌字符串、料号、序列号、位置、SMBIOS 类型、配置/标称速度、电压；Mac DIMM/统一内存区分 | 增加阵列与模块关联、可靠槽位/空槽含义、ECC 解释、板载属性和明确数据质量。厂商返回代码时可依据有出处的 JEDEC 映射解释，保留原值；不能从总容量推断条数。 |
| 内存速度 | 已分别保留配置与标称值 | 展示层统一追加 MHz，字段未明确区分数据率 MT/s 与真实时钟 MHz。SMBIOS/osquery 按 MT/s 描述对应内存速度。应按来源定义单位，保留原始单位和字段名，不能简单把所有数值统一乘二/除二。 |
| GPU/显存 | 新增 DXGI 64 位专用显存，旧 AdapterRAM 标记待核实，共享内存分开 | Windows PowerShell Add-Type/手写 COM 桥尚待实机验收；相同 PCI Vendor/Device/SubSystem 的多张显卡无法唯一匹配，会留空。可参考 PCI bus/device/function 与 LUID 关联，使用 windows-rs 类型化接口；必要时选配厂商 API。Intel Mac 原始 profiler 显存尚未规范化到 controller。Apple 统一内存不能当成固定独显显存。 |
| 磁盘 | 物理盘与文件系统卷分开，Windows 增补存储健康计数 | 缺少物理盘→分区→卷关系、统一盘 ID 与健康记录关联；SMART/NVMe 寿命、错误、温度依赖权限/桥接支持。先建立设备关系，再选择性增加 smartctl JSON；不可用时说明原因。 |
| 显示器 | Windows EDID 型号、厂商、序列号、生产日期，部分分辨率 | 多屏分辨率/刷新率与接口归属缺少逐屏来源。使用 DisplayConfig 等实际显示拓扑；不能把一个控制器的模式复制到所有屏幕。 |
| 网络 | 基础网卡、永久 PCI MAC、网关/DNS/DHCP 等 | 默认路由、真实链路状态、多地址与 VPN/虚拟接口分类需完善。系统真实索引/路径比接口显示名匹配更稳。 |
| 固件/安全/电池 | BIOS/主板/机箱、Secure Boot/TPM 状态、电池规范字段 | 权限不足、Legacy BIOS、无电池等应有不同状态；WMI 电池部分容量不返回时可选更可靠系统电池接口。只采硬件状态，不扩展到密钥或凭据。 |
| 平台范围 | Windows 与 macOS 有专用 enrich 实现 | 其他平台只有基础 sysinfo 与空扩展，当前不能宣称完整 Linux 库存支持；若无 Linux 使用需求可明确范围，避免为其添加历史兼容层。 |

详细信息 TAB 现已提供规范字段、原始平台数据和未知字段入口。之后应围绕“来源是否提供→采集是否成功→转换是否保真→入库是否保真→展示是否解释准确”逐项核对；当前缺项不能全部归因于 UI 故意隐藏。默认隐藏空值仍然适合，但查询失败和数据质量应持续可见。

## 可以参考的开源项目

以下在本轮读取官方仓库源码或官方仓库文档核对，许可证以具体文件声明为准；不以 GitHub 自动识别结果代替完整许可证声明。

| 项目 | 适用方向 | 实际核查到的做法 | 对本项目的采用建议 | 许可证 |
|---|---|---|---|---|
| [GLPI Agent](https://github.com/glpi-project/glpi-agent) | 成熟硬件库存、跨平台来源与降级 | Win32 Memory 模块在 Generic Dmidecode 不成功时运行；Videos 用注册表 `HardwareInformation.qwMemorySize` 补充 WMI AdapterRAM，并按 PCI 信息匹配；Storages 有多来源与序列号处理 | 优先参考探针组织、来源优先级、空值/设备差异与回归样本。无需引入整个 GLPI 服务端或 Perl 运行时。其视频去重按名称、部分 PCI 匹配较宽，不能直接照搬到相同型号多卡场景。 | GPL-2.0-or-later（README 声明 GPLv2+） |
| [systeminformation](https://github.com/sebhildebrandt/systeminformation) | 细致内存字段、系统差异、GPU 多来源 | memory.js 查询每条容量、SMBIOS 类型、配置速度、厂商、料号、序列号、位宽、电压；graphics.js 使用注册表 64 位显存、PCI 匹配与 NVIDIA 查询 | 最适合对照字段覆盖、单位和真实输出格式，并转化成 Rust 脱敏 fixture。保留 Rust 主采集器；不要额外打包 Node 只为复用字段，也不要把其推断/默认值直接当权威事实。 | MIT |
| [osquery](https://github.com/osquery/osquery) | 稳定数据表契约、来源与类型、跨平台查询 | memory_devices 表明确 MT/s、mV 等单位；Windows 实现使用 WMI wrapper，枚举未知代码保留数字 | 借鉴字段命名、可查询结构、错误与类型管理。Windows 内存类型表自身并未覆盖全部新枚举，不应拿它替代最新版 SMBIOS 定义。全量部署 osquery 对当前单用户工具较重。 | Apache-2.0 OR GPL-2.0-only |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) | GPU、传感器、厂商 API、设备关联 | NvidiaGpu 使用 NVAPI/NVML，并明确按 PCI bus 校验关联，避免重启后不同 API 的索引指向不同 GPU | 参考准确匹配与可选传感器的来源管理。温度/负载属于运行状态；不默认引入其驱动、提权与完整 C# 服务。 | MPL-2.0；具体依赖另核对 |
| [smartmontools](https://github.com/smartmontools/smartmontools) | SATA/SAS/NVMe 健康与寿命 | smartctl 提供 JSON 输出；退出码是 bitmask，不是简单非零即查询失败；手册说明大整数输出选项 | 作为可选本地探针，解析稳定 JSON 与 bitmask、保留设备对应关系。权限不足和桥接不支持必须明确。无需用它承担其他硬件库存。 | GPL-2.0，另核对具体文件及再分发内容 |
| [wmi-rs](https://github.com/ohadravid/wmi-rs)、[windows-rs](https://github.com/microsoft/windows-rs) | Rust 原生 WMI/Windows API 接入 | wmi-rs 支持 serde struct/动态 map 及异步 WMI；windows-rs 提供类型化 Win32/COM 绑定 | 最符合现有 Rust/Tauri 技术栈。逐步替换多次 PowerShell 启动与手写 DXGI vtable；仍需可取消/可隔离的超时设计、目标 Windows 编译与实机验证。不要把换库本身等同于更可靠。 | 两者均 MIT OR Apache-2.0（Cargo 声明） |

已在使用的 [sysinfo](https://github.com/GuillaumeGomez/sysinfo) 适合 CPU/内存总量/运行状态，但不足以单独提供条级内存、EDID、完整显存、SMART 等库存事实。当前 `System::new_all()` 后又 `refresh_all()` 会重复请求广泛系统信息；可按真实所需 RefreshKind 缩小范围，再测量收益。

### 官方源码依据

- GLPI：[Memory.pm](https://github.com/glpi-project/glpi-agent/blob/develop/lib/GLPI/Agent/Task/Inventory/Win32/Memory.pm)、[Generic/Dmidecode.pm](https://github.com/glpi-project/glpi-agent/blob/develop/lib/GLPI/Agent/Task/Inventory/Generic/Dmidecode.pm)、[Videos.pm](https://github.com/glpi-project/glpi-agent/blob/develop/lib/GLPI/Agent/Task/Inventory/Win32/Videos.pm)、[Storages.pm](https://github.com/glpi-project/glpi-agent/blob/develop/lib/GLPI/Agent/Task/Inventory/Win32/Storages.pm)、[许可证说明](https://github.com/glpi-project/glpi-agent/blob/develop/README.md)。
- systeminformation：[memory.js](https://github.com/sebhildebrandt/systeminformation/blob/master/lib/memory.js)、[graphics.js](https://github.com/sebhildebrandt/systeminformation/blob/master/lib/graphics.js)、[LICENSE](https://github.com/sebhildebrandt/systeminformation/blob/master/LICENSE)。
- osquery：[memory_devices.table](https://github.com/osquery/osquery/blob/master/specs/memory_devices.table)、[Windows 实现](https://github.com/osquery/osquery/blob/master/osquery/tables/system/windows/smbios_tables.cpp)、[LICENSE](https://github.com/osquery/osquery/blob/master/LICENSE)。
- LibreHardwareMonitor：[NvidiaGpu.cs](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Hardware/Gpu/NvidiaGpu.cs)、[LICENSE](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LICENSE)。
- smartmontools：[smartctl 手册源码](https://github.com/smartmontools/smartmontools/blob/main/src/smartctl.8.in)、[项目与许可证说明](https://github.com/smartmontools/smartmontools/blob/main/README.md)。
- Rust 接入：[wmi-rs README](https://github.com/ohadravid/wmi-rs/blob/main/README.md)、[wmi Cargo.toml](https://github.com/ohadravid/wmi-rs/blob/main/Cargo.toml)、[windows Cargo.toml](https://github.com/microsoft/windows-rs/blob/master/crates/libs/windows/Cargo.toml)。

上述为会随分支推进变化的官方链接；本轮获取的源码副本保存在临时审计目录。真正采用代码时应固定具体版本与提交，核对依赖许可证、编译目标及再分发要求。

## 推荐落实顺序

1. **先修边界与错误事实**：关闭上传重定向/降级、原始 JSON 保真、拒绝键冲突；修 Mac memMax、未知 IP、磁盘摘要和 CPU 空结果覆盖。补上针对真实失败模式的测试，并收敛 observation 包装/schema 5。可在本机和隔离环境完成大部分工作。
2. **再提升采集稳定性和接口可靠性**：核心探针预算/顺序、有界并发、减少 PowerShell 启动；统一探针状态、包体预检、响应验证、稳定 observationId 幂等；减少重复回传与存储。对同一台设备记录前后耗时、探针成功率与包大小。
3. **随后扩充可靠来源和部件关系**：逐步引入 wmi-rs/windows-rs；参考 GLPI/systeminformation 建立脱敏样本库；完善内存阵列、GPU 多卡、磁盘与卷/SMART、多屏拓扑。保留来源原值，无法可靠匹配则明确未知。
4. **最后执行已安排延后的平台验收**：Windows 真实硬件矩阵、权限/无电池/离线/多网卡/相同型号双显卡、安装签名更新与远端 CI。当前没有把这些标成完成。

额外加固建议：后续签名合同可绑定 HTTP method 与规范化 path，并视实际需求增加 token 到设备的授权范围。当前已有 HMAC、恒时比较、时间窗口、原子 nonce、限流、服务端重算身份与事务冲突保护；本轮没有证据把这些待加固点称为已验证的鉴权绕过。

本轮只修正文档中“请求没有 observation 外层”“完全无损”等与现有代码不符的描述；上表行为缺陷均为待处理项，没有将审计建议写成已完成修复。

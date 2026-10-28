import type { JsonRecord } from "@/type/v3";
import { formatBytes, getRecord } from "@/utils/hardwareAudit";
import type { DetailSpecRow } from "./detail";

const labels: Record<string, string> = {
  name: "名称", model: "型号", manufacturer: "品牌 / 厂商", vendor: "厂商", brand: "品牌", volumeLabel: "卷标", assetUuid: "资产 UUID", observedAt: "观测时间", kind: "内存形态",
  serial: "序列号", serialNum: "序列号", serialNumber: "序列号", partNum: "型号 / 料号",
  size: "容量", type: "类型", memoryType: "内存类型", formFactor: "规格", bank: "插槽",
  bankLabel: "内存通道标记", clockSpeed: "速度（系统报告）", configuredSpeed: "配置速度（系统报告）",
  speedUnit: "速度单位", speedSource: "速度来源", speedReported: "速度原始报告",
  ratedSpeed: "标称速度（系统报告）", dataWidth: "数据位宽", totalWidth: "总位宽",
  voltageConfigured: "配置电压", voltageMin: "最低电压", voltageMax: "最高电压", ecc: "ECC",
  configuredVoltageMv: "配置电压", minVoltageMv: "最低电压", maxVoltageMv: "最高电压",
  slots: "插槽总数", maxCapacityBytes: "最大支持容量", errorCorrection: "纠错类型代码", location: "位置代码",
  total: "总容量", free: "空闲容量", available: "可用容量", used: "已用容量",
  swapTotal: "交换区总量", swapFree: "交换区空闲", swapUsed: "交换区已用",
  cores: "逻辑处理器 / 线程数", physicalCores: "物理核心数", processors: "处理器数量",
  performanceCores: "性能核心数", efficiencyCores: "效率核心数", speed: "速度（系统报告）",
  currentFrequency: "当前频率（系统报告）", baseFrequency: "基准频率", minFrequency: "最低频率",
  maxFrequency: "最大频率（系统报告）", frequency: "频率（系统报告）", speedMax: "最大报告速度",
  speedMin: "最低报告速度", cache: "缓存", l1d: "一级数据缓存（采集原值）", l1i: "一级指令缓存（采集原值）", l2: "二级缓存", l3: "三级缓存",
  socket: "插槽", socketDesignation: "插槽名称", numberOfCores: "物理核心数", numberOfLogicalProcessors: "逻辑处理器 / 线程数",
  currentClockSpeed: "当前频率（系统报告）", maxClockSpeed: "最大频率（系统报告）", externalClock: "外部时钟",
  processorId: "处理器标识", uniqueId: "唯一标识", flags: "指令集标志", family: "系列代码",
  stepping: "步进", revision: "修订版本", virtualization: "虚拟化支持", voltage: "电压", governor: "调频策略",
  device: "设备标识", mount: "挂载点 / 盘符", fs: "文件系统设备", fsType: "文件系统",
  interfaceType: "接口类型", mediaType: "系统报告介质", firmwareRevision: "固件版本",
  pnpDeviceId: "即插即用设备标识", bytesPerSector: "每扇区字节数", smartStatus: "SMART 状态（采集时）",
  temperature: "温度（采集时）", status: "状态", deviceId: "设备标识",
  totalHeads: "磁头数（系统报告）", totalTracks: "磁道数（系统报告）", totalSectors: "扇区数",
  totalCylinders: "柱面数（系统报告）", sectorsPerTrack: "每磁道扇区数", tracksPerCylinder: "每柱面磁道数",
  vram: "显存（系统报告）", memory: "内存", vramBytes: "显存（系统报告）", driverVersion: "驱动版本",
  vramReportedBytes: "显存（旧接口报告，待核实）", vramSource: "显存来源", vramReportedSource: "旧显存接口", vramStatus: "显存采集状态", sharedSystemMemoryBytes: "可共享系统内存（非独立显存）",
  adapters: "DXGI 适配器原始信息", Description: "设备描述", VendorId: "PCI 厂商编号", SubSysId: "PCI 子系统编号", Revision: "修订版本", Flags: "适配器标记", Luid: "适配器本地标识",
  DedicatedVideoMemory: "独立显存", DedicatedSystemMemory: "专用系统内存", SharedSystemMemory: "可共享系统内存（非独立显存）", graphics_memory: "DXGI 显存查询",
  videoProcessor: "图形处理器", bus: "总线", currentResX: "当前水平像素", currentResY: "当前垂直像素",
  resolutionX: "水平像素", resolutionY: "垂直像素", currentRefreshRate: "当前刷新率", resolution: "分辨率",
  retina: "像素密度 / Retina", main: "主显示器", active: "活动状态", instanceName: "设备实例",
  yearOfManufacture: "制造年份", weekOfManufacture: "制造周次", controllers: "显卡", displays: "显示器",
  iface: "接口标识", ifaceName: "接口名称", interfaceDescription: "接口描述", ip4: "IPv4 地址", ip6: "IPv6 地址",
  ip4subnet: "IPv4 子网", ip6subnet: "IPv6 前缀", mac: "MAC 地址", macAddress: "MAC 地址",
  permanentAddress: "永久 MAC 地址", default: "默认接口", internal: "内部接口", virtual: "虚拟设备",
  operstate: "运行状态", defaultGateway: "默认网关", gateway: "网关", dnsServers: "DNS 服务器",
  dnsSuffix: "DNS 后缀", dhcp: "DHCP", mtu: "MTU", duplex: "双工模式", interfaceIndex: "接口索引",
  interfaceGuid: "接口 GUID", connectorPresent: "连接器存在", hardwareInterface: "硬件接口",
  ieee8021xAuth: "802.1X 认证", ieee8021xState: "802.1X 状态", carrierChanges: "链路变更次数",
  healthPercent: "健康度", chargePercent: "当前电量", cycleCount: "循环次数", condition: "健康状态",
  designCapacity: "设计容量", fullChargeCapacity: "满充容量", designVoltageMv: "设计电压",
  estimatedRunTimeMinutes: "估算续航", batteryStatus: "电池状态代码", chemistry: "电池化学类型代码",
  fullyCharged: "已充满", charging: "正在充电", firmwareVersion: "固件版本",
  product: "产品名称", version: "版本", sku: "SKU", assetTag: "资产标签", memSlots: "内存插槽数",
  memMax: "最大支持内存", chip: "芯片", releaseDate: "发布日期", chassisTypes: "机箱类型代码",
  arch: "架构", platform: "平台", distro: "系统名称", edition: "系统版本", kernel: "内核",
  release: "系统版本号", build: "构建号", hostname: "主机名", fqdn: "完整主机名", uefi: "UEFI 启动",
  hypervisor: "虚拟机监控器", remoteSession: "远程会话", installDate: "安装时间", lastBootTime: "最近启动时间",
  codename: "系统代号", servicepack: "服务包", codepage: "代码页", logofile: "系统图标标识",
  hardware: "硬件 UUID", os: "系统 UUID", macs: "MAC 地址列表", hardwareUuid: "硬件 UUID", uuid: "UUID",
  addresses: "全部 IP 地址", defaultRoutes: "默认路由", reason: "原因", lane: "查询分组", recordCount: "记录数量", observation_id: "采集编号",
  source: "查询来源", elapsedMs: "耗时", error: "失败代码", collector: "采集程序", schema: "数据结构",
  collected_at: "采集时间", runtime: "运行环境", hardwareProbes: "硬件查询", identityProbes: "身份查询",
  identityDiagnostics: "身份诊断", decision: "身份判断", identityTypes: "可用身份类型",
  systemUuid: "系统 UUID 状态", baseboardSerial: "主板序列号状态", baseboardManufacturer: "主板厂商状态",
  baseboardModel: "主板型号状态", processorModel: "处理器型号状态", permanentPciMacCount: "有效永久 PCI MAC 数",
  probeAttempts: "查询记录", adapterCount: "接口数量", usablePermanentPciMacCount: "可用永久 PCI MAC 数",
  audio: "音频设备", cameras: "摄像头 / 图像设备", usb: "USB 设备", printers: "打印机",
  video_controllers: "显卡来源", monitor_edid: "显示器 EDID", desktop_monitors: "系统显示器",
  batteries: "电池来源", bios: "BIOS 来源", memory_modules: "内存条来源", physical_disks: "物理盘来源",
  memory_arrays: "内存阵列来源", system: "系统", chassis: "机箱", network_configuration: "网络配置来源",
  operating_system: "操作系统来源", baseboard: "主板来源", physical_hidden: "物理网卡查询（含隐藏）",
  physical: "物理网卡查询", all_hidden: "网卡查询（含隐藏）", cim_netadapter: "CIM 网卡查询",
  SPHardwareDataType: "整机原始信息", SPMemoryDataType: "内存原始信息", SPDisplaysDataType: "图形与显示原始信息",
  SPNVMeDataType: "NVMe 原始信息", SPSerialATADataType: "SATA 原始信息", SPPowerDataType: "电源原始信息",
  SPUSBDataType: "USB 原始信息", SPAudioDataType: "音频原始信息", SPCameraDataType: "摄像头原始信息",
  SPPrintersDataType: "打印机原始信息", _name: "名称", _items: "子设备",
  security: "硬件安全", secureBoot: "安全启动", tpm: "TPM", storage: "存储健康", devices: "存储设备", health: "健康信息（采集时）",
  system_product: "整机产品信息", storage_devices: "存储设备来源", storage_health: "存储健康查询", secure_boot: "安全启动查询",
  linkSpeed: "链路速率（系统报告）", driverDescription: "驱动描述", mediaConnectionState: "介质连接状态",
  TpmPresent: "存在 TPM", TpmReady: "TPM 已就绪", TpmEnabled: "TPM 已启用", TpmActivated: "TPM 已激活", TpmOwned: "TPM 已配置",
  UEFISecureBootEnabled: "安全启动启用值", ManufacturerVersion: "厂商版本", ManufacturerIdTxt: "厂商标识", Temperature: "温度（采集时）",
  PowerOnHours: "通电小时数", Wear: "磨损指标（系统报告）", ReadErrorsTotal: "读取错误总数", WriteErrorsTotal: "写入错误总数",
  HealthStatus: "健康状态（系统报告）", OperationalStatus: "运行状态（系统报告）", MediaType: "介质类型代码", BusType: "总线类型代码",
  topology: "磁盘 / 分区 / 卷关联", partitions: "分区", diskPartitions: "物理盘与分区关系", partitionVolumes: "分区与卷关系", volumeMappings: "卷所属物理盘",
  diskDevice: "物理盘设备标识", diskDevices: "关联物理盘", partitionDevice: "分区设备标识", partitionDevices: "关联分区", volumeDevice: "逻辑卷标识",
  diskIndex: "物理盘索引（系统报告）", partitionIndex: "分区索引（系统报告）", startingOffsetBytes: "分区起始偏移", startingAddressBytes: "关联起始地址", endingAddressBytes: "关联结束地址",
  bootPartition: "启动分区", primaryPartition: "主分区", healthMappings: "健康记录设备关联", healthRecordIndex: "对应健康记录", storageUniqueId: "存储唯一标识", StorageUniqueId: "存储唯一标识",
  storageDeviceName: "对应存储设备", storageSerialNumber: "对应设备序列号", matchStatus: "关联状态",
  dxgiMatchStatus: "显卡与显存关联状态", dxgiMatchReason: "显卡关联说明", dxgiLuid: "DXGI 适配器本地标识", dxgiMatchSource: "显卡关联依据",
  desktopMatchStatus: "系统显示器关联状态", modeMatchStatus: "显示模式匹配状态", resolutionSource: "分辨率来源", refreshRateSource: "刷新率来源",
  itemErrors: "设备查询失败明细", reference: "设备定位信息",
  diagnosticRecordCount: "硬件查询诊断记录数", diagnosticCountNote: "诊断计数说明", disk_partitions: "分区查询", disk_partition_links: "物理盘与分区关联查询", partition_volume_links: "分区与卷关联查询",
  system_profiler_core: "整机与核心硬件查询", system_profiler_storage: "存储查询", system_profiler_peripherals: "外设查询",
  default_route_ipv4: "IPv4 默认路由查询", default_route_ipv6: "IPv6 默认路由查询", interface_link_states: "网卡链路查询", dns_configuration: "DNS 查询", dhcp_configuration: "DHCP 查询",
  "hw.cpufrequency": "处理器基准频率查询", "hw.cpufrequency_min": "处理器最低频率查询", "hw.cpufrequency_max": "处理器最高频率查询", "hw.perflevel0.physicalcpu": "性能核心查询", "hw.perflevel1.physicalcpu": "效率核心查询",
  FriendlyName: "设备名称", SerialNumber: "序列号", FirmwareVersion: "固件版本", Size: "容量", DeviceId: "设备编号",
};

const byteFields = new Set(["size", "total", "free", "available", "used", "swapTotal", "swapFree", "swapUsed", "maxCapacityBytes", "vram", "vramBytes", "vramReportedBytes", "sharedSystemMemoryBytes", "DedicatedVideoMemory", "DedicatedSystemMemory", "SharedSystemMemory", "l2", "l3"]);
const frequencyFields = new Set(["clockSpeed", "configuredSpeed", "ratedSpeed", "currentFrequency", "baseFrequency", "minFrequency", "maxFrequency", "frequency", "currentClockSpeed", "maxClockSpeed", "externalClock"]);
const statuses: Record<string, string> = { budget_exhausted: "采集预算已用尽", output_too_large: "输出超过大小限制", permission_denied: "权限不足", unsupported: "系统不支持", not_present: "未发现设备", no_records: "未返回记录", missing_result: "该子查询未返回结果", invalid_json: "返回格式无效", command_failed: "查询进程失败", ok: "成功", empty: "未返回记录", failed: "查询失败", query_timeout: "查询超时", query_failed: "查询失败", item_query_failed: "设备明细查询失败", ready: "可用", needs_review: "需核对", valid: "有效", missing: "缺失", invalid_placeholder: "无效占位值" };

const relationStatuses: Record<string, string> = {
  complete: "关联查询完整，已返回关系均可解析", partial: "部分完成（信息不完整）", unavailable: "未取得关联信息",
  matched: "已唯一关联", unmapped: "未能关联", ambiguous: "关联不唯一，无法确认",
  duplicate_identifier: "设备标识重复或分区归属冲突", source_unavailable: "关联来源查询未完成", unsupported_mount_path: "此挂载路径未提供可用的系统关联", no_association: "系统未返回可解析的关联",
  ambiguous_instance_match: "同型号或相同 PCI 标识对应多个设备，未分配显存", non_pci_device: "无可用于 DXGI 匹配的完整 PCI 标识", no_instance_match: "未找到唯一对应的 DXGI 适配器",
  single_pair_fallback: "单显卡单显示器模式回退", reported: "系统直接报告",
};

export const collectedFieldLabel = (key: string) => Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;

const isEmptyScalar = (value: unknown) => value === null || value === undefined || (typeof value === "string" && !value.trim());

const valueText = (key: string, value: unknown, speedUnit?: string): string => {
  if (isEmptyScalar(value)) return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    if (key === "healthRecordIndex") return `第 ${value + 1} 条健康记录`;
    if (["startingOffsetBytes", "startingAddressBytes", "endingAddressBytes"].includes(key)) return `${value.toLocaleString("en-US")} 字节`;
    if (key === "vramReportedBytes") return `${value.toLocaleString("en-US")} 字节（32 位旧接口值，不能确认实际显存）`;
    if (byteFields.has(key)) return value > 0 ? formatBytes(value) : "0 B";
    if (["clockSpeed", "configuredSpeed", "ratedSpeed"].includes(key)) return value > 0 ? `${value} ${speedUnit || "（单位未记录）"}` : "未提供";
    if (frequencyFields.has(key)) return value > 0 ? `${value} MHz` : "未提供";
    if (["healthPercent", "chargePercent"].includes(key)) return `${value}%`;
    if (key === "currentRefreshRate") return `${value} Hz`;
    if (key === "elapsedMs") return `${value} ms`;
    if (["designCapacity", "fullChargeCapacity"].includes(key)) return `${value} mWh`;
    if (["designVoltageMv", "configuredVoltageMv", "minVoltageMv", "maxVoltageMv"].includes(key)) return `${value} mV`;
    if (["voltageConfigured", "voltageMin", "voltageMax"].includes(key)) return `${value} V`;
    if (key === "estimatedRunTimeMinutes") return `${value} 分钟`;
  }
  if (typeof value === "string" && ["status", "reason", "matchStatus", "dxgiMatchStatus", "dxgiMatchReason", "desktopMatchStatus", "modeMatchStatus"].includes(key) && Object.prototype.hasOwnProperty.call(relationStatuses, value)) return relationStatuses[value];
  if (typeof value === "string" && ["status", "error", "reason", "decision", "systemUuid", "baseboardSerial", "baseboardManufacturer", "baseboardModel", "processorModel"].includes(key)) return Object.prototype.hasOwnProperty.call(statuses, value) ? statuses[value] : value;
  if (key === "source" && typeof value === "string") return collectedFieldLabel(value);
  if (key === "vramStatus") return value === "verified_source" ? "已取得 DXGI 专用显存" : value === "unverified_32bit" ? "旧接口为 32 位，容量可能截断；需重新采集核实" : String(value);
  if (key === "manufacturer" && typeof value === "string" && /^(?:0x)?[0-9a-f]{4,8}$/i.test(value)) return `厂商代码 ${value}`;
  if (key === "kind") return value === "unified" ? "统一内存" : value === "dimm" ? "内存模块" : value === "unknown" ? "未知" : String(value);
  return String(value);
};

/** Render every leaf, including unknown fields and meaningful false/zero values. */
export const collectedFieldRows = (value: unknown, prefix: string, group: string): DetailSpecRow[] => {
  const rows: DetailSpecRow[] = [];
  const visit = (item: unknown, path: string, label: string, currentGroup: string, key: string, speedUnit?: string) => {
    if (Array.isArray(item)) {
      if (!item.length) rows.push({ key: path, group: currentGroup, attribute: label, value: "无记录", empty: true });
      else if (item.every((child) => child === null || typeof child !== "object")) rows.push({ key: path, group: currentGroup, attribute: label, value: item.map((child) => valueText(key, child, speedUnit)).join("、"), empty: item.every(isEmptyScalar) });
      else item.forEach((child, index) => visit(child, `${path}-${index}`, `${label} ${index + 1}`, `${currentGroup} · ${label} ${index + 1}`, key));
    } else if (item && typeof item === "object") {
      const entries = Object.entries(getRecord(item));
      if (!entries.length) rows.push({ key: path, group: currentGroup, attribute: label, value: "无可用明细", empty: true });
      entries.forEach(([field, child]) => visit(child, `${path}-${field}`, collectedFieldLabel(field), typeof child === "object" && child !== null ? `${currentGroup} · ${collectedFieldLabel(field)}` : currentGroup, field, typeof getRecord(item).speedUnit === "string" ? String(getRecord(item).speedUnit) : undefined));
    } else rows.push({ key: path, group: currentGroup, attribute: label, value: valueText(key, item, speedUnit), empty: isEmptyScalar(item) });
  };
  visit(value, prefix, "信息", group, "");
  return rows;
};

export const withoutFields = (record: JsonRecord, keys: string[]) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

import type { Asset, InventorySettings } from "@/type/v3";
import {
  assetHardwareContext,
  firstText,
  formatBytes,
  getArray,
  getRecord,
  hardwareSummary,
  hardwareMemoryModules,
  hardwareMemoryBytes,
  hardwareDiskRecords,
  isDiskVolume,
  toNumber,
} from "@/utils/hardwareAudit";
import { collectedFieldRows, withoutFields } from "./collectedFields";
import { assetUpdateTimeText, effectiveFinancialResidualValue } from "@/pages/shared/finance";
import {
  computerDeviceType,
  fieldText,
  formatMoney,
  statusLabel,
} from "@/pages/shared/presentation";

export const renderJsonBlock = (value: unknown) => (
  <pre className="npcink-v3-json">
    {JSON.stringify(value || {}, null, 2)}
  </pre>
);

export interface FieldSourceRow {
  key: string;
  label: string;
  standard: string;
  manual: string;
  latest: string;
}

export const normalizeFieldSourceText = (value: string) => value.replace(/\s+/g, " ").trim();

export const fieldSourceCellClassName = (
  value: string,
  role: "label" | "standard" | "manual" | "latest",
  row?: FieldSourceRow
) => {
  const classes = ["npcink-v3-field-source-cell", `is-${role}`];
  if (value === "-") {
    classes.push("is-empty");
  }
  if (
    role === "latest" &&
    row &&
    value !== "-" &&
    row.standard !== "-" &&
    normalizeFieldSourceText(value) !== normalizeFieldSourceText(row.standard)
  ) {
    classes.push("is-different");
  }
  return classes.join(" ");
};

export interface DetailSpecRow {
  key: string;
  attribute: string;
  value: string;
  group?: string;
  empty?: boolean;
}

export interface DetailSpecSection {
  key: string;
  label: string;
  rows: DetailSpecRow[];
}

export const detailRow = (key: string, attribute: string, value: unknown): DetailSpecRow | null => {
  const text = fieldText(value);
  return text === "-" ? null : { key, attribute, value: text };
};

export const detailRows = (...rows: Array<DetailSpecRow | null>) => rows.filter(Boolean) as DetailSpecRow[];

const detailSectionGroups = [
  { key: "asset", label: "资产", members: ["asset"] },
  { key: "processor", label: "处理器", members: ["processor"] },
  { key: "memory", label: "内存", members: ["memory"] },
  { key: "storage", label: "存储", members: ["disk", "volumes", "storage"] },
  { key: "graphics", label: "图形与显示", members: ["graphics", "display"] },
  { key: "devices", label: "网络与外设", members: ["network", "peripherals"] },
  { key: "system", label: "系统与固件", members: ["system", "os", "baseboard", "bios", "chassis", "battery", "security", "uuid"] },
  { key: "diagnostics", label: "采集诊断", members: ["collection", "platform", "additional"] },
];

/** Merge navigation categories while preserving component headings and every field. */
export const groupDetailSections = (sections: DetailSpecSection[]): DetailSpecSection[] => {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const assigned = new Set(detailSectionGroups.flatMap((group) => group.members));
  return detailSectionGroups.map(({ key, label, members }) => {
    const sources = members.flatMap((member) => {
      const section = byKey.get(member);
      return section ? [section] : [];
    });
    if (key === "diagnostics") sources.push(...sections.filter((section) => !assigned.has(section.key)));
    return { key, label, rows: sources.flatMap((section) => section.rows.map((row) => ({ ...row, group: row.group || section.label }))) };
  });
};

export const visibleDetailSections = (sections: DetailSpecSection[], showEmpty = false): DetailSpecSection[] =>
  showEmpty ? sections : sections.map((section) => ({ ...section, rows: section.rows.filter((row) => !row.empty) })).filter((section) => section.rows.length > 0);

export const hardwareDetailSections = (
  asset: Asset,
  context: ReturnType<typeof assetHardwareContext>,
  settings?: InventorySettings
): DetailSpecSection[] => {
  const hardware = context.hardware;
  const summary = context.summary;
  const memoryRecord = getRecord(hardware.memory);
  const modules = hardwareMemoryModules(hardware);
  const memoryRecords = [memoryRecord.modules, hardware.memory, hardware.mem, hardware.memLayout].map(getArray).find((items) => items.length) || [];
  const unclassifiedMemory = memoryRecords.filter((item) => !modules.includes(item));
  const allDisks = hardwareDiskRecords(hardware);
  const disks = allDisks.filter((disk) => !isDiskVolume(disk));
  const volumes = getArray(hardware.volumes).length ? getArray(hardware.volumes) : allDisks.filter(isDiskVolume);
  const arrays = getArray(memoryRecord.arrays);
  const slotsKnown = arrays.length > 0 && arrays.every((item) => toNumber(item.slots) > 0);
  const slots = arrays.reduce((total, item) => total + toNumber(item.slots), 0);
  const unified = memoryRecord.kind === "unified";
  const collection = getRecord(hardware.collection);
  const probes = getArray(collection.hardwareProbes);
  const macGroups: Record<string, string> = {
    SPHardwareDataType: "system_profiler_core", SPMemoryDataType: "system_profiler_core",
    SPDisplaysDataType: "system_profiler_core", SPPowerDataType: "system_profiler_core",
    SPNVMeDataType: "system_profiler_storage", SPSerialATADataType: "system_profiler_storage",
    SPUSBDataType: "system_profiler_peripherals", SPAudioDataType: "system_profiler_peripherals",
    SPCameraDataType: "system_profiler_peripherals", SPPrintersDataType: "system_profiler_peripherals",
  };
  const statusRows = (sectionKey: string, sources: string[]): DetailSpecRow[] => {
    // Prefer a subtype result over its process-level success. Failed groups have no subtype rows.
    const related = probes.filter((probe) => sources.includes(String(probe.source)) || sources.some((source) =>
      macGroups[source] === probe.source && !probes.some((child) => child.source === source)
    ));
    if (related.length) return related.flatMap((probe, index) => collectedFieldRows(probe, `status-${sectionKey}-${index}`, "采集状态"));
    return [{ key: `status-${sectionKey}`, group: "采集状态", attribute: "查询状态", value: "该观测未记录查询状态，缺失原因未知", empty: true }];
  };
  const required = (value: unknown, fields: string[]) => ({ ...Object.fromEntries(fields.map((field) => [field, null])), ...getRecord(value) });
  const section = (key: string, label: string, value: unknown, fields: string[] = [], sources: string[] = []): DetailSpecSection => ({
    key, label, rows: [
      ...collectedFieldRows(fields.length ? required(value, fields) : value, key, label),
      ...(sources.length ? statusRows(key, sources) : []),
    ],
  });
  const graphics = getRecord(hardware.graphics);
  const graphicsControllers = getArray(graphics.controllers).map((controller) => {
    // Old Windows observations used UInt32 AdapterRAM without recording its source.
    if (context.extracted.platform.toLowerCase().startsWith("win") && controller.vram != null && !controller.vramSource && controller.vramReportedBytes == null) {
      return { ...withoutFields(controller, ["vram"]), vramReportedBytes: controller.vram, vramReportedSource: "Win32_VideoController.AdapterRAM (32-bit)", vramStatus: "unverified_32bit" };
    }
    return controller;
  });
  const extraFields = withoutFields(hardware, ["cpu", "processors", "memory", "mem", "memLayout", "disks", "disk", "diskLayout", "volumes", "battery", "graphics", "baseboard", "network", "net", "bios", "chassis", "os", "system", "uuid", "hardwareUuid", "collection", "platformData", "peripherals", "storage", "security"]);
  return [
    {
      key: "asset",
      label: "资产",
      rows: detailRows(
        detailRow("asset-number", "资产编号", asset.assetNumber),
        detailRow("asset-name", "资产名称", asset.name),
        detailRow("owner", "使用人", asset.ownerName),
        detailRow("department", "部门", asset.department),
        detailRow("status", "状态", statusLabel(asset.status)),
        detailRow("category", "类型", computerDeviceType(asset.category)),
        detailRow("purchase", "购置价值", formatMoney(asset.purchasePrice)),
        detailRow("secondHandMarketValue", "二手市场价", formatMoney(asset.secondHandMarketValue)),
        detailRow("financialResidualValue", "账面净值（估算）", formatMoney(effectiveFinancialResidualValue(asset, settings))),
        detailRow("updated", "更新时间", assetUpdateTimeText(asset))
      ),
    },
    {
      key: "processor", label: "处理器", rows: [
        ...collectedFieldRows(required(hardware.cpu, ["brand", "vendor", "currentFrequency", "physicalCores", "cores"]), "cpu", "处理器"),
        ...collectedFieldRows(hardware.processors || [], "processors", "处理器插槽 / 身份"),
        ...statusRows("processor", ["processors", "SPHardwareDataType", "hw.cpufrequency", "hw.cpufrequency_min", "hw.cpufrequency_max", "hw.perflevel0.physicalcpu", "hw.perflevel1.physicalcpu"]),
      ],
    },
    {
      key: "memory", label: "内存", rows: [
        { key: "memory-total", group: "内存汇总", attribute: "总容量", value: formatBytes(hardwareMemoryBytes(asset)) || "未采集", empty: hardwareMemoryBytes(asset) <= 0 },
        { key: "memory-count", group: "内存汇总", attribute: "已识别内存条数", value: unified ? "不适用（统一内存）" : modules.length ? `${modules.length} 条` : "未知（未采集到内存条明细）", empty: !unified && !modules.length },
        { key: "memory-combination", group: "内存汇总", attribute: "容量组合", value: modules.length ? Object.entries(modules.reduce<Record<string, number>>((result, item) => { const capacity = formatBytes(item.size); result[capacity] = (result[capacity] || 0) + 1; return result; }, {})).map(([size, count]) => `${size} × ${count}`).join(" + ") : unified ? "统一内存" : "未知", empty: !unified && !modules.length },
        { key: "memory-slots", group: "内存汇总", attribute: "插槽总数", value: unified ? "不适用（统一内存）" : slotsKnown ? String(slots) : "未采集", empty: !unified && !slotsKnown },
        { key: "memory-free-slots", group: "内存汇总", attribute: "空闲插槽", value: unified ? "不适用（统一内存）" : slotsKnown && modules.length > 0 && slots >= modules.length ? String(slots - modules.length) : "无法确认", empty: !unified && !(slotsKnown && modules.length > 0 && slots >= modules.length) },
        ...modules.flatMap((item, index) => collectedFieldRows(required(item, ["size", "bank", "manufacturer", "partNum", "clockSpeed", "serialNum", "type", "formFactor"]), `memory-${index}`, `内存 ${index + 1}`)),
        ...(unclassifiedMemory.length ? collectedFieldRows(unclassifiedMemory, "memory-unclassified", "其他内存记录（不据此确认条数）") : []),
        ...collectedFieldRows(memoryRecord.system || getRecord(hardware.mem), "memory-system", "采集时系统内存"),
        ...collectedFieldRows(arrays, "memory-arrays", "内存阵列"),
        ...collectedFieldRows(withoutFields(memoryRecord, ["modules", "system", "arrays"]), "memory-extra", "其他内存信息"),
        ...statusRows("memory", ["memory_modules", "memory_arrays", "SPMemoryDataType"]),
      ],
    },
    section("battery", "电池", hardware.battery || [], [], ["batteries", "SPPowerDataType"]),
    section("graphics", "显卡", graphicsControllers, [], ["video_controllers", "graphics_memory", "SPDisplaysDataType"]),
    section("display", "显示器", graphics.displays || [], [], ["monitor_edid", "desktop_monitors"]),
    section("baseboard", "主板", hardware.baseboard, ["manufacturer", "model", "version", "serial"]),
    {
      key: "disk", label: "物理硬盘", rows: [
        { key: "disk-count", group: "物理硬盘汇总", attribute: "已识别物理硬盘", value: disks.length ? `${disks.length} 块` : "未知（未采集到物理盘明细）", empty: !disks.length },
        { key: "disk-total", group: "物理硬盘汇总", attribute: "已识别物理盘总容量", value: disks.length ? formatBytes(disks.reduce((total, item) => total + toNumber(item.size), 0)) : "未知（不能由卷容量推断）", empty: !disks.length },
        ...disks.flatMap((item, index) => collectedFieldRows(required(item, ["model", "size", "serialNum", "interfaceType", "firmwareRevision"]), `disk-${index}`, `物理硬盘 ${index + 1}`)),
        ...statusRows("disk", ["physical_disks", "SPNVMeDataType", "SPSerialATADataType"]),
      ],
    },
    {
      key: "volumes", label: "卷 / 分区", rows: [
        { key: "volumes-note", group: "卷说明", attribute: "统计口径", value: "每条记录是文件系统卷，卷数量不代表物理硬盘数量。", empty: !volumes.length },
        ...volumes.flatMap((item, index) => {
          const normalized = { ...item };
          // A filesystem name/device describes its label, never a physical model.
          if (normalized.name !== undefined) { normalized.volumeLabel = normalized.name; delete normalized.name; }
          return collectedFieldRows(normalized, `volume-${index}`, `卷 ${index + 1}`);
        }),
        ...(!volumes.length ? [{ key: "volumes-empty", group: "卷说明", attribute: "采集情况", value: "未采集到文件系统卷信息", empty: true }] : []),
      ],
    },
    section("network", "网卡", hardware.network || hardware.net || {}, [], ["network_configuration", "physical_hidden", "physical", "all_hidden", "cim_netadapter", "default_route_ipv4", "default_route_ipv6", "interface_link_states", "dns_configuration", "dhcp_configuration"]),
    section("bios", "BIOS", hardware.bios, ["vendor", "version", "serial", "releaseDate"]),
    section("chassis", "机箱", hardware.chassis, ["manufacturer", "type", "serial"]),
    {
      key: "os", label: "OS", rows: [
        { key: "os-summary", group: "操作系统", attribute: "系统摘要", value: firstText(summary.os, summary.os_label, getRecord(hardware.os).distro) || "未采集", empty: !firstText(summary.os, summary.os_label, getRecord(hardware.os).distro) },
        ...collectedFieldRows(required(hardware.os, ["platform", "arch", "kernel", "release", "hostname"]), "os", "操作系统"),
      ],
    },
    section("system", "系统", hardware.system, ["manufacturer", "model", "serial", "sku"]),
    section("uuid", "UUID", { ...getRecord(hardware.uuid), hardwareUuid: firstText(hardware.hardwareUuid, getRecord(hardware.uuid).hardware), assetUuid: asset.uuid }),
    section("peripherals", "外设", hardware.peripherals || {}, [], ["audio", "cameras", "usb", "printers", "SPUSBDataType", "SPAudioDataType", "SPCameraDataType", "SPPrintersDataType"]),
    section("storage", "存储关系与健康", hardware.storage || {}, [], ["disk_partitions", "disk_partition_links", "partition_volume_links", "storage_devices", "storage_health"]),
    section("security", "硬件安全", hardware.security || {}, [], ["secure_boot", "tpm"]),
    section("collection", "采集状态", { ...collection, ...(probes.length ? { diagnosticRecordCount: probes.length, diagnosticCountNote: "包含组级及子查询记录，数量不代表设备数" } : {}), observedAt: asset.latestObservation?.observedAt, source: asset.latestObservation?.source }),
    section("platform", "平台原始字段", hardware.platformData || {}),
    ...(Object.keys(extraFields).length || Object.keys(withoutFields(graphics, ["controllers", "displays"])).length ? [section("additional", "其他采集字段", { ...extraFields, ...withoutFields(graphics, ["controllers", "displays"]) })] : []),
  ];
};

export const fieldSourceRows = (asset: Asset, context: ReturnType<typeof assetHardwareContext>): FieldSourceRow[] => {
  const latestSummary = getRecord(asset.latestObservation?.summary);
  const latestHardware = getRecord(asset.latestObservation?.hardware);
  const latestExtracted = hardwareSummary(latestSummary, latestHardware);
  const manualRaw = getRecord(context.manualHardware.raw);
  const manualExtracted = hardwareSummary({}, manualRaw);
  const manualMemory = firstText(context.manualHardware.memory, manualExtracted.memoryLines.join("\n"));
  const latestMemory = firstText(latestExtracted.memoryLines.join("\n"), formatBytes(latestSummary.memory_bytes));

  return [
    {
      key: "assetNumber",
      label: "资产编号",
      standard: fieldText(asset.assetNumber),
      manual: "-",
      latest: "-",
    },
    {
      key: "name",
      label: "资产名称",
      standard: fieldText(asset.name),
      manual: "-",
      latest: fieldText(firstText(latestSummary.hostname, latestSummary.device_model)),
    },
    {
      key: "owner",
      label: "使用人",
      standard: fieldText(asset.ownerName),
      manual: "-",
      latest: "-",
    },
    {
      key: "department",
      label: "部门",
      standard: fieldText(asset.department),
      manual: "-",
      latest: "-",
    },
    {
      key: "status",
      label: "状态",
      standard: statusLabel(asset.status),
      manual: "-",
      latest: "-",
    },
    {
      key: "cpu",
      label: "CPU",
      standard: fieldText(context.extracted.cpu),
      manual: fieldText(firstText(context.manualHardware.cpu, manualExtracted.cpu)),
      latest: fieldText(latestExtracted.cpu),
    },
    {
      key: "graphics",
      label: "显卡",
      standard: fieldText(context.extracted.graphics),
      manual: fieldText(firstText(context.manualHardware.graphics, manualExtracted.graphics)),
      latest: fieldText(latestExtracted.graphics),
    },
    {
      key: "deviceModel",
      label: "计算机型号",
      standard: fieldText(context.extracted.deviceModel),
      manual: fieldText(manualExtracted.deviceModel),
      latest: fieldText(latestExtracted.deviceModel),
    },
    {
      key: "baseboard",
      label: "主板型号",
      standard: fieldText(context.extracted.baseboard),
      manual: fieldText(manualExtracted.baseboard),
      latest: fieldText(latestExtracted.baseboard),
    },
    {
      key: "memory",
      label: "内存",
      standard: fieldText(firstText(context.extracted.memoryLines.join("\n"), context.manualHardware.memory, formatBytes(context.summary.memory_bytes))),
      manual: fieldText(manualMemory),
      latest: fieldText(latestMemory),
    },
    {
      key: "disk",
      label: "硬盘",
      standard: fieldText(firstText(context.extracted.primaryDisk, context.manualHardware.disk, formatBytes(context.summary.disk_bytes))),
      manual: fieldText(firstText(context.manualHardware.disk, manualExtracted.primaryDisk)),
      latest: fieldText(firstText(latestExtracted.primaryDisk, formatBytes(latestSummary.disk_bytes))),
    },
    {
      key: "ip",
      label: "IP",
      standard: fieldText(context.extracted.primaryIp),
      manual: fieldText(firstText(context.manualHardware.ip, manualExtracted.primaryIp)),
      latest: fieldText(latestExtracted.primaryIp),
    },
  ];
};

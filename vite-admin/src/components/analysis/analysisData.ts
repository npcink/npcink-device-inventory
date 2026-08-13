import type { Asset, AssetObservation } from "@/type/v3";
import {
  assetHardwareContext,
  firstText,
  formatBytes,
  getArray,
  getRecord,
  hardwareDiskBytes,
  hardwareMemoryBytes,
  hardwareSummary,
  toNumber,
} from "@/utils/hardwareAudit";
import type { HardwareInventoryKey, HardwareInventoryRow, HardwareQueryItem, HardwareQueryState, HardwareTextMatchMode } from "./analysisTypes";

export const hardwareInventoryGroupKey = (value: string) => value
  .toLowerCase()
  .replace(/[®™]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const assetPhysicalDisks = (asset: Asset) => {
  const { hardware } = assetHardwareContext(asset);
  return getArray(hardware.disks).length
    ? getArray(hardware.disks)
    : getArray(hardware.disk).length
      ? getArray(hardware.disk)
      : getArray(hardware.diskLayout);
};

export const buildHardwareInventoryRows = (assets: Asset[], kind: HardwareInventoryKey): HardwareInventoryRow[] => {
  const groups = new Map<string, { label: string; detail: string; componentCount: number; assets: Map<string, Asset> }>();
  const add = (asset: Asset, label: string, detail = "") => {
    const displayLabel = label.trim();
    if (!displayLabel) return;
    const key = hardwareInventoryGroupKey(displayLabel);
    const current = groups.get(key) || { label: displayLabel, detail, componentCount: 0, assets: new Map<string, Asset>() };
    current.componentCount += 1;
    current.assets.set(asset.uuid, asset);
    if (!current.detail && detail) current.detail = detail;
    groups.set(key, current);
  };

  assets.forEach((asset) => {
    const context = assetHardwareContext(asset);
    if (kind === "cpu") {
      add(asset, context.extracted.cpu);
      return;
    }
    if (kind === "memory") {
      const bytes = hardwareMemoryBytes(asset);
      if (bytes > 0) add(asset, formatBytes(bytes), "整机总容量");
      return;
    }
    if (kind === "baseboard") {
      const board = getRecord(context.hardware.baseboard);
      const model = firstText(board.model, board.product, context.extracted.baseboard);
      const manufacturer = firstText(board.manufacturer);
      const includesManufacturer = manufacturer && model.toLowerCase().includes(manufacturer.toLowerCase());
      add(asset, includesManufacturer ? model : [manufacturer, model].filter(Boolean).join(" ") || context.extracted.baseboard);
      return;
    }
    assetPhysicalDisks(asset).forEach((disk) => {
      const model = firstText(disk.name, disk.model, disk.device);
      const media = firstText(disk.type, disk.mediaType);
      const capacity = toNumber(disk.size) > 0 ? formatBytes(disk.size) : "";
      const connection = firstText(disk.interfaceType, disk.interface);
      add(asset, model, [media, capacity, connection].filter(Boolean).join(" · "));
    });
  });

  return Array.from(groups, ([key, group]) => {
    const groupedAssets = Array.from(group.assets.values());
    return {
      key,
      label: group.label,
      detail: group.detail,
      componentCount: group.componentCount,
      assetCount: groupedAssets.length,
      percent: assets.length ? (groupedAssets.length / assets.length) * 100 : 0,
      assets: groupedAssets,
    };
  }).sort((a, b) => b.assetCount - a.assetCount || b.componentCount - a.componentCount || a.label.localeCompare(b.label, "zh-CN"));
};

export const normalizeHardwareSearchText = (value: string) => value
  .toLowerCase()
  .replace(/[®™()]/g, " ")
  .replace(/\bnvidia\b|\bgeforce\b|\bintel\b|\bcore\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const hardwareTextMatches = (value: string, terms: string[], mode: HardwareTextMatchMode) => {
  if (!terms.length) return true;
  const normalizedValue = normalizeHardwareSearchText(value);
  return terms.some((term) => {
    const normalizedTerm = normalizeHardwareSearchText(term);
    return normalizedTerm && (mode === "exact" ? normalizedValue === normalizedTerm : normalizedValue.includes(normalizedTerm));
  });
};

export const buildHardwareQueryItems = (assets: Asset[]): HardwareQueryItem[] => assets.map((asset) => {
  const context = assetHardwareContext(asset);
  return {
    asset,
    cpu: context.extracted.cpu || "",
    graphics: context.extracted.graphics || "",
    memoryGb: hardwareMemoryBytes(asset) / (1024 ** 3),
    diskGb: hardwareDiskBytes(asset) / (1024 ** 3),
  };
});

export const filterHardwareQueryItems = (items: HardwareQueryItem[], query: HardwareQueryState) => items.filter((item) => {
  if (query.departments.length && !query.departments.includes(item.asset.department || "未填写")) return false;
  if (query.statuses.length && !query.statuses.includes(item.asset.status)) return false;
  if (query.ownerMode === "assigned" && !item.asset.ownerName.trim()) return false;
  if (query.ownerMode === "unassigned" && item.asset.ownerName.trim()) return false;
  if (query.ownerKeyword.trim() && !item.asset.ownerName.toLowerCase().includes(query.ownerKeyword.trim().toLowerCase())) return false;
  if (!hardwareTextMatches(item.graphics, query.graphicsTerms, query.graphicsMode)) return false;
  if (!hardwareTextMatches(item.cpu, query.cpuTerms, query.cpuMode)) return false;
  if (query.minMemoryGb && item.memoryGb < query.minMemoryGb * 0.92) return false;
  if (query.minDiskGb && item.diskGb < query.minDiskGb * 0.92) return false;
  return true;
});

export const observationCapacityBytes = (observation: AssetObservation, kind: "memory" | "disk") => {
  const summaryKey = kind === "memory" ? "memory_bytes" : "disk_bytes";
  const summaryBytes = toNumber(observation.summary[summaryKey]);
  if (summaryBytes > 0) return summaryBytes;
  const candidates = kind === "memory"
    ? [observation.hardware.memory, observation.hardware.mem, observation.hardware.memLayout]
    : [observation.hardware.disks, observation.hardware.disk, observation.hardware.diskLayout];
  const items = candidates.map(getArray).find((value) => value.length) || [];
  return items.reduce((total, item) => total + toNumber(item.size), 0);
};

export const observationComparableFields = (observation: AssetObservation) => {
  const extracted = hardwareSummary(getRecord(observation.summary), getRecord(observation.hardware));
  const memoryBytes = observationCapacityBytes(observation, "memory");
  const diskBytes = observationCapacityBytes(observation, "disk");
  return {
    "操作系统": extracted.platform,
    "CPU": extracted.cpu,
    "内存": memoryBytes > 0 ? formatBytes(memoryBytes) : "",
    "硬盘": diskBytes > 0 ? formatBytes(diskBytes) : "",
    "主板/机型": firstText(extracted.baseboard, extracted.deviceModel),
    "显卡": extracted.graphics,
  };
};

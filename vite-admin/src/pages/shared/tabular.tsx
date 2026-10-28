import type { Asset, AssetType, JsonRecord } from "@/type/v3";
import { assetHardwareContext, firstText, formatBytes, getRecord } from "@/utils/hardwareAudit";
import { normalizeAssetStatus } from "@/pages/shared/assets";
import { DEFAULT_DEPARTMENT, isAllowedDepartment } from "@/pages/shared/departments";
import {
  assetPurchaseDateText,
  assetUpdateTimeText,
  financialResidualMode,
  isComputerAsset,
} from "@/pages/shared/finance";
import {
  ASSET_IMPORT_FIELDS,
  ASSET_TYPES,
  AssetExportColorMode,
  AssetExportFieldKey,
  AssetExportStatusColors,
  AssetImportFieldKey,
  AssetImportPreviewRow,
  AssetImportSection,
  AssetImportStrategy,
  DEFAULT_ASSET_IMPORT_SECTIONS,
} from "@/pages/shared/options";
import {
  assetTypeLabel,
  computerDeviceType,
  fieldText,
  formatDate,
  formatDateInput,
  statusLabel,
} from "@/pages/shared/presentation";

export const csvCell = (value: unknown) => {
  const text = fieldText(value).replace(/^([=+\-@])/, "'$1");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const downloadTextFile = (filename: string, text: string, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const downloadCsvFile = (filename: string, text: string) => {
  downloadTextFile(filename, `\uFEFF${text}`);
};

export const downloadBlobFile = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

export const parseTabularText = (text: string): JsonRecord[] => {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(getRecord);
    }
    if (Array.isArray(parsed.data)) {
      return parsed.data.map(getRecord);
    }
    return [getRecord(parsed)];
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<JsonRecord>((row, header, index) => {
      row[header] = cells[index] || "";
      return row;
    }, {});
  });
};

export const pickRowValue = (row: JsonRecord, keys: readonly string[]) => {
  const rowKeys = Object.keys(row);
  for (const key of keys) {
    const matchedKey = rowKeys.find((rowKey) => rowKey.toLowerCase() === key.toLowerCase());
    if (!matchedKey) {
      continue;
    }
    const value = row[matchedKey];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

export const importFieldValue = (row: JsonRecord, field: AssetImportFieldKey) => {
  const fieldConfig = ASSET_IMPORT_FIELDS.find((item) => item.value === field);
  return pickRowValue(row, [field, fieldConfig?.label || ""]);
};

export const ASSET_EXPORT_FIELDS: Array<{
  key: AssetExportFieldKey;
  label: string;
  group: "基础信息" | "财务信息" | "硬件信息" | "系统信息";
  defaultChecked?: boolean;
  value: (asset: Asset) => unknown;
}> = [
  { key: "assetNumber", label: "资产编号", group: "基础信息", defaultChecked: true, value: (asset) => asset.assetNumber },
  { key: "name", label: "资产名称", group: "基础信息", value: (asset) => asset.name },
  { key: "assetType", label: "资产类型", group: "基础信息", value: (asset) => assetTypeLabel(asset.assetType) },
  { key: "ownerName", label: "使用人", group: "基础信息", defaultChecked: true, value: (asset) => asset.ownerName },
  { key: "department", label: "部门", group: "基础信息", defaultChecked: true, value: (asset) => asset.department },
  { key: "status", label: "状态", group: "基础信息", defaultChecked: true, value: (asset) => statusLabel(asset.status) },
  { key: "category", label: "设备类型 / 分类", group: "基础信息", defaultChecked: true, value: (asset) => isComputerAsset(asset) ? computerDeviceType(asset.category) : asset.category },
  { key: "purchasePrice", label: "采购价", group: "财务信息", defaultChecked: true, value: (asset) => asset.purchasePrice },
  { key: "secondHandMarketValue", label: "二手市场价", group: "财务信息", defaultChecked: true, value: (asset) => asset.secondHandMarketValue },
  { key: "financialResidualValue", label: "账面净值（估算）", group: "财务信息", defaultChecked: true, value: (asset) => asset.financialResidualValue },
  { key: "purchaseDate", label: "购置日期", group: "财务信息", value: assetPurchaseDateText },
  { key: "cpu", label: "CPU", group: "硬件信息", defaultChecked: true, value: (asset) => assetHardwareContext(asset).extracted.cpu },
  {
    key: "memory",
    label: "内存",
    group: "硬件信息",
    value: (asset) => {
      const context = assetHardwareContext(asset);
      return firstText(context.extracted.memoryLines.join("\n"), context.manualHardware.memory, formatBytes(context.summary.memory_bytes));
    },
  },
  {
    key: "disk",
    label: "硬盘",
    group: "硬件信息",
    value: (asset) => {
      const context = assetHardwareContext(asset);
      return firstText(context.extracted.primaryDisk, context.manualHardware.disk, formatBytes(context.summary.disk_bytes));
    },
  },
  { key: "ip", label: "IP", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.primaryIp },
  { key: "graphics", label: "显卡", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.graphics },
  { key: "deviceModel", label: "计算机型号", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.deviceModel },
  { key: "baseboard", label: "主板型号", group: "硬件信息", defaultChecked: true, value: (asset) => assetHardwareContext(asset).extracted.baseboard },
  { key: "createdAt", label: "创建时间", group: "系统信息", value: (asset) => formatDate(asset.createdAt) },
  { key: "updatedAt", label: "更新时间", group: "系统信息", value: assetUpdateTimeText },
];

export const DEFAULT_ASSET_EXPORT_FIELD_KEYS = ASSET_EXPORT_FIELDS
  .filter((field) => field.defaultChecked)
  .map((field) => field.key);

export const selectedAssetExportFields = (fieldKeys: AssetExportFieldKey[]) => fieldKeys
  .map((key) => ASSET_EXPORT_FIELDS.find((field) => field.key === key))
  .filter((field): field is (typeof ASSET_EXPORT_FIELDS)[number] => Boolean(field));

export const exportableAssets = (assets: Asset[]) => assets.filter((asset) => asset.status !== "deleted");

export const assetsToCsv = (assets: Asset[], fieldKeys: AssetExportFieldKey[] = DEFAULT_ASSET_EXPORT_FIELD_KEYS) => {
  const fields = selectedAssetExportFields(fieldKeys);
  const selectedFields = fields.length ? fields : ASSET_EXPORT_FIELDS.filter((field) => field.defaultChecked);
  const headers = selectedFields.map((field) => field.label);
  const rows = assets.map((asset) => selectedFields.map((field) => field.value(asset)));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
};

export const ASSET_EXPORT_COLOR_STORAGE_KEY = "npcink-device-inventory.exportStatusColors";

export const DEFAULT_ASSET_EXPORT_STATUS_COLORS: AssetExportStatusColors = {
  active: "",
  inactive: "#e7e9ec",
  maintenance: "#ffe7ba",
  retired: "#d6e4ff",
  deleted: "#ffd6d6",
};

export const loadAssetExportStatusColors = (): AssetExportStatusColors => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ASSET_EXPORT_COLOR_STORAGE_KEY) || "{}");
    return Object.fromEntries(Object.entries(DEFAULT_ASSET_EXPORT_STATUS_COLORS).map(([status, fallback]) => {
      const candidate = typeof stored?.[status] === "string" ? stored[status] : fallback;
      return [status, candidate === "" || /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback];
    }));
  } catch {
    return { ...DEFAULT_ASSET_EXPORT_STATUS_COLORS };
  }
};

export const exportAssetWorkbook = async (
  assets: Asset[],
  fieldKeys: AssetExportFieldKey[],
  statusColors: AssetExportStatusColors,
  colorMode: AssetExportColorMode
) => {
  const { default: ExcelJS } = await import("exceljs");
  const fields = selectedAssetExportFields(fieldKeys);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Npcink Device Inventory";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("电脑设备", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = fields.map((field) => ({
    header: field.label,
    key: field.key,
    width: Math.min(42, Math.max(12, field.label.length * 2 + 4)),
  }));
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: fields.length },
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF38506A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  assets.forEach((asset) => {
    const row = worksheet.addRow(fields.map((field) => field.value(asset)));
    row.alignment = { vertical: "middle", wrapText: true };
    const fillColor = statusColors[asset.status]?.replace("#", "");
    if (fillColor) {
      const cells = colorMode === "status-cell"
        ? fields.flatMap((field, index) => field.key === "status" ? [row.getCell(index + 1)] : [])
        : Array.from({ length: fields.length }, (_, index) => row.getCell(index + 1));
      cells.forEach((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fillColor.toUpperCase()}` } };
      });
    }
    fields.forEach((field, index) => {
      const cell = row.getCell(index + 1);
      if (field.key === "purchasePrice" || field.key === "secondHandMarketValue" || field.key === "financialResidualValue") {
        cell.numFmt = '¥#,##0.00;[Red]-¥#,##0.00';
      }
    });
  });

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFD9DEE5" } },
      };
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlobFile(
    `电脑设备-${Date.now()}.xlsx`,
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
};

export const importTemplateCsv = () => {
  const headers = ASSET_IMPORT_FIELDS.map((field) => field.label);
  const example = [
    "PC-202607-001",
    "财务部台式机",
    "computer",
    "张三",
    "财务部",
    "在用",
    "台式机",
    "4500",
    "300",
    "200",
    "2026-07-03",
    "Intel Core i5",
    "16 GB",
    "512 GB SSD",
    "192.168.1.20",
    "标准模板示例，正式导入前可删除本行",
  ];
  return [headers, example].map((row) => row.map(csvCell).join(",")).join("\n");
};

export const parseNumberValue = (value: string) => {
  const normalized = value.replace(/[,，￥¥元\s]/g, "");
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? number : 0;
};

export const normalizeAssetType = (value: string): AssetType => {
  const text = value.trim();
  if (!text) {
    return "computer";
  }
  const matched = ASSET_TYPES.find((item) => item.value === text || item.label === text);
  if (matched) {
    return matched.value;
  }
  if (/电脑|pc|computer/i.test(text)) {
    return "computer";
  }
  return "custom";
};

export const manualHardwareFromImportRow = (row: JsonRecord): JsonRecord => {
  const hardware = {
    cpu: importFieldValue(row, "cpu"),
    memory: importFieldValue(row, "memory"),
    disk: importFieldValue(row, "disk"),
    ip: importFieldValue(row, "ip"),
  };
  const compact = Object.fromEntries(Object.entries(hardware).filter(([, value]) => value));
  return Object.keys(compact).length ? { ...compact, raw: compact } : {};
};

export const buildAssetImportInput = (
  row: JsonRecord,
  existing?: Asset,
  sections: AssetImportSection[] = DEFAULT_ASSET_IMPORT_SECTIONS
): AssetImportPreviewRow["input"] => {
  const includeBasic = sections.includes("basic");
  const includeFinance = sections.includes("finance");
  const includeHardware = sections.includes("hardware");
  const purchaseDate = importFieldValue(row, "purchaseDate");
  const purchasePriceText = importFieldValue(row, "purchasePrice");
  const secondHandMarketValueText = importFieldValue(row, "secondHandMarketValue");
  const financialResidualValueText = importFieldValue(row, "financialResidualValue");
  const notes = importFieldValue(row, "notes");
  const manualHardware = manualHardwareFromImportRow(row);
  const existingMetadata = getRecord(existing?.metadata);
  const purchase = {
    ...getRecord(existingMetadata.purchase),
    ...(includeFinance && purchaseDate ? { order_time: formatDateInput(purchaseDate) } : {}),
    ...(includeFinance && purchasePriceText ? { total: parseNumberValue(purchasePriceText) } : {}),
  };
  const metadata: JsonRecord = {
    ...existingMetadata,
    ...(includeFinance && Object.keys(purchase).length ? { purchase } : {}),
    ...(includeHardware && Object.keys(manualHardware).length ? { manualHardware } : {}),
    ...(includeBasic && notes ? { notes } : {}),
    finance: {
      ...getRecord(existingMetadata.finance),
      financial_residual_mode: includeFinance && financialResidualValueText
        ? "manual"
        : financialResidualMode(existing),
    },
  };
  const valueOrExisting = (field: AssetImportFieldKey, fallback = "") =>
    importFieldValue(row, field) || fallback;
  const rawAssetType = valueOrExisting("assetType", existing?.assetType || "computer");
  const assetType = normalizeAssetType(rawAssetType);
  const explicitCategory = valueOrExisting("category", existing?.category || "");
  const inferredCategory =
    assetType === "custom" && rawAssetType && !/^(?:custom|自定义)$/i.test(rawAssetType)
      ? rawAssetType
      : "";

  return {
    assetNumber: valueOrExisting("assetNumber", existing?.assetNumber || ""),
    name: includeBasic ? valueOrExisting("name", existing?.name || "") : existing?.name || "",
    assetType,
    ownerName: includeBasic ? valueOrExisting("ownerName", existing?.ownerName || "") : existing?.ownerName || "",
    department: includeBasic
      ? valueOrExisting("department", existing?.department || DEFAULT_DEPARTMENT)
      : existing?.department || DEFAULT_DEPARTMENT,
    status: includeBasic ? normalizeAssetStatus(valueOrExisting("status", existing?.status || "active")) : existing?.status || "active",
    category: includeBasic ? explicitCategory || inferredCategory : existing?.category || inferredCategory,
    purchasePrice: includeFinance && purchasePriceText ? parseNumberValue(purchasePriceText) : existing?.purchasePrice || 0,
    secondHandMarketValue: includeFinance && secondHandMarketValueText
      ? parseNumberValue(secondHandMarketValueText)
      : existing?.secondHandMarketValue || 0,
    financialResidualValue: includeFinance && financialResidualValueText
      ? parseNumberValue(financialResidualValueText)
      : existing?.financialResidualValue || 0,
    metadata,
  };
};

export const buildImportPreviewRows = (
  rows: JsonRecord[],
  existingAssets: Asset[],
  strategy: AssetImportStrategy,
  sections: AssetImportSection[],
  departmentOptions: string[] = []
): AssetImportPreviewRow[] => {
  const existingByNumber = new Map(
    existingAssets
      .filter((asset) => asset.assetNumber)
      .map((asset) => [asset.assetNumber.trim().toLowerCase(), asset])
  );
  const seenNumbers = new Set<string>();
  return rows.map((row, index) => {
    const assetNumber = importFieldValue(row, "assetNumber");
    const existing = assetNumber ? existingByNumber.get(assetNumber.trim().toLowerCase()) : undefined;
    const input = buildAssetImportInput(row, existing, sections);
    const errors: string[] = [];
    if (!assetNumber) {
      errors.push("资产编号必填");
    }
    const normalizedNumber = assetNumber.trim().toLowerCase();
    if (normalizedNumber && seenNumbers.has(normalizedNumber)) {
      errors.push("导入文件内资产编号重复");
    }
    if (normalizedNumber) {
      seenNumbers.add(normalizedNumber);
    }
    if (sections.includes("basic") && input.department && !isAllowedDepartment(departmentOptions, input.department)) {
      errors.push(`部门「${input.department}」不在设置部门列表中`);
    }
    const action = (() => {
      if (errors.length) {
        return "invalid";
      }
      if (strategy === "create-only") {
        return existing ? "skip" : "create";
      }
      if (strategy === "update-by-number") {
        return existing ? "update" : "skip";
      }
      return existing ? "update" : "create";
    })();
    return {
      key: `${index}-${assetNumber || "row"}`,
      rowNumber: index + 2,
      input,
      purchaseDate: importFieldValue(row, "purchaseDate"),
      manualHardware: manualHardwareFromImportRow(row),
      errors,
      existing,
      action,
    };
  });
};

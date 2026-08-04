import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppleFilled, DesktopOutlined, DownloadOutlined, EyeOutlined, PlusOutlined, SearchOutlined, WindowsFilled } from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { SelectProps } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { InitialAssets, RestUrl } from "@/utils/index";
import {
  archiveAsset,
  batchAssets,
  createAsset,
  createAssetEvent,
  createClientToken,
  deleteClientToken,
  getAsset,
  getAssetEvents,
  getAssetIdentities,
  getAssetObservations,
  getObservation,
  getAssets,
  getEvents,
  getSettings,
  updateClientToken,
  updateSettings,
  updateAsset,
} from "@/services/v3";
import type {
  Asset,
  AssetEvent,
  AssetEventInput,
  AssetIdentity,
  AssetInput,
  AssetListParams,
  AssetReference,
  AssetObservation,
  AssetType,
  ClientToken,
  CreatedClientToken,
  InventorySettings,
  JsonRecord,
  PaginatedResult,
} from "@/type/v3";
import {
  assetHardwareContext,
  detectHardwareIssues,
  firstText,
  formatBytes,
  getArray,
  getRecord,
  hardwareSummary,
  issueGroup,
  toNumber,
  type HardwareIssue,
} from "@/utils/hardwareAudit";
import { BackupManagementPanels, BackupRestoreModal } from "@/components/backup-management";

const { Text, Title } = Typography;

const ASSET_TYPES: Array<{ label: string; value: AssetType }> = [
  { label: "电脑", value: "computer" },
  { label: "自定义", value: "custom" },
];

const DEFAULT_CUSTOM_CATEGORIES = ["显卡", "手机", "机房设备", "网络设备", "办公设备"];

const CUSTOM_PURCHASE_PLATFORM_OPTIONS = [
  { label: "京东", value: "京东|JingDong" },
  { label: "淘宝", value: "淘宝|TaoBao" },
  { label: "闲鱼", value: "闲鱼" },
  { label: "微信", value: "微信" },
  { label: "其他", value: "About" },
];

const STATUS_OPTIONS = [
  { label: "在用", value: "active" },
  { label: "闲置", value: "inactive" },
  { label: "维护", value: "maintenance" },
  { label: "报废", value: "retired" },
  { label: "已归档", value: "deleted" },
];

const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((item) => item.value !== "deleted");

const EVENT_TYPE_OPTIONS = [
  { label: "创建", value: "created" },
  { label: "更新", value: "updated" },
  { label: "批量修改", value: "bulk_updated" },
  { label: "字段变更", value: "field_changed" },
  { label: "采集接收", value: "observation_received" },
  { label: "删除/归档", value: "deleted" },
];

const MANUAL_RECORD_OPTIONS = [
  { label: "备注", value: "note" },
  { label: "维修", value: "maintenance" },
  { label: "借用", value: "borrowed" },
  { label: "归还", value: "returned" },
  { label: "转移", value: "transferred" },
];

const ASSET_SCOPE_OPTIONS = [
  { label: "电脑资产", value: "computer" },
  { label: "其他资产", value: "other" },
  { label: "全部资产", value: "all" },
] as const;

type AssetScope = (typeof ASSET_SCOPE_OPTIONS)[number]["value"];

interface SavedAssetFilter {
  id: string;
  name: string;
  assetScope: AssetScope;
  assetType?: AssetType;
  status?: string;
  search?: string;
  category?: string;
  purchasePlatform?: string;
}

const ASSET_IMPORT_FIELDS = [
  { label: "资产编号", value: "assetNumber", required: true },
  { label: "资产名称", value: "name" },
  { label: "资产类型", value: "assetType" },
  { label: "使用人", value: "ownerName" },
  { label: "部门", value: "department" },
  { label: "状态", value: "status" },
  { label: "分类", value: "category" },
  { label: "购置价格", value: "purchasePrice" },
  { label: "残值", value: "residualValue" },
  { label: "购置日期", value: "purchaseDate" },
  { label: "CPU", value: "cpu" },
  { label: "内存", value: "memory" },
  { label: "硬盘", value: "disk" },
  { label: "IP", value: "ip" },
  { label: "备注", value: "notes" },
] as const;

type AssetImportFieldKey = (typeof ASSET_IMPORT_FIELDS)[number]["value"];
type AssetImportStrategy = "create-only" | "update-by-number" | "upsert-by-number";
type AssetImportSection = "basic" | "finance" | "hardware";
interface AssetImportPreviewRow {
  key: string;
  rowNumber: number;
  input: AssetInput;
  purchaseDate?: string;
  manualHardware: JsonRecord;
  errors: string[];
  existing?: Asset;
  action: "create" | "update" | "skip" | "invalid";
}

type AssetExportFieldKey =
  | "assetNumber"
  | "name"
  | "assetType"
  | "ownerName"
  | "department"
  | "status"
  | "category"
  | "purchasePrice"
  | "residualValue"
  | "purchaseDate"
  | "cpu"
  | "memory"
  | "disk"
  | "ip"
  | "graphics"
  | "deviceModel"
  | "baseboard"
  | "createdAt"
  | "updatedAt";

type AssetExportScope = "current-filter" | "selected" | "computer" | "custom" | "all";

const DEFAULT_ASSET_IMPORT_SECTIONS: AssetImportSection[] = ["basic", "finance", "hardware"];

const SAVED_FILTER_STORAGE_KEY = "npcink-device-inventory.savedFilters";
const WORKSPACE_TAB_STORAGE_KEY = "npcink-device-inventory.workspaceTab";
const ASSET_LAYOUT_MODE_STORAGE_KEY = "npcink-device-inventory.assetLayoutMode";

const loadStoredTab = <T extends string>(storageKey: string, allowedKeys: readonly T[], fallback: T): T => {
  try {
    const value = window.localStorage.getItem(storageKey);
    return allowedKeys.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

const saveStoredTab = (storageKey: string, value: string) => {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore private browsing or storage quota failures; tab navigation should still work.
  }
};

const statusColor: Record<string, string> = {
  active: "green",
  inactive: "default",
  maintenance: "orange",
  retired: "blue",
  deleted: "red",
};

const statusLabel = (value: string) =>
  STATUS_OPTIONS.find((item) => item.value === value)?.label || value || "-";

const assetTypeLabel = (value: string) =>
  ASSET_TYPES.find((item) => item.value === value)?.label || value || "-";

const optionLabel = (options: { label: string; value: string }[], value: string) =>
  options.find((item) => item.value === value)?.label || value || "-";

const formatDate = (value?: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
};

const parseDateValue = (value?: string) => {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`)
    : new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateInput = (value?: string) => {
  const date = parseDateValue(value);
  if (!date) {
    return value || "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatMemoryDiskText = (summary: JsonRecord, manualHardware?: JsonRecord) => {
  const memory = formatBytes(summary.memory_bytes);
  const disk = formatBytes(summary.disk_bytes);
  const manualMemory = fieldText(manualHardware?.memory);
  const manualDisk = fieldText(manualHardware?.disk);
  return `${memory !== "-" ? memory : manualMemory} / ${disk !== "-" ? disk : manualDisk}`;
};

const cpuVendorLabel = (cpu: unknown) => {
  const text = String(cpu || "");
  if (/amd|ryzen|threadripper/i.test(text)) {
    return "AMD";
  }
  if (/intel|core|celeron|pentium|xeon/i.test(text)) {
    return "Intel";
  }
  if (/apple|m[1-9]\b/i.test(text)) {
    return "Apple";
  }
  return text;
};

const formatHardwareHeroText = (
  cpu: unknown,
  summary: JsonRecord,
  manualHardware: JsonRecord,
  fallback: string
) => {
  const memoryDisk = formatMemoryDiskText(summary, manualHardware);
  const vendor = cpuVendorLabel(cpu);
  if (vendor && memoryDisk !== "- / -") {
    return `${vendor} / ${memoryDisk}`;
  }
  if (memoryDisk !== "- / -") {
    return memoryDisk;
  }
  return vendor || fallback;
};

type PlatformKind = "macos" | "windows" | "device";

interface PlatformVisual {
  kind: PlatformKind;
  label: string;
}

const resolvePlatformVisual = (...values: unknown[]): PlatformVisual => {
  const text = values
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase();
  if (/macos|mac\s*os|darwin|\bmac\b|macbook|imac|mac\s*mini|mac\s*studio|apple\s*m\d|\bm\d\s*(pro|max|ultra)?\b/i.test(text)) {
    return { kind: "macos", label: "macOS" };
  }
  if (/windows|win32|win64|\bwin\b/i.test(text)) {
    return { kind: "windows", label: "Windows" };
  }
  return { kind: "device", label: "Device" };
};

const platformIcon = (kind: PlatformKind) => {
  if (kind === "macos") {
    return <AppleFilled />;
  }
  if (kind === "windows") {
    return <WindowsFilled />;
  }
  return <DesktopOutlined />;
};

const PlatformMark = ({ visual, variant }: { visual: PlatformVisual; variant: "card" | "hero" }) => (
  <div className={`npcink-v3-platform-mark is-${variant} is-${visual.kind}`} aria-hidden="true">
    {platformIcon(visual.kind)}
  </div>
);

const countStatus = (assets: Asset[], status: string) =>
  assets.filter((asset) => asset.status === status).length;

const fetchAllAssets = async (params: AssetListParams = {}) => {
  const first = await getAssets({ ...params, page: 1, pageSize: 100 });
  const assets = [...first.data];
  const totalPages = first.pagination.totalPages || 1;
  for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
    const next = await getAssets({ ...params, page: nextPage, pageSize: 100 });
    assets.push(...next.data);
  }
  return assets;
};

const hardwareModelLabel = (value: unknown, fallback: string) => {
  const text = fieldText(value).replace(/\s+/g, " ").trim();
  if (!text || text === "-") {
    return fallback;
  }
  return text;
};

const cardBaseboardLabel = (value: unknown) => {
  const text = hardwareModelLabel(value, "-").replace(/\s*\([^)]*\)\s*$/g, "").trim();
  if (!text || text === "-") {
    return "-";
  }
  const tokens = text.split(" ");
  const chipsetIndex = tokens.findIndex((token) => /^(?:H|B|Z|X|A|Q|W)\d{3}[A-Z0-9-]*/i.test(token));
  return chipsetIndex >= 0 ? tokens.slice(chipsetIndex).join(" ") : text;
};

const cardCpuLabel = (value: unknown) => {
  const text = hardwareModelLabel(value, "-")
    .replace(/\b(?:Gen\s+)?Intel(?:\(R\)|®)?\s*/gi, "")
    .replace(/\bCore(?:\(TM\)|™)?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "-") {
    return "-";
  }
  const matched = text.match(/\b(?:i[3579]-\d{3,5}[A-Z]*|Ryzen\s+[3579]\s+\d{3,5}[A-Z]*|Apple\s+M\d(?:\s+(?:Pro|Max|Ultra))?)\b/i);
  return matched ? matched[0] : text;
};

const cardGraphicsLabel = (value: unknown) => {
  const text = hardwareModelLabel(value, "-")
    .replace(/\bNVIDIA\s+(?:GeForce\s+)?/gi, "")
    .replace(/\bIntel(?:\(R\)|®)?\s*/gi, "")
    .replace(/\bAMD\s+/gi, "")
    .replace(/\(R\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "-") {
    return "-";
  }
  const matched = text.match(/\b(?:RTX|GTX|RX|Arc)\s+[A-Z0-9 ]+\b/i);
  return matched ? matched[0].trim() : text;
};

const csvCell = (value: unknown) => {
  const text = fieldText(value).replace(/^([=+\-@])/, "'$1");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadTextFile = (filename: string, text: string, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadCsvFile = (filename: string, text: string) => {
  downloadTextFile(filename, `\uFEFF${text}`);
};

const parseCsvLine = (line: string) => {
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

const parseTabularText = (text: string): JsonRecord[] => {
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

const pickRowValue = (row: JsonRecord, keys: readonly string[]) => {
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

const importFieldValue = (row: JsonRecord, field: AssetImportFieldKey) => {
  const fieldConfig = ASSET_IMPORT_FIELDS.find((item) => item.value === field);
  return pickRowValue(row, [field, fieldConfig?.label || ""]);
};

const assetPurchaseRecord = (asset: Asset | null): JsonRecord => {
  const purchase = getRecord(getRecord(asset?.metadata).purchase);
  return Object.keys(purchase).length ? purchase : {};
};

const isComputerAsset = (asset?: Asset | null) =>
  asset?.assetType === "computer";

const assetPurchaseDateText = (asset: Asset) => {
  const purchase = getRecord(getRecord(asset.metadata).purchase);
  return firstText(purchase.order_time, asset.createdAt);
};

const assetUpdateTimeText = (asset: Asset) =>
  formatDate(asset.latestObservation?.observedAt || asset.updatedAt);

const searchHighlightKeyword = (keyword?: string) => (keyword || "").trim();

const shouldHighlightText = (text: string, keyword: string, exactShortMatch = false) => {
  if (!keyword || text === "-") {
    return false;
  }
  if (keyword.length >= 2) {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
  return exactShortMatch && text.toLowerCase() === keyword.toLowerCase();
};

const highlightText = (value: unknown, keyword?: string, exactShortMatch = false): ReactNode => {
  const text = fieldText(value);
  const normalizedKeyword = searchHighlightKeyword(keyword);
  if (!shouldHighlightText(text, normalizedKeyword, exactShortMatch)) {
    return text;
  }
  const index = text.toLowerCase().indexOf(normalizedKeyword.toLowerCase());
  if (index < 0) {
    return text;
  }
  const before = text.slice(0, index);
  const match = text.slice(index, index + normalizedKeyword.length);
  const after = text.slice(index + normalizedKeyword.length);
  return (
    <>
      {before}
      <mark className="npcink-v3-search-highlight">{match}</mark>
      {after}
    </>
  );
};

const ASSET_LIST_CACHE_PREFIX = "npcinkDeviceInventoryAssetList:";
const ASSET_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

const normalizedAssetListParams = (params: AssetListParams) => ({
  page: params.page || 1,
  pageSize: params.pageSize || 10,
  search: params.search || "",
  assetScope: params.assetScope || "computer",
  assetType: params.assetType || "",
  status: params.status || "",
  department: params.department || "",
  category: params.category || "",
  purchasePlatform: params.purchasePlatform || "",
  sortBy: params.sortBy || "latestObserved",
  includeDeleted: Boolean(params.includeDeleted),
});

const assetListCacheKey = (params: AssetListParams) =>
  `${ASSET_LIST_CACHE_PREFIX}${JSON.stringify(normalizedAssetListParams(params))}`;

const readCachedAssetList = (params: AssetListParams): PaginatedResult<Asset> | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(assetListCacheKey(params));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as { cachedAt?: number; result?: PaginatedResult<Asset> };
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > ASSET_LIST_CACHE_TTL_MS) {
      window.localStorage.removeItem(assetListCacheKey(params));
      return undefined;
    }
    return parsed.result;
  } catch {
    return undefined;
  }
};

const writeCachedAssetList = (params: AssetListParams, result: PaginatedResult<Asset>) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      assetListCacheKey(params),
      JSON.stringify({
        cachedAt: Date.now(),
        result,
      })
    );
  } catch {
    // Storage can be unavailable in private mode; the REST result remains authoritative.
  }
};

const initialAssetsForParams = (params: AssetListParams): PaginatedResult<Asset> | undefined => {
  if (!InitialAssets?.params || !InitialAssets.result) {
    return undefined;
  }
  const initialParams = normalizedAssetListParams(InitialAssets.params as AssetListParams);
  const currentParams = normalizedAssetListParams(params);
  return JSON.stringify(initialParams) === JSON.stringify(currentParams)
    ? (InitialAssets.result as PaginatedResult<Asset>)
    : undefined;
};

const plainMoneyText = (value: unknown) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) {
    return "-";
  }
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number)} 元`;
};

const customAssetInfo = (asset: Asset) => {
  const order = assetPurchaseRecord(asset);
  const quantity = firstText(order.numbers, order.quantity, order.count);
  const total = firstText(order.total, asset.purchasePrice);
  return {
    title: firstText(order.title, asset.name, asset.assetNumber, "未命名资产"),
    usage: firstText(asset.ownerName),
    number: firstText(asset.assetNumber),
    category: firstText(asset.category, assetTypeLabel(asset.assetType)),
    purpose: firstText(getRecord(asset.metadata).purpose, order.purpose),
    status: statusLabel(asset.status),
    createdAt: asset.createdAt,
    purchaser: firstText(order.purchaser),
    quantity,
    total,
    platform: firstText(order.platform),
    orderNo: firstText(order.order),
    orderTime: firstText(order.order_time),
    payMethod: firstText(order.pay_method),
    shopName: firstText(order.shop_name),
    link: firstText(order.link),
    priceText: plainMoneyText(total),
    quantityText: quantity || "-",
  };
};

const normalizeAssetStatus = (value: string) => {
  if (/闲置|停用|idle|inactive|apply/i.test(value)) {
    return "inactive";
  }
  if (/维修|维护|repair|maintenance/i.test(value)) {
    return "maintenance";
  }
  if (/退役|报废|retired/i.test(value)) {
    return "retired";
  }
  if (/归档|删除|deleted/i.test(value)) {
    return "deleted";
  }
  return "active";
};

const loadSavedFilters = (): SavedAssetFilter[] => {
  try {
    const value = window.localStorage.getItem(SAVED_FILTER_STORAGE_KEY);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => item as SavedAssetFilter) : [];
  } catch {
    return [];
  }
};

const saveFilters = (filters: SavedAssetFilter[]) => {
  window.localStorage.setItem(SAVED_FILTER_STORAGE_KEY, JSON.stringify(filters));
};

const ASSET_EXPORT_FIELDS: Array<{
  key: AssetExportFieldKey;
  label: string;
  group: "基础信息" | "财务信息" | "硬件信息" | "系统信息";
  defaultChecked?: boolean;
  value: (asset: Asset) => unknown;
}> = [
  { key: "assetNumber", label: "资产编号", group: "基础信息", defaultChecked: true, value: (asset) => asset.assetNumber },
  { key: "name", label: "资产名称", group: "基础信息", defaultChecked: true, value: (asset) => asset.name },
  { key: "assetType", label: "资产类型", group: "基础信息", defaultChecked: true, value: (asset) => assetTypeLabel(asset.assetType) },
  { key: "ownerName", label: "使用人", group: "基础信息", defaultChecked: true, value: (asset) => asset.ownerName },
  { key: "department", label: "部门", group: "基础信息", defaultChecked: true, value: (asset) => asset.department },
  { key: "status", label: "状态", group: "基础信息", defaultChecked: true, value: (asset) => statusLabel(asset.status) },
  { key: "category", label: "分类", group: "基础信息", value: (asset) => asset.category },
  { key: "purchasePrice", label: "购置价格", group: "财务信息", value: (asset) => asset.purchasePrice },
  { key: "residualValue", label: "残值", group: "财务信息", value: (asset) => asset.residualValue },
  { key: "purchaseDate", label: "购置日期", group: "财务信息", value: assetPurchaseDateText },
  { key: "cpu", label: "CPU", group: "硬件信息", defaultChecked: true, value: (asset) => assetHardwareContext(asset).extracted.cpu },
  {
    key: "memory",
    label: "内存",
    group: "硬件信息",
    defaultChecked: true,
    value: (asset) => {
      const context = assetHardwareContext(asset);
      return firstText(context.extracted.memoryLines.join("\n"), context.manualHardware.memory, formatBytes(context.summary.memory_bytes));
    },
  },
  {
    key: "disk",
    label: "硬盘",
    group: "硬件信息",
    defaultChecked: true,
    value: (asset) => {
      const context = assetHardwareContext(asset);
      return firstText(context.extracted.primaryDisk, context.manualHardware.disk, formatBytes(context.summary.disk_bytes));
    },
  },
  { key: "ip", label: "IP", group: "硬件信息", defaultChecked: true, value: (asset) => assetHardwareContext(asset).extracted.primaryIp },
  { key: "graphics", label: "显卡", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.graphics },
  { key: "deviceModel", label: "计算机型号", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.deviceModel },
  { key: "baseboard", label: "主板型号", group: "硬件信息", value: (asset) => assetHardwareContext(asset).extracted.baseboard },
  { key: "createdAt", label: "创建时间", group: "系统信息", value: (asset) => formatDate(asset.createdAt) },
  { key: "updatedAt", label: "更新时间", group: "系统信息", defaultChecked: true, value: assetUpdateTimeText },
];

const DEFAULT_ASSET_EXPORT_FIELD_KEYS = ASSET_EXPORT_FIELDS
  .filter((field) => field.defaultChecked)
  .map((field) => field.key);

const assetsToCsv = (assets: Asset[], fieldKeys: AssetExportFieldKey[] = DEFAULT_ASSET_EXPORT_FIELD_KEYS) => {
  const fields = ASSET_EXPORT_FIELDS.filter((field) => fieldKeys.includes(field.key));
  const selectedFields = fields.length ? fields : ASSET_EXPORT_FIELDS.filter((field) => field.defaultChecked);
  const headers = selectedFields.map((field) => field.label);
  const rows = assets.map((asset) => selectedFields.map((field) => field.value(asset)));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
};

const importTemplateCsv = () => {
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
    "2026-07-03",
    "Intel Core i5",
    "16 GB",
    "512 GB SSD",
    "192.168.1.20",
    "标准模板示例，正式导入前可删除本行",
  ];
  return [headers, example].map((row) => row.map(csvCell).join(",")).join("\n");
};

const parseNumberValue = (value: string) => {
  const normalized = value.replace(/[,，￥¥元\s]/g, "");
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? number : 0;
};

const normalizeAssetType = (value: string): AssetType => {
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

const manualHardwareFromImportRow = (row: JsonRecord): JsonRecord => {
  const hardware = {
    cpu: importFieldValue(row, "cpu"),
    memory: importFieldValue(row, "memory"),
    disk: importFieldValue(row, "disk"),
    ip: importFieldValue(row, "ip"),
  };
  const compact = Object.fromEntries(Object.entries(hardware).filter(([, value]) => value));
  return Object.keys(compact).length ? { ...compact, raw: compact } : {};
};

const buildAssetImportInput = (
  row: JsonRecord,
  existing?: Asset,
  sections: AssetImportSection[] = DEFAULT_ASSET_IMPORT_SECTIONS
): AssetImportPreviewRow["input"] => {
  const includeBasic = sections.includes("basic");
  const includeFinance = sections.includes("finance");
  const includeHardware = sections.includes("hardware");
  const purchaseDate = importFieldValue(row, "purchaseDate");
  const purchasePriceText = importFieldValue(row, "purchasePrice");
  const residualValueText = importFieldValue(row, "residualValue");
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
    residualValue: includeFinance && residualValueText ? parseNumberValue(residualValueText) : existing?.residualValue || 0,
    metadata,
  };
};

const buildImportPreviewRows = (
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

type BulkEditableField = "department" | "ownerName" | "status" | "category";

const BULK_EDIT_FIELDS: Array<{ key: BulkEditableField; label: string }> = [
  { key: "department", label: "部门" },
  { key: "ownerName", label: "使用人" },
  { key: "status", label: "状态" },
  { key: "category", label: "分类" },
];

type AssetLayoutMode = "compact" | "spacious";
const displayBulkValue = (field: BulkEditableField, value: unknown) => {
  if (field === "status") {
    return statusLabel(String(value || ""));
  }
  return fieldText(value);
};

const bulkUpdateChanges = (asset: Asset, input: AssetInput) =>
  BULK_EDIT_FIELDS.filter(({ key }) => Object.prototype.hasOwnProperty.call(input, key))
    .map(({ key, label }) => {
      const oldValue = displayBulkValue(key, asset[key]);
      const newValue = displayBulkValue(key, input[key]);
      return {
        field: key,
        label,
        oldValue,
        newValue,
      };
    })
    .filter((change) => change.oldValue !== change.newValue);

const buildClientTokenValue = (token: CreatedClientToken) =>
  `mda_${token.id}_${token.secret}`;

const buildClientImportConfig = (token: CreatedClientToken, uploadEndpoint: string) =>
  JSON.stringify(
    {
      uploadEndpoint,
      tokenValue: buildClientTokenValue(token),
      tokenName: token.name,
    },
    null,
    2
  );

const buildClientUploadEndpoint = (input?: string) => {
  const base = (input || RestUrl).trim().replace(/\/+$/, "");
  if (!base) {
    return "/wp-json/npcink-device-inventory/v1/device-observations";
  }
  if (base.endsWith("/device-observations")) {
    return base;
  }
  if (base.endsWith("/npcink-device-inventory/v1")) {
    return `${base}/device-observations`;
  }
  if (base.endsWith("/wp-json")) {
    return `${base}/npcink-device-inventory/v1/device-observations`;
  }
  return `${base}/wp-json/npcink-device-inventory/v1/device-observations`;
};

const buildClientSubmitCommand = (token: CreatedClientToken, uploadEndpoint: string) =>
  `npcink-device-agent submit --site "${uploadEndpoint}" --token "${buildClientTokenValue(token)}" --note "测试电脑"`;

const compactJson = (value: JsonRecord) => {
  const entries = Object.entries(value || {});
  if (entries.length === 0) {
    return "-";
  }
  return entries
    .slice(0, 6)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join("；");
};

const fieldText = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

const DEFAULT_DEPARTMENT = "未分配";

const normalizeDepartmentList = (departments: unknown) => {
  const normalized = Array.isArray(departments)
    ? departments
        .map((department) => String(department || "").trim().slice(0, 80))
        .filter(Boolean)
    : [];
  if (!normalized.includes(DEFAULT_DEPARTMENT)) {
    normalized.push(DEFAULT_DEPARTMENT);
  }
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b, "zh-CN"));
};

const departmentSelectOptions = (departments: string[]) =>
  normalizeDepartmentList(departments).map((department) => ({ label: department, value: department }));

const departmentTagRender: SelectProps<string[]>["tagRender"] = ({ label, value, closable, onClose }) => {
  const protectedDepartment = String(value) === DEFAULT_DEPARTMENT;
  return (
    <Tag
      closable={!protectedDepartment && closable}
      onClose={onClose}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      title={protectedDepartment ? "系统兜底部门，不能删除" : undefined}
    >
      {label}
    </Tag>
  );
};

const isAllowedDepartment = (departments: string[], value: unknown) => {
  const department = String(value || "").trim();
  return !department || normalizeDepartmentList(departments).includes(department);
};

const renderJsonBlock = (value: unknown) => (
  <pre className="npcink-v3-json">
    {JSON.stringify(value || {}, null, 2)}
  </pre>
);

interface FieldSourceRow {
  key: string;
  label: string;
  standard: string;
  manual: string;
  latest: string;
}

const normalizeFieldSourceText = (value: string) => value.replace(/\s+/g, " ").trim();

const fieldSourceCellClassName = (
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

interface DetailSpecRow {
  key: string;
  attribute: string;
  value: string;
}

interface DetailSpecSection {
  key: string;
  label: string;
  rows: DetailSpecRow[];
}

const detailRow = (key: string, attribute: string, value: unknown): DetailSpecRow | null => {
  const text = fieldText(value);
  return text === "-" ? null : { key, attribute, value: text };
};

const detailRows = (...rows: Array<DetailSpecRow | null>) => rows.filter(Boolean) as DetailSpecRow[];

const formatFrequency = (value: unknown) => {
  const number = toNumber(value);
  if (number <= 0) {
    return fieldText(value);
  }
  if (number >= 1000) {
    return `${Number((number / 1000).toFixed(2))} GHz`;
  }
  return `${number} MHz`;
};

const formatCount = (value: unknown) => {
  const number = toNumber(value);
  if (number <= 0 && value !== 0) {
    return fieldText(value);
  }
  return `${number} 个`;
};

const hardwareDetailSections = (
  asset: Asset,
  context: ReturnType<typeof assetHardwareContext>
): DetailSpecSection[] => {
  const hardware = context.hardware;
  const summary = context.summary;
  const cpu = getRecord(hardware.cpu);
  const graphics = getRecord(hardware.graphics);
  const controllers = getArray(graphics.controllers);
  const displays = getArray(graphics.displays);
  const baseboard = getRecord(hardware.baseboard);
  const bios = getRecord(hardware.bios);
  const os = getRecord(hardware.os);
  const system = getRecord(hardware.system);
  const chassis = getRecord(hardware.chassis);
  const uuid = getRecord(hardware.uuid);
  const net = getRecord(hardware.net);
  const network = getArray(hardware.network).length ? getArray(hardware.network) : getArray(net.adapters);
  const memory = getArray(hardware.memory).length
    ? getArray(hardware.memory)
    : getArray(hardware.mem).length
      ? getArray(hardware.mem)
      : getArray(hardware.memLayout);
  const disks = getArray(hardware.disks).length
    ? getArray(hardware.disks)
    : getArray(hardware.disk).length
      ? getArray(hardware.disk)
      : getArray(hardware.diskLayout);

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
        detailRow("category", "分类", asset.category),
        detailRow("purchase", "购置价值", formatMoney(asset.purchasePrice)),
        detailRow("residual", "残值", formatMoney(asset.residualValue)),
        detailRow("updated", "更新时间", assetUpdateTimeText(asset))
      ),
    },
    {
      key: "processor",
      label: "处理器",
      rows: detailRows(
        detailRow("cpu-maker", "制造者", firstText(cpu.manufacturer, cpu.vendor, cpuVendorLabel(context.extracted.cpu))),
        detailRow("cpu-brand", "品牌", context.extracted.cpu),
        detailRow("cpu-base", "基准频率", formatFrequency(firstText(cpu.baseFrequency, cpu.base_frequency, cpu.baseSpeed, cpu.base_speed, cpu.frequency))),
        detailRow("cpu-min", "最低频率", formatFrequency(firstText(cpu.minFrequency, cpu.min_frequency, cpu.minSpeed, cpu.min_speed))),
        detailRow("cpu-max", "最大频率", formatFrequency(firstText(cpu.maxFrequency, cpu.max_frequency, cpu.maxSpeed, cpu.max_speed))),
        detailRow("cpu-cores", "核心数", formatCount(firstText(cpu.cores, cpu.coreCount, cpu.logicalCores))),
        detailRow("cpu-physical", "物理核心", formatCount(firstText(cpu.physicalCores, cpu.physicalCoreCount))),
        detailRow("cpu-performance", "性能核心", formatCount(firstText(cpu.performanceCores, cpu.performanceCoreCount))),
        detailRow("cpu-efficient", "效率核心", formatCount(firstText(cpu.efficiencyCores, cpu.efficiencyCoreCount))),
        detailRow("cpu-processors", "处理器数量", formatCount(firstText(cpu.processors, cpu.packages, cpu.socketCount)))
      ),
    },
    {
      key: "memory",
      label: "内存",
      rows: detailRows(
        detailRow("memory-total", "总容量", firstText(formatBytes(summary.memory_bytes), context.manualHardware.memory)),
        ...memory.flatMap((item, index) => [
          detailRow(`memory-${index}-size`, `内存 ${index + 1} 容量`, formatBytes(item.size)),
          detailRow(`memory-${index}-clock`, `内存 ${index + 1} 频率`, formatFrequency(firstText(item.clockSpeed, item.clock))),
          detailRow(`memory-${index}-type`, `内存 ${index + 1} 类型`, firstText(item.type, item.memoryType)),
        ])
      ),
    },
    {
      key: "graphics",
      label: "显卡",
      rows: detailRows(
        detailRow("graphics-main", "主显卡", context.extracted.graphics),
        ...controllers.flatMap((item, index) => [
          detailRow(`gpu-${index}-model`, `显卡 ${index + 1} 型号`, firstText(item.model, item.name)),
          detailRow(`gpu-${index}-memory`, `显卡 ${index + 1} 显存`, formatBytes(firstText(item.memory, item.vram, item.vramBytes))),
          detailRow(`gpu-${index}-vendor`, `显卡 ${index + 1} 厂商`, firstText(item.vendor, item.manufacturer)),
        ])
      ),
    },
    {
      key: "display",
      label: "显示器",
      rows: detailRows(
        detailRow("display-main", "当前显示", context.extracted.display),
        detailRow("display-model", "显示器型号", context.extracted.displayModel),
        ...displays.flatMap((item, index) => [
          detailRow(`display-${index}-resolution`, `显示器 ${index + 1} 分辨率`, `${fieldText(item.currentResX || item.resolutionX)} x ${fieldText(item.currentResY || item.resolutionY)}`),
          detailRow(`display-${index}-rate`, `显示器 ${index + 1} 刷新率`, item.currentRefreshRate ? `${item.currentRefreshRate} 赫兹` : ""),
        ])
      ),
    },
    {
      key: "baseboard",
      label: "主板",
      rows: detailRows(
        detailRow("baseboard-model", "型号", context.extracted.baseboard),
        detailRow("baseboard-maker", "制造商", firstText(baseboard.manufacturer, baseboard.vendor)),
        detailRow("baseboard-serial", "序列号", firstText(baseboard.serial, baseboard.serialNumber)),
      ),
    },
    {
      key: "disk",
      label: "硬盘",
      rows: detailRows(
        detailRow("disk-total", "总容量", firstText(formatBytes(summary.disk_bytes), context.manualHardware.disk)),
        ...disks.flatMap((item, index) => [
          detailRow(`disk-${index}-name`, `硬盘 ${index + 1} 名称`, firstText(item.name, item.device, item.model)),
          detailRow(`disk-${index}-size`, `硬盘 ${index + 1} 容量`, formatBytes(item.size)),
          detailRow(`disk-${index}-serial`, `硬盘 ${index + 1} 序列号`, firstText(item.serialNum, item.serial, item.serialNumber)),
        ])
      ),
    },
    {
      key: "network",
      label: "网卡",
      rows: detailRows(
        detailRow("network-ip", "IP 地址", firstText(context.extracted.primaryIp, context.manualHardware.ip)),
        detailRow("network-gateway", "默认网关", firstText(net.defaultGateway, net.gateway)),
        ...network.flatMap((item, index) => [
          detailRow(`network-${index}-name`, `网卡 ${index + 1} 名称`, firstText(item.name, item.iface, item.adapterName)),
          detailRow(`network-${index}-mac`, `网卡 ${index + 1} MAC`, firstText(item.mac, item.macAddress)),
          detailRow(`network-${index}-ip`, `网卡 ${index + 1} IP`, firstText(item.ip4, item.ip, item.address)),
        ])
      ),
    },
    {
      key: "bios",
      label: "BIOS",
      rows: detailRows(
        detailRow("bios-vendor", "制造商", firstText(bios.vendor, bios.manufacturer)),
        detailRow("bios-version", "版本", bios.version),
        detailRow("bios-release", "发布日期", firstText(bios.releaseDate, bios.date)),
      ),
    },
    {
      key: "chassis",
      label: "机箱",
      rows: detailRows(
        detailRow("chassis-maker", "制造商", firstText(chassis.manufacturer, chassis.vendor)),
        detailRow("chassis-model", "型号", firstText(chassis.model, chassis.type)),
        detailRow("chassis-serial", "序列号", firstText(chassis.serial, chassis.serialNumber)),
      ),
    },
    {
      key: "os",
      label: "OS",
      rows: detailRows(
        detailRow("os-platform", "平台", firstText(summary.platform, os.platform)),
        detailRow("os-label", "系统版本", firstText(summary.os_label, os.distro, os.release)),
        detailRow("os-kernel", "内核", os.kernel),
        detailRow("os-arch", "架构", os.arch),
      ),
    },
    {
      key: "system",
      label: "系统",
      rows: detailRows(
        detailRow("system-model", "计算机型号", context.extracted.deviceModel),
        detailRow("system-maker", "制造商", firstText(system.manufacturer, system.vendor)),
        detailRow("system-hostname", "主机名", summary.hostname),
        detailRow("system-serial", "序列号", firstText(system.serial, system.serialNumber)),
      ),
    },
    {
      key: "uuid",
      label: "UUID",
      rows: detailRows(
        detailRow("uuid-hardware", "硬件 UUID", firstText(uuid.hardware, uuid.uuid, uuid.machine, uuid.os)),
        detailRow("uuid-asset", "资产 UUID", asset.uuid),
      ),
    },
  ];
};

const fieldSourceRows = (asset: Asset, context: ReturnType<typeof assetHardwareContext>): FieldSourceRow[] => {
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

interface AutoChangeRow {
  key: string;
  option: string;
  oldValue: string;
  newValue: string;
  time: string;
}

const AUTO_RECORD_FIELDS: Record<string, string> = {
  name: "姓名",
  owner: "姓名",
  ownerName: "姓名",
  owner_name: "姓名",
  state: "设备状态",
  status: "设备状态",
  number: "设备编号",
  assetNumber: "设备编号",
  asset_number: "设备编号",
  department: "部门",
  ip: "IP",
  primary_ip: "IP",
  primaryIp: "IP",
  purchase: "采购价",
  purchasePrice: "采购价",
  purchase_price: "采购价",
  depreciation: "二手价",
  residualValue: "二手价",
  residual_value: "二手价",
};

const normalizeAutoRecordField = (fieldName: string) => {
  const normalized = String(fieldName || "").split(".").pop() || "";
  return AUTO_RECORD_FIELDS[normalized] || "";
};

const formatAutoRecordValue = (option: string, value: unknown) => {
  const text = fieldText(value);
  if (text === "-") {
    return "-";
  }
  if (option === "设备状态") {
    return statusLabel(normalizeAssetStatus(text));
  }
  return text;
};

const isAutoChangeRow = (row: AutoChangeRow | null): row is AutoChangeRow => Boolean(row);

const automaticChangeRows = (events: AssetEvent[], search: string): AutoChangeRow[] => {
  const keyword = search.trim().toLowerCase();
  return events
    .filter((event) => event.eventSource !== "manual")
    .map((event) => {
      const option = normalizeAutoRecordField(event.fieldName);
      if (!option) {
        return null;
      }
      const oldValue = formatAutoRecordValue(option, event.oldValue);
      const newValue = formatAutoRecordValue(option, event.newValue);
      if (oldValue === newValue) {
        return null;
      }
      return {
        key: String(event.id),
        option,
        oldValue,
        newValue,
        time: event.createdAt,
      };
    })
    .filter(isAutoChangeRow)
    .filter((row) => {
      if (!keyword) {
        return true;
      }
      const text = `${row.option} ${row.oldValue} ${row.newValue} ${formatDate(row.time)}`.toLowerCase();
      return text.includes(keyword);
    })
    .sort((a, b) => new Date(b.time.replace(" ", "T")).getTime() - new Date(a.time.replace(" ", "T")).getTime()) as AutoChangeRow[];
};

const manualEventTypeLabel = (eventType: string) =>
  MANUAL_RECORD_OPTIONS.find((option) => option.value === eventType)?.label || "手动记录";

const manualRecordOperator = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.operatorName || event.actorName);
};

const manualRecordItem = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.changeItem || payload.targetDepartment || manualEventTypeLabel(event.eventType));
};

const changeActorName = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.operatorName || event.actorName || "系统");
};

const changeTypeLabel = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  const manualItem = fieldText(payload.changeItem);
  if (manualItem !== "-") {
    return manualItem;
  }
  const fieldLabel = normalizeAutoRecordField(event.fieldName);
  if (fieldLabel) {
    return fieldLabel;
  }
  if (event.eventType === "manual_change") {
    return "手动";
  }
  if (event.eventType === "bulk_updated") {
    return "批量";
  }
  if (event.eventType === "observation_received") {
    return "采集";
  }
  return optionLabel(EVENT_TYPE_OPTIONS, event.eventType);
};

const changeContentText = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  const changedFields = getArray(payload.changedFields)
    .map((item) => getRecord(item))
    .map((item) => fieldText(item.label || item.field || item.name))
    .filter((item) => item !== "-");
  if (changedFields.length) {
    return `批量修改：${changedFields.join("、")}`;
  }

  if (event.oldValue || event.newValue) {
    const type = changeTypeLabel(event);
    return `${type}：${fieldText(event.oldValue)} -> ${fieldText(event.newValue)}`;
  }

  const messageText = fieldText(event.message);
  if (messageText !== "-") {
    return messageText
      .replace("Asset created in admin.", "后台创建资产")
      .replace("Asset created from first observation.", "首次采集创建资产")
      .replace("Observation received from client.", "客户端采集数据已接收");
  }
  return "-";
};

const changeAssetLabelParts = (asset: AssetReference | undefined) => {
  if (!asset) {
    return { name: "-", suffix: "" };
  }
  const name = fieldText(asset.name);
  const suffix = [asset.department, asset.assetNumber].filter((item) => fieldText(item) !== "-").join(" _ ");
  return { name: name || "-", suffix };
};

interface AssetFormModalProps {
  asset: Asset | null;
  open: boolean;
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

type AssetFormValues = Omit<AssetInput, "metadata"> & {
  purpose?: string;
  numbers?: number;
  purchaser?: string;
  shopName?: string;
  link?: string;
  order?: string;
  orderTime?: string;
  platform?: string;
  payMethod?: string;
};

const assetFormValuesToInput = (values: AssetFormValues, asset: Asset | null): AssetInput => {
  const metadata = getRecord(asset?.metadata);
  const existingPurchase = getRecord(metadata.purchase);
  return {
    assetType: values.assetType,
    assetNumber: values.assetNumber,
    name: values.name,
    ownerName: values.ownerName,
    department: values.department,
    status: values.status,
    category: values.category,
    purchasePrice: Number(values.purchasePrice || 0),
    residualValue: Number(values.residualValue || 0),
    metadata: {
      ...metadata,
      purpose: values.purpose || "",
      purchase: {
        ...existingPurchase,
        title: values.name || "",
        total: Number(values.purchasePrice || 0),
        numbers: Number(values.numbers || 0),
        purchaser: values.purchaser || "",
        shop_name: values.shopName || "",
        link: values.link || "",
        order: values.order || "",
        order_time: values.orderTime || "",
        platform: values.platform || "",
        pay_method: values.payMethod || "",
      },
    },
  };
};

const AssetFormModal = ({ asset, open, departmentOptions = [], onClose, onSubmit }: AssetFormModalProps) => {
  const [form] = Form.useForm<AssetFormValues>();
  const customInfo = useMemo(() => (asset ? customAssetInfo(asset) : null), [asset]);
  const showCustomFields = !asset || !isComputerAsset(asset);
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      assetType: asset?.assetType || "custom",
      assetNumber: asset?.assetNumber || "",
      name: asset?.name || "",
      ownerName: asset?.ownerName || "",
      department: asset?.department || DEFAULT_DEPARTMENT,
      category: asset?.category || "",
      status: asset?.status || "active",
      purchasePrice: asset?.purchasePrice || 0,
      residualValue: asset?.residualValue || 0,
      purpose: customInfo?.purpose || "",
      numbers: Number(customInfo?.quantity || 1) || 1,
      purchaser: customInfo?.purchaser || "",
      shopName: customInfo?.shopName || "",
      link: customInfo?.link || "",
      order: customInfo?.orderNo || "",
      orderTime: customInfo?.orderTime || "",
      platform: customInfo?.platform || "",
      payMethod: customInfo?.payMethod || "",
    });
  }, [asset, customInfo, form, open]);

  return (
    <Modal
      title={asset ? "编辑资产" : "采购信息录入"}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      width={760}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(assetFormValuesToInput(values, asset))}
        preserve={false}
        className="npcink-v3-asset-form"
      >
        {showCustomFields ? (
          <Form.Item name="assetType" hidden>
            <Input />
          </Form.Item>
        ) : null}
        <div className="npcink-v3-asset-form-section">
          <h4>设备信息</h4>
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: "请输入设备名称" }]}>
            <Input placeholder="例如：科沃顿 UPS C3K" />
          </Form.Item>
          {showCustomFields ? (
            <Form.Item name="purpose" label="设备用途">
              <Input placeholder="例如：机房备用电源" />
            </Form.Item>
          ) : null}
          <div className="npcink-v3-asset-form-grid">
            <Form.Item name="assetNumber" label="设备编号">
              <Input placeholder="留空自动生成" />
            </Form.Item>
            {!showCustomFields ? (
              <Form.Item name="assetType" label="资产类型">
                <Select options={ASSET_TYPES} />
              </Form.Item>
            ) : null}
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item
              name="department"
              label="部门"
              extra="只能选择设置中维护的部门；未选择时会归入未分配。"
              rules={[
                {
                  validator: async (_, value) => {
                    if (!isAllowedDepartment(normalizedDepartmentOptions, value)) {
                      throw new Error("请选择设置中已有的部门");
                    }
                  },
                },
              ]}
            >
              <Select
                showSearch
                options={departmentSelectOptions(normalizedDepartmentOptions)}
                placeholder="选择部门"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
            <Form.Item name="category" label="分类">
              <Input placeholder="例如：显卡、手机、机房设备" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
          </div>
        </div>

        {showCustomFields ? (
          <>
            <div className="npcink-v3-asset-form-section">
              <h4>采购信息</h4>
              <div className="npcink-v3-asset-form-grid">
                <Form.Item name="numbers" label="数量">
                  <InputNumber min={0} precision={0} className="npcink-v3-number" addonAfter="个" />
                </Form.Item>
                <Form.Item name="purchasePrice" label="总计">
                  <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
                <Form.Item name="purchaser" label="采购人员">
                  <Input placeholder="负责购买此设备的人" />
                </Form.Item>
                <Form.Item name="residualValue" label="残值">
                  <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
              </div>
            </div>

            <div className="npcink-v3-asset-form-section">
              <h4>订单信息</h4>
              <Form.Item name="shopName" label="店铺名称">
                <Input />
              </Form.Item>
              <Form.Item name="link" label="商品链接">
                <Input />
              </Form.Item>
              <div className="npcink-v3-asset-form-grid">
                <Form.Item name="order" label="单号">
                  <Input />
                </Form.Item>
                <Form.Item name="orderTime" label="时间">
                  <Input placeholder="例如：2026-06-26" />
                </Form.Item>
                <Form.Item name="platform" label="平台">
                  <Input placeholder="例如：淘宝、京东、闲鱼" />
                </Form.Item>
                <Form.Item name="payMethod" label="支付">
                  <Input placeholder="例如：支付宝、微信" />
                </Form.Item>
              </div>
            </div>
          </>
        ) : (
          <div className="npcink-v3-asset-form-grid">
            <Form.Item name="purchasePrice" label="购置价值">
              <InputNumber min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="residualValue" label="残值">
              <InputNumber min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
          </div>
        )}
      </Form>
    </Modal>
  );
};

interface AssetImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const AssetImportModal = ({ open, onClose, onImported }: AssetImportModalProps) => {
  const [rawText, setRawText] = useState("");
  const [strategy, setStrategy] = useState<AssetImportStrategy>("upsert-by-number");
  const [sections, setSections] = useState<AssetImportSection[]>(DEFAULT_ASSET_IMPORT_SECTIONS);
  const [previewRows, setPreviewRows] = useState<AssetImportPreviewRow[]>([]);
  const settingsQuery = useQuery(["v3-settings"], getSettings, { enabled: open, staleTime: 60_000 });
  const departmentOptions = useMemo(
    () => normalizeDepartmentList(settingsQuery.data?.departments || []),
    [settingsQuery.data?.departments]
  );
  const existingAssetsQuery = useQuery(["v3-assets-import-index"], () => fetchAllAssets({ assetScope: "all", includeDeleted: true }), {
    enabled: open,
  });
  const importMutation = useMutation(
    async (rows: AssetImportPreviewRow[]) => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const row of rows) {
        if (row.action === "create") {
          await createAsset(row.input);
          created += 1;
        } else if (row.action === "update" && row.existing) {
          await updateAsset(row.existing.uuid, row.input);
          updated += 1;
        } else {
          skipped += 1;
        }
      }
      return { created, updated, skipped };
    },
    {
      onSuccess: (result) => {
        message.success(`导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`);
        setRawText("");
        setPreviewRows([]);
        onImported();
        onClose();
      },
    }
  );

  const parseSource = (text = rawText) => {
    try {
      const rows = buildImportPreviewRows(parseTabularText(text), existingAssetsQuery.data || [], strategy, sections, departmentOptions);
      setPreviewRows(rows);
      if (!rows.length) {
        message.warning("没有识别到可导入的数据");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "解析失败");
    }
  };

  return (
    <Modal
      title="资产表格导入"
      open={open}
      onCancel={onClose}
      width={980}
      className="npcink-v3-import-modal"
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="preview" onClick={() => parseSource()}>
          生成预览
        </Button>,
        <Button
          key="import"
          type="primary"
          disabled={!previewRows.some((row) => row.action === "create" || row.action === "update")}
          loading={importMutation.isLoading}
          onClick={() => importMutation.mutate(previewRows)}
        >
          导入可执行数据
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
        <Alert
          type="info"
          showIcon
          message="只支持标准资产 CSV"
          description="请先下载模板填写。导入以资产编号为匹配键，可选择仅新增、仅更新，或按编号新增/更新。"
        />
        <Space wrap>
          <Button onClick={() => downloadCsvFile(`asset-import-template-${Date.now()}.csv`, importTemplateCsv())}>
            下载导入模板
          </Button>
          <Radio.Group
            value={strategy}
            onChange={(event) => {
              setStrategy(event.target.value);
              setPreviewRows([]);
            }}
            options={[
              { label: "新增或更新", value: "upsert-by-number" },
              { label: "只新增", value: "create-only" },
              { label: "只更新", value: "update-by-number" },
            ]}
          />
        </Space>
        <div>
          <Text strong>导入数据</Text>
          <Checkbox.Group
            className="npcink-v3-checkbox-row"
            value={sections}
            onChange={(values) => {
              setSections(values as AssetImportSection[]);
              setPreviewRows([]);
            }}
            options={[
              { label: "基础信息", value: "basic" },
              { label: "财务信息", value: "finance" },
              { label: "手动硬件", value: "hardware" },
            ]}
          />
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const text = String(reader.result || "");
              setRawText(text);
              parseSource(text);
            };
            reader.readAsText(file);
          }}
        />
        <Input.TextArea
          rows={6}
          value={rawText}
          onChange={(event) => {
            setRawText(event.target.value);
            setPreviewRows([]);
          }}
          placeholder="粘贴标准 CSV。第一行应使用模板表头：资产编号,资产名称,资产类型,使用人,部门,状态..."
        />
        <Table
          rowKey="key"
          size="small"
          pagination={{ pageSize: 5, showSizeChanger: false }}
          dataSource={previewRows}
          columns={[
            { title: "行号", dataIndex: "rowNumber", width: 76 },
            { title: "动作", dataIndex: "action", width: 96, render: (value) => (
              <Tag color={value === "create" ? "green" : value === "update" ? "blue" : value === "invalid" ? "red" : "default"}>
                {value === "create" ? "新增" : value === "update" ? "更新" : value === "invalid" ? "错误" : "跳过"}
              </Tag>
            ) },
            { title: "编号", render: (_, row) => fieldText(row.input.assetNumber), width: 150 },
            { title: "名称", render: (_, row) => fieldText(row.input.name) },
            { title: "使用人", render: (_, row) => fieldText(row.input.ownerName), width: 120 },
            { title: "部门", render: (_, row) => fieldText(row.input.department), width: 120 },
            { title: "状态", render: (_, row) => statusLabel(String(row.input.status || "")), width: 100 },
            {
              title: "校验",
              render: (_, row) => row.errors.length ? <Text type="danger">{row.errors.join("；")}</Text> : <Text type="secondary">通过</Text>,
            },
          ]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="先粘贴或选择文件，再生成导入预览"
              />
            ),
          }}
        />
      </Space>
    </Modal>
  );
};

interface AssetExportModalProps {
  open: boolean;
  currentScopeLabel: string;
  currentQueryParams: AssetListParams;
  currentTotal?: number;
  selectedAssets?: Asset[];
  onClose: () => void;
}

const AssetExportModal = ({
  open,
  currentScopeLabel,
  currentQueryParams,
  currentTotal,
  selectedAssets = [],
  onClose,
}: AssetExportModalProps) => {
  const [scope, setScope] = useState<AssetExportScope>("current-filter");
  const [fieldKeys, setFieldKeys] = useState<AssetExportFieldKey[]>(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) {
      setScope(selectedAssets.length ? "selected" : "current-filter");
      setFieldKeys(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
    }
  }, [open, selectedAssets.length]);

  const exportAssets = async () => {
    setExporting(true);
    try {
      const exportParams: Record<Exclude<AssetExportScope, "current-filter" | "selected">, AssetListParams> = {
        computer: { assetScope: "computer" },
        custom: { assetScope: "other" },
        all: { assetScope: "all" },
      };
      const assets = scope === "selected"
        ? selectedAssets
        : await fetchAllAssets(scope === "current-filter" ? currentQueryParams : exportParams[scope]);
      downloadCsvFile(`assets-${scope}-${Date.now()}.csv`, assetsToCsv(assets, fieldKeys));
      message.success(`已导出 ${assets.length} 条资产`);
      onClose();
    } finally {
      setExporting(false);
    }
  };
  const currentFilterCountText =
    typeof currentTotal === "number" ? `${currentTotal} 条` : "导出时计算";

  return (
    <Modal
      title="资产表格导出"
      open={open}
      onCancel={onClose}
      onOk={exportAssets}
      okText="导出 CSV"
      confirmLoading={exporting}
      width={760}
      destroyOnClose
    >
      <Space direction="vertical" size={16} className="npcink-v3-detail-stack">
        <div>
          <Text strong>导出范围</Text>
          <Text type="secondary" className="npcink-v3-export-range-note">
            符合当前筛选条件的数据，就是资产列表里筛选后的全部结果，不只是当前页。
          </Text>
          <Radio.Group
            className="npcink-v3-radio-stack"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            options={[
              {
                label: `符合当前筛选条件的数据：${currentScopeLabel}，${currentFilterCountText}`,
                value: "current-filter",
              },
              {
                label: `只导出已勾选的数据：${selectedAssets.length} 条`,
                value: "selected",
                disabled: !selectedAssets.length,
              },
              { label: "全部电脑设备", value: "computer" },
              { label: "全部自定义设备", value: "custom" },
              { label: "忽略筛选，导出全部资产", value: "all" },
            ]}
          />
        </div>
        <div>
          <Text strong>导出字段</Text>
          <div className="npcink-v3-export-fields">
            {["基础信息", "财务信息", "硬件信息", "系统信息"].map((group) => (
              <div key={group}>
                <Text type="secondary">{group}</Text>
                <Checkbox.Group
                  value={fieldKeys}
                  onChange={(values) => setFieldKeys(values as AssetExportFieldKey[])}
                  options={ASSET_EXPORT_FIELDS.filter((field) => field.group === group).map((field) => ({
                    label: field.label,
                    value: field.key,
                  }))}
                />
              </div>
            ))}
          </div>
        </div>
      </Space>
    </Modal>
  );
};

interface BulkEditModalProps {
  open: boolean;
  count: number;
  loading: boolean;
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

const BulkEditModal = ({ open, count, loading, departmentOptions = [], onClose, onSubmit }: BulkEditModalProps) => {
  const [form] = Form.useForm<AssetInput>();
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [form, open]);

  return (
    <Modal
      title="批量修改资产"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={loading}
      destroyOnClose
      width={560}
    >
      <Alert
        type="info"
        showIcon
        className="npcink-v3-secret"
        message={`将修改 ${count} 条已选资产`}
        description="留空字段不会覆盖原值；发生变化的资产会写入一条批量修改记录。"
      />
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(values) => {
          const input = Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== undefined && value !== "")
          ) as AssetInput;
          onSubmit(input);
        }}
      >
        <Form.Item
          name="department"
          label="部门"
          extra={normalizedDepartmentOptions.length ? "只能选择设置中维护的部门；留空表示不修改。" : "请先到设置 > 部门管理添加部门。"}
          rules={[
            {
              validator: async (_, value) => {
                if (!isAllowedDepartment(normalizedDepartmentOptions, value)) {
                  throw new Error("请选择设置中已有的部门");
                }
              },
            },
          ]}
        >
          <Select
            allowClear
            showSearch
            options={departmentSelectOptions(normalizedDepartmentOptions)}
            placeholder={normalizedDepartmentOptions.length ? "统一修改部门" : "暂无可选部门"}
            popupMatchSelectWidth={false}
            disabled={!normalizedDepartmentOptions.length}
            filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="ownerName" label="使用人 / 责任人">
          <Input placeholder="统一修改使用人 / 责任人" />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select allowClear options={EDITABLE_STATUS_OPTIONS} placeholder="统一修改状态" />
        </Form.Item>
        <Form.Item name="category" label="分类">
          <Input placeholder="统一修改分类" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

interface TokenModalProps {
  open: boolean;
  onClose: () => void;
}

const TokenModal = ({ open, onClose }: TokenModalProps) => {
  const [form] = Form.useForm<{ name: string }>();
  const [createdToken, setCreatedToken] = useState<CreatedClientToken | null>(null);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { enabled: open });
  const createMutation = useMutation(createClientToken, {
    onSuccess: (token) => {
      setCreatedToken(token);
      form.resetFields();
      queryClient.invalidateQueries(["v3-settings"]);
      message.success("令牌已创建，请立即保存完整授权码");
    },
  });
  const deleteMutation = useMutation(deleteClientToken, {
    onSuccess: () => {
      queryClient.invalidateQueries(["v3-settings"]);
      message.success("令牌已删除");
    },
  });
  const tokenStatusMutation = useMutation(
    ({ id, enabled }: { id: string; enabled: boolean }) => updateClientToken(id, enabled),
    {
      onSuccess: (token) => {
        queryClient.invalidateQueries(["v3-settings"]);
        message.success(token.enabled ? "令牌已启用" : "令牌已停用");
      },
    }
  );
  const tokens = settingsQuery.data?.clientTokens || [];
  const uploadEndpoint = buildClientUploadEndpoint(settingsQuery.data?.clientUploadBaseUrl || RestUrl);

  const columns: ColumnsType<ClientToken> = [
    { title: "名称", dataIndex: "name" },
    { title: "Token ID", dataIndex: "id", width: 160 },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 120,
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
      ),
    },
    {
      title: "启停",
      dataIndex: "enabled",
      width: 110,
      render: (enabled: boolean, token) => (
        <Switch
          size="small"
          checked={enabled}
          checkedChildren="启用"
          unCheckedChildren="关闭"
          loading={tokenStatusMutation.isLoading && tokenStatusMutation.variables?.id === token.id}
          onChange={(checked) => tokenStatusMutation.mutate({ id: token.id, enabled: checked })}
        />
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 180,
      render: formatDate,
    },
    {
      title: "操作",
      width: 90,
      render: (_, token) => (
        <Space size={8}>
          <Button
            size="small"
            danger
            onClick={() =>
              Modal.confirm({
                title: "确认删除这个客户端令牌？",
                content: (
                  <Space direction="vertical" size={4}>
                    <Text>删除后，使用该令牌的客户端将无法继续上传数据。</Text>
                    <Text type="secondary">Token ID：{token.id}</Text>
                  </Space>
                ),
                okText: "确认删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => deleteMutation.mutateAsync(token.id),
              })
            }
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="客户端接入"
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
    >
      <div className="npcink-v3-token-endpoint">
        <div>
          <Text strong>客户端上传地址</Text>
          <Text type="secondary">上传地址不是密钥；客户端写入权限由令牌和 HMAC 签名控制。</Text>
        </div>
        <Text copyable code>
          {uploadEndpoint}
        </Text>
      </div>
      <Form
        form={form}
        className="npcink-v3-token-form"
        onFinish={({ name }) => createMutation.mutate(name)}
      >
        <div className="npcink-v3-token-create-row">
          <Form.Item
            name="name"
            label="令牌备注"
            rules={[{ required: true, message: "请输入令牌备注" }]}
          >
            <Input placeholder="例如：财务部采集客户端" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createMutation.isLoading}>
            创建令牌
          </Button>
        </div>
      </Form>
      {createdToken ? (
        <Alert
          className="npcink-v3-secret"
          type="warning"
          showIcon
          message="密钥只在创建后显示一次"
          description={
            <Space direction="vertical" size={8} className="npcink-v3-client-snippet">
              <Text type="secondary">请立即复制桌面客户端导入配置；关闭窗口后无法再次读取密钥。</Text>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">桌面客户端导入配置</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientImportConfig(createdToken, uploadEndpoint)}
                </Text>
              </div>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">完整授权码</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientTokenValue(createdToken)}
                </Text>
              </div>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">命令行验收</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientSubmitCommand(createdToken, uploadEndpoint)}
                </Text>
              </div>
            </Space>
          }
        />
      ) : null}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={tokens}
        loading={settingsQuery.isLoading}
        pagination={false}
      />
    </Modal>
  );
};

interface ManualRecordFormProps {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
  onSubmit: (values: AssetEventInput) => Promise<unknown>;
  loading?: boolean;
}

interface ManualRecordFormValues {
  operatorName: string;
  changeItem: string;
  changeDescription: string;
}

const ManualRecordModal = ({ open, asset, onClose, onSubmit, loading }: ManualRecordFormProps) => {
  const [form] = Form.useForm<ManualRecordFormValues>();

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [form, open]);

  return (
    <Modal
      title="添加记录"
      open={open}
      okText="添加记录"
      cancelText="取消"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      width={560}
      className="npcink-v3-manual-record-modal"
    >
      <div className="npcink-v3-manual-record-form">
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ flex: "92px" }}
        wrapperCol={{ flex: "1 1 auto" }}
        colon={false}
        preserve={false}
        requiredMark
        onFinish={async (values) => {
          await onSubmit({
            eventType: "manual_change",
            message: values.changeDescription.trim(),
            payload: {
              assetNumber: asset?.assetNumber || "",
              operatorName: values.operatorName.trim(),
              changeItem: values.changeItem.trim(),
            },
          });
          form.resetFields();
        }}
      >
        <Form.Item
          name="operatorName"
          label="变更人"
          rules={[{ required: true, whitespace: true, message: "请输入变更人" }]}
        >
          <Input placeholder="操作变更同事的名字" />
        </Form.Item>
        <Form.Item
          name="changeItem"
          label="变更项目"
          rules={[{ required: true, whitespace: true, message: "请输入变更项目" }]}
        >
          <Input placeholder="变更的项目，例如硬盘、内存条等" />
        </Form.Item>
        <Form.Item
          name="changeDescription"
          label="变更说明"
          rules={[{ required: true, whitespace: true, message: "请输入变更说明" }]}
        >
          <Input.TextArea rows={3} placeholder="变更内容详情" />
        </Form.Item>
      </Form>
      </div>
    </Modal>
  );
};

interface AssetSettingsPanelProps {
  asset: Asset;
  departmentOptions?: string[];
  onUpdated: (asset: Asset) => void;
  onArchive: (asset: Asset) => void;
}

type AssetSettingsValues = AssetInput & {
  orderTime?: string;
};

const AssetSettingsPanel = ({ asset, departmentOptions = [], onUpdated, onArchive }: AssetSettingsPanelProps) => {
  const [form] = Form.useForm<AssetSettingsValues>();
  const settingsHardware = assetHardwareContext(asset);
  const primaryIp = firstText(settingsHardware.extracted.primaryIp, settingsHardware.manualHardware.ip);
  const normalizedDepartmentOptions = useMemo(
    () => normalizeDepartmentList(departmentOptions),
    [departmentOptions]
  );
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedResidualValue = Form.useWatch("residualValue", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const residualValue = Number(watchedResidualValue ?? asset.residualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((residualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const updateMutation = useMutation(
    (values: AssetSettingsValues) => {
      const metadata = getRecord(asset.metadata);
      const existingPurchase = getRecord(metadata.purchase);
      return updateAsset(asset.uuid, {
        assetNumber: values.assetNumber,
        name: values.name ?? asset.name,
        ownerName: values.ownerName,
        department: values.department,
        status: values.status,
        purchasePrice: Number(values.purchasePrice || 0),
        residualValue: Number(values.residualValue || 0),
        metadata: {
          ...metadata,
          purchase: {
            ...existingPurchase,
            order_time: values.orderTime || "",
            total: Number(values.purchasePrice || 0),
          },
        },
      });
    },
    {
      onSuccess: (updated) => {
        onUpdated(updated);
        message.success("资产设置已保存");
      },
    }
  );

  useEffect(() => {
    form.setFieldsValue({
      assetNumber: asset.assetNumber,
      name: asset.name,
      ownerName: asset.ownerName,
      department: asset.department || DEFAULT_DEPARTMENT,
      status: asset.status,
      purchasePrice: asset.purchasePrice,
      residualValue: asset.residualValue,
      orderTime: formatDateInput(assetPurchaseDateText(asset)),
    });
  }, [asset, form]);

  return (
    <div className="npcink-v3-settings-panel npcink-v3-detail-settings">
      <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
        <div className="npcink-v3-settings-section">
          <h4>基础信息</h4>
          <div className="npcink-v3-settings-grid">
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item name="assetNumber" label="编号">
              <Input />
            </Form.Item>
          </div>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item
              name="department"
              label="部门"
              extra="只能选择设置中维护的部门；未选择时会归入未分配。"
              rules={[
                {
                  validator: async (_, value) => {
                    if (!isAllowedDepartment(normalizedDepartmentOptions, value)) {
                      throw new Error("请选择设置中已有的部门");
                    }
                  },
                },
              ]}
            >
              <Select
                showSearch
                options={departmentSelectOptions(normalizedDepartmentOptions)}
                placeholder="选择部门"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item label="IP 地址">
              <Input value={primaryIp} readOnly placeholder="暂无采集 IP" />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-settings-section">
          <h4>财务参数</h4>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item name="purchasePrice" label="采购价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="residualValue" label="二手价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="orderTime" label="购置日期">
              <Input placeholder="例如：2026-06-26" />
            </Form.Item>
          </div>
          <div className="npcink-v3-finance-summary">
            <span>折旧率：{depreciationRate}%</span>
            <span>残值：{formatMoney(residualValue)}</span>
            <span>残值率：{residualRate}%</span>
          </div>
        </div>

        <div className="npcink-v3-settings-actions">
          <Button type="primary" htmlType="submit" loading={updateMutation.isLoading}>
            保存设置
          </Button>
          <Button danger type="text" onClick={() => onArchive(asset)}>
            移除设备
          </Button>
        </div>
      </Form>
    </div>
  );
};

interface CustomAssetSettingsValues {
  name?: string;
  assetNumber?: string;
  category?: string;
  status?: string;
  ownerName?: string;
  purpose?: string;
  purchasePrice?: number;
  residualValue?: number;
  numbers?: number;
  purchaser?: string;
  platform?: string;
  order?: string;
  payMethod?: string;
  orderTime?: string;
  link?: string;
}

const CUSTOM_PLATFORM_EDIT_OPTIONS = ["京东", "淘宝", "闲鱼", "微信", "支付宝", "其他"].map((value) => ({
  label: value,
  value,
}));

const CustomAssetSettingsPanel = ({ asset, onUpdated, onArchive }: AssetSettingsPanelProps) => {
  const [form] = Form.useForm<CustomAssetSettingsValues>();
  const info = useMemo(() => customAssetInfo(asset), [asset]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedResidualValue = Form.useWatch("residualValue", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const residualValue = Number(watchedResidualValue ?? asset.residualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((residualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set([...DEFAULT_CUSTOM_CATEGORIES, asset.category].map((item) => String(item || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [asset.category]
  );
  const updateMutation = useMutation(
    (values: CustomAssetSettingsValues) => {
      const metadata = getRecord(asset.metadata);
      const existingPurchase = getRecord(metadata.purchase);
      return updateAsset(asset.uuid, {
        name: values.name,
        assetNumber: values.assetNumber,
        ownerName: values.ownerName,
        status: values.status,
        category: values.category,
        purchasePrice: Number(values.purchasePrice || 0),
        residualValue: Number(values.residualValue || 0),
        metadata: {
          ...metadata,
          purpose: values.purpose || "",
          purchase: {
            ...existingPurchase,
            title: values.name || "",
            total: Number(values.purchasePrice || 0),
            numbers: Number(values.numbers || 0),
            purchaser: values.purchaser || "",
            platform: values.platform || "",
            order: values.order || "",
            pay_method: values.payMethod || "",
            order_time: values.orderTime || "",
            link: values.link || "",
          },
        },
      });
    },
    {
      onSuccess: (updated) => {
        onUpdated(updated);
        message.success("资产信息已保存");
      },
    }
  );

  useEffect(() => {
    form.setFieldsValue({
      name: info.title,
      assetNumber: info.number,
      category: info.category,
      status: asset.status,
      ownerName: info.usage,
      purpose: info.purpose,
      purchasePrice: Number(info.total || asset.purchasePrice || 0),
      residualValue: asset.residualValue,
      numbers: Number(info.quantity || 0) || undefined,
      purchaser: info.purchaser,
      platform: info.platform,
      order: info.orderNo,
      payMethod: info.payMethod,
      orderTime: info.orderTime,
      link: info.link,
    });
  }, [asset, form, info]);

  return (
    <div className="npcink-v3-custom-settings-panel">
      <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
        <div className="npcink-v3-custom-settings-section">
          <h4>基础信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="name" label="资产名称">
              <Input placeholder="例如：科沃顿UPS C3K" />
            </Form.Item>
            <Form.Item name="assetNumber" label="设备编号">
              <Input placeholder="设备编号" />
            </Form.Item>
            <Form.Item name="category" label="设备分类">
              <Select
                showSearch
                allowClear
                options={categoryOptions}
                placeholder="选择或输入分类"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
                onSearch={(value) => {
                  if (value.trim()) {
                    form.setFieldValue("category", value.trim());
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="status" label="当前状态">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item name="purpose" label="设备用途">
              <Input placeholder="例如：机房备用电源" />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-custom-settings-section">
          <h4>采购信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="purchasePrice" label="采购总价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="residualValue" label="二手价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="numbers" label="采购数量">
              <InputNumber min={0} precision={0} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="purchaser" label="采购人员">
              <Input placeholder="采购同事" />
            </Form.Item>
          </div>
          <div className="npcink-v3-finance-summary">
            <span>折旧率：{depreciationRate}%</span>
            <span>残值：{formatMoney(residualValue)}</span>
            <span>残值率：{residualRate}%</span>
          </div>
        </div>

        <div className="npcink-v3-custom-settings-section">
          <h4>订单信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="order" label="采购单号">
              <Input placeholder="订单号" />
            </Form.Item>
            <Form.Item name="platform" label="采购平台">
              <Select
                showSearch
                allowClear
                options={CUSTOM_PLATFORM_EDIT_OPTIONS}
                placeholder="选择或输入平台"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
                onSearch={(value) => {
                  if (value.trim()) {
                    form.setFieldValue("platform", value.trim());
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="payMethod" label="支付方式">
              <Input placeholder="例如：支付宝" />
            </Form.Item>
            <Form.Item name="orderTime" label="下单时间">
              <Input placeholder="例如：2024-12-27" />
            </Form.Item>
            <Form.Item name="link" label="商品链接" className="npcink-v3-custom-settings-wide">
              <Input placeholder="商品链接或备注" />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-settings-actions npcink-v3-custom-settings-actions">
          <Button type="primary" htmlType="submit" loading={updateMutation.isLoading}>
            保存信息
          </Button>
          <Button danger type="text" onClick={() => onArchive(asset)}>
            移除设备
          </Button>
        </div>
      </Form>
    </div>
  );
};

interface CustomAssetDetailProps {
  asset: Asset;
  autoRecordRows: AutoChangeRow[];
  onUpdated: (asset: Asset) => void;
  onArchive: (asset: Asset) => void;
}

const CustomAssetDetail = ({
  asset,
  autoRecordRows,
  onUpdated,
  onArchive,
}: CustomAssetDetailProps) => {
  const info = customAssetInfo(asset);
  const productLink = /^https?:\/\//i.test(info.link) ? info.link : "";
  const infoItem = (label: string, value: unknown, tone: "default" | "primary" | "status" = "default") => (
    <div className={`npcink-v3-custom-info-item is-${tone}`}>
      <span>{label}</span>
      <strong>{fieldText(value)}</strong>
    </div>
  );

  return (
    <Tabs
      defaultActiveKey="info"
      items={[
        {
          key: "info",
          label: "设备信息",
          children: (
            <div className="npcink-v3-custom-detail">
              <div className="npcink-v3-custom-detail-head">
                <h3>{info.title}</h3>
                {productLink ? (
                  <a href={productLink} target="_blank" rel="noreferrer">
                    {info.shopName || info.title}
                  </a>
                ) : (
                  <span>{info.shopName || "-"}</span>
                )}
              </div>
              <div className="npcink-v3-custom-detail-body">
                <div className="npcink-v3-custom-info-card">
                  <h4>设备信息</h4>
                  <div>
                    {infoItem("采购数量", info.quantityText)}
                    {infoItem("采购总价", info.priceText, "primary")}
                    {infoItem("当前状态", info.status, "status")}
                    {infoItem("设备分类", info.category)}
                  </div>
                </div>
                <div className="npcink-v3-custom-info-card">
                  <h4>采购信息</h4>
                  <div>
                    {infoItem("采购人员", info.purchaser)}
                    {infoItem("设备编号", info.number, "primary")}
                    {infoItem("使用人 / 责任人", info.usage, "primary")}
                    {infoItem("设备用途", info.purpose)}
                  </div>
                </div>
                <div className="npcink-v3-custom-info-card is-wide">
                  <h4>订单信息</h4>
                  <div className="npcink-v3-custom-order-grid">
                    {infoItem("采购单号", info.orderNo)}
                    {infoItem("下单时间", formatDate(info.orderTime))}
                    {infoItem("采购平台", info.platform)}
                    {infoItem("支付方式", info.payMethod)}
                  </div>
                </div>
              </div>
            </div>
          ),
        },
        {
          key: "records",
          label: "自动记录",
          children: (
            <Table
              rowKey="key"
              size="small"
              className="npcink-v3-auto-table"
              columns={[
                {
                  title: "序号",
                  width: 72,
                  render: (_value, _row, index) => index + 1,
                },
                {
                  title: "选项",
                  dataIndex: "option",
                  width: 160,
                },
                {
                  title: "变更前",
                  dataIndex: "oldValue",
                },
                {
                  title: "变更后",
                  dataIndex: "newValue",
                },
                {
                  title: "时间",
                  dataIndex: "time",
                  width: 180,
                  render: formatDate,
                },
              ]}
              dataSource={autoRecordRows}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自动变更记录" /> }}
            />
          ),
        },
        {
          key: "settings",
          label: "信息修改",
          children: (
            <CustomAssetSettingsPanel
              asset={asset}
              onUpdated={onUpdated}
              onArchive={onArchive}
            />
          ),
        },
      ]}
    />
  );
};

interface DetailDrawerProps {
  uuid: string | null;
  open: boolean;
  initialAsset?: Asset | null;
  departmentOptions?: string[];
  onClose: () => void;
  onArchive: (asset: Asset) => void;
}

const DetailDrawer = ({ uuid, open, initialAsset = null, departmentOptions = [], onClose, onArchive }: DetailDrawerProps) => {
  const queryClient = useQueryClient();
  const [manualRecordOpen, setManualRecordOpen] = useState(false);
  const [manualRecordKeyword, setManualRecordKeyword] = useState("");
  const [manualRecordSearch, setManualRecordSearch] = useState("");
  const [activeDetailKey, setActiveDetailKey] = useState("processor");
  const [autoRecordSearch, setAutoRecordSearch] = useState("");
  const [selectedObservationId, setSelectedObservationId] = useState<number | null>(null);
  const enabled = Boolean(uuid && open);
  const assetQuery = useQuery(["v3-asset", uuid], () => getAsset(uuid || ""), {
    enabled,
    initialData: initialAsset || undefined,
  });
  const identitiesQuery = useQuery(
    ["v3-asset-identities", uuid],
    () => getAssetIdentities(uuid || ""),
    { enabled }
  );
  const observationsQuery = useQuery(
    ["v3-asset-observations", uuid],
    () => getAssetObservations(uuid || "", 1, 20),
    { enabled }
  );
  const eventsQuery = useQuery(
    ["v3-asset-events", uuid],
    () => getAssetEvents(uuid || "", 1, 30),
    { enabled }
  );
  const observationDetailQuery = useQuery(
    ["v3-observation", selectedObservationId],
    () => getObservation(selectedObservationId || 0),
    { enabled: selectedObservationId !== null }
  );

  const asset = assetQuery.data || null;
  const observations = observationsQuery.data?.data || [];
  const events = eventsQuery.data?.data || [];
  const hardwareContext = assetHardwareContext(asset);
  const summary = hardwareContext.summary;
  const extracted = hardwareContext.extracted;
  const platformVisual = resolvePlatformVisual(
    extracted.platform,
    extracted.cpu,
    extracted.deviceModel,
    summary.os_label
  );
  const sourceRows = useMemo(
    () => (asset ? fieldSourceRows(asset, hardwareContext) : []),
    [asset, hardwareContext]
  );
  const detailSections = useMemo(
    () => (asset ? hardwareDetailSections(asset, hardwareContext) : []),
    [asset, hardwareContext]
  );
  const activeDetailSection =
    detailSections.find((section) => section.key === activeDetailKey) ||
    detailSections.find((section) => section.key === "processor") ||
    detailSections[0];
  const autoRecordRows = useMemo(
    () => automaticChangeRows(events, autoRecordSearch),
    [autoRecordSearch, events]
  );
  const manualRecords = useMemo(() => events.filter((event) => event.eventSource === "manual"), [events]);
  const filteredManualRecords = useMemo(() => {
    const keyword = manualRecordSearch.trim().toLowerCase();
    if (!keyword) {
      return manualRecords;
    }
    return manualRecords.filter((event) => {
      const text = [
        manualRecordOperator(event),
        manualRecordItem(event),
        fieldText(event.message),
        formatDate(event.createdAt),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [manualRecordSearch, manualRecords]);
  const createEventMutation = useMutation(
    (input: AssetEventInput) => createAssetEvent(uuid || "", input),
    {
      onSuccess: () => {
        setManualRecordOpen(false);
        queryClient.invalidateQueries(["v3-asset-events", uuid]);
        queryClient.invalidateQueries(["v3-events"]);
        message.success("手动记录已添加");
      },
    }
  );

  const handleAssetUpdated = (updated: Asset) => {
    queryClient.setQueryData(["v3-asset", updated.uuid], updated);
    queryClient.invalidateQueries(["v3-assets"]);
    queryClient.invalidateQueries(["v3-asset-events", updated.uuid]);
  };

  const identityColumns: ColumnsType<AssetIdentity> = [
    { title: "类型", dataIndex: "identityType", width: 130 },
    { title: "值", dataIndex: "identityValue" },
    {
      title: "主标识",
      dataIndex: "isPrimary",
      width: 90,
      render: (isPrimary: boolean) => (isPrimary ? <Tag color="blue">主</Tag> : "-"),
    },
    {
      title: "置信度",
      dataIndex: "confidence",
      width: 92,
      render: (value: number) => `${Number(value).toFixed(0)}%`,
    },
    { title: "来源", dataIndex: "source", width: 100 },
  ];

  const observationColumns: ColumnsType<AssetObservation> = [
    { title: "来源", dataIndex: "source", width: 100 },
    { title: "采集时间", dataIndex: "observedAt", width: 180, render: formatDate },
    { title: "接收时间", dataIndex: "receivedAt", width: 180, render: formatDate },
    {
      title: "摘要",
      dataIndex: "summary",
      render: (summary: JsonRecord) => (
        <Space direction="vertical" size={2}>
          <Text>{fieldText(summary.device_model || summary.hostname)}</Text>
          <Text type="secondary">{compactJson(summary)}</Text>
        </Space>
      ),
    },
    {
      title: "原始数据",
      width: 110,
      render: (_, observation) => observation.rawBytes ? `${Math.ceil(observation.rawBytes / 1024)} KB` : "-",
    },
    {
      title: "操作",
      width: 92,
      render: (_, observation) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setSelectedObservationId(observation.id)}>
          查看
        </Button>
      ),
    },
  ];

  const downloadObservation = (observation: AssetObservation) => {
    if (!observation.raw) {
      return;
    }
    const blob = new Blob([JSON.stringify(observation.raw, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `npcink-observation-${observation.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const eventColumns: ColumnsType<AssetEvent> = [
    {
      title: "序号",
      width: 72,
      render: (_value, _event, index) => index + 1,
    },
    {
      title: "变更人",
      width: 140,
      render: (_, event) => manualRecordOperator(event),
    },
    {
      title: "变更项目",
      width: 180,
      render: (_, event) => manualRecordItem(event),
    },
    {
      title: "变更说明",
      dataIndex: "message",
      render: fieldText,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 180,
      render: formatDate,
    },
  ];

  return (
    <Modal
      title={isComputerAsset(asset) ? "电脑资产详情" : "自定义资产详情"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={isComputerAsset(asset) ? "min(840px, calc(100vw - 40px))" : "min(860px, calc(100vw - 40px))"}
      className="npcink-v3-detail-modal"
      destroyOnClose
    >
      {assetQuery.isLoading ? (
        <Table loading pagination={false} showHeader={false} />
      ) : asset && !isComputerAsset(asset) ? (
        <CustomAssetDetail
          asset={asset}
          autoRecordRows={autoRecordRows}
          onUpdated={handleAssetUpdated}
          onArchive={onArchive}
        />
      ) : asset ? (
        <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
          <div className={`npcink-v3-device-hero is-${platformVisual.kind}`}>
            <div className="npcink-v3-device-brand">
              <PlatformMark visual={platformVisual} variant="hero" />
              <strong>{platformVisual.label}</strong>
            </div>
            <div>
              <h3>{asset.ownerName || asset.name || "未命名资产"}</h3>
              <p>
                {formatHardwareHeroText(
                  extracted.cpu,
                  summary,
                  hardwareContext.manualHardware,
                  assetTypeLabel(asset.assetType)
                )}
              </p>
              <div className="npcink-v3-device-meta">
                <span>部门：{asset.department || "-"}</span>
                <span>状态：{statusLabel(asset.status)}</span>
                <span>编号：{asset.assetNumber || "-"}</span>
              </div>
            </div>
          </div>
          <Tabs
            defaultActiveKey="overview"
            items={[
            {
              key: "overview",
              label: "硬件信息",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <div className="npcink-v3-hardware-grid">
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">CPU 型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.cpu)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">显卡型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.graphics)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">计算机型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.deviceModel)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">主板型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.baseboard)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">内存信息</span>
                      <strong className="npcink-v3-hardware-value">{extracted.memoryLines.length ? extracted.memoryLines.join("\n") : fieldText(hardwareContext.manualHardware.memory || formatBytes(summary.memory_bytes))}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">显示器</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.display)}</strong>
                      <span className="npcink-v3-hardware-meta">{fieldText(extracted.displayModel)}</span>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">主硬盘</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.primaryDisk || hardwareContext.manualHardware.disk || formatBytes(summary.disk_bytes))}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-muted">
                      <span className="npcink-v3-hardware-label">添加时间</span>
                      <strong className="npcink-v3-hardware-value">{formatDate(asset.createdAt)}</strong>
                    </div>
                  </div>
                </Space>
              ),
            },
            {
              key: "identities",
              label: "详细信息",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <div className="npcink-v3-spec-layout">
                    <div className="npcink-v3-spec-nav">
                      {detailSections.map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          className={section.key === activeDetailSection?.key ? "is-active" : ""}
                          onClick={() => setActiveDetailKey(section.key)}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                    <Table
                      rowKey="key"
                      size="small"
                      className="npcink-v3-spec-table"
                      columns={[
                        {
                          title: "序号",
                          width: 92,
                          render: (_value, _row, index) => index + 1,
                        },
                        {
                          title: "属性",
                          dataIndex: "attribute",
                          width: 220,
                        },
                        {
                          title: "配置",
                          dataIndex: "value",
                        },
                      ]}
                      dataSource={activeDetailSection?.rows || []}
                      pagination={{
                        pageSize: 10,
                        hideOnSinglePage: true,
                        showSizeChanger: false,
                      }}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无该分类信息" /> }}
                    />
                  </div>
                </Space>
              ),
            },
            {
              key: "observations",
              label: "自动记录",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <Text type="secondary">
                    自动记录字段：姓名、状态、编号、部门、IP、采购价、二手价
                  </Text>
                  <div className="npcink-v3-auto-search">
                    <Input
                      allowClear
                      className="npcink-v3-auto-search-input"
                      placeholder="搜索变更记录"
                      value={autoRecordSearch}
                      onChange={(event) => setAutoRecordSearch(event.target.value)}
                      onPressEnter={() => setAutoRecordSearch(autoRecordSearch)}
                    />
                    <Button
                      aria-label="搜索变更记录"
                      className="npcink-v3-auto-search-button"
                      icon={<SearchOutlined />}
                      onClick={() => setAutoRecordSearch(autoRecordSearch)}
                    />
                  </div>
                  <Table
                    rowKey="key"
                    size="small"
                    className="npcink-v3-auto-table"
                    columns={[
                      {
                        title: "序号",
                        width: 72,
                        render: (_value, _row, index) => index + 1,
                      },
                      {
                        title: "选项",
                        dataIndex: "option",
                        width: 160,
                      },
                      {
                        title: "变更前",
                        dataIndex: "oldValue",
                      },
                      {
                        title: "变更后",
                        dataIndex: "newValue",
                      },
                      {
                        title: "时间",
                        dataIndex: "time",
                        width: 180,
                        render: formatDate,
                      },
                    ]}
                    dataSource={autoRecordRows}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: true,
                    }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自动变更记录" /> }}
                  />
                </Space>
              ),
            },
            {
              key: "events",
              label: "手动记录",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <div className="npcink-v3-manual-record-toolbar">
                    <Input
                      allowClear
                      className="npcink-v3-manual-record-search"
                      placeholder="搜索变更记录"
                      value={manualRecordKeyword}
                      onChange={(event) => {
                        const value = event.target.value;
                        setManualRecordKeyword(value);
                        if (!value) {
                          setManualRecordSearch("");
                        }
                      }}
                      onPressEnter={() => setManualRecordSearch(manualRecordKeyword.trim())}
                    />
                    <Button icon={<SearchOutlined />} onClick={() => setManualRecordSearch(manualRecordKeyword.trim())}>
                      搜索
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setManualRecordOpen(true)}>
                      添加记录
                    </Button>
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    columns={eventColumns}
                    dataSource={filteredManualRecords}
                    loading={eventsQuery.isLoading}
                    pagination={false}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" /> }}
                  />
                </Space>
              ),
            },
            {
              key: "debug",
              label: "调试",
              children: (
                <Collapse
                  size="small"
                  items={[
                    {
                      key: "identities",
                      label: `身份标识 ${(identitiesQuery.data || []).length}`,
                      children: (
                        <Table
                          rowKey="id"
                          size="small"
                          columns={identityColumns}
                          dataSource={identitiesQuery.data || []}
                          loading={identitiesQuery.isLoading}
                          pagination={false}
                        />
                      ),
                    },
                    {
                      key: "sources",
                      label: "字段来源对照",
                      children: (
                        <div className="npcink-v3-field-source">
                          <div className="npcink-v3-field-source-head">
                            <Text strong>字段来源对照</Text>
                            <Text type="secondary">标准字段、手动硬件字段和最新采集字段并排查看。</Text>
                          </div>
                          <div className="npcink-v3-field-source-grid">
                            <strong>字段</strong>
                            <strong>标准字段</strong>
                            <strong>手动字段</strong>
                            <strong>最新采集</strong>
                            {sourceRows.map((row) => (
                              <Fragment key={row.key}>
                                <span className={fieldSourceCellClassName(row.label, "label")}>{row.label}</span>
                                <span className={fieldSourceCellClassName(row.standard, "standard", row)}>{row.standard}</span>
                                <span className={fieldSourceCellClassName(row.manual, "manual", row)}>{row.manual}</span>
                                <span className={fieldSourceCellClassName(row.latest, "latest", row)}>{row.latest}</span>
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "metadata",
                      label: "资产扩展信息",
                      children: renderJsonBlock(asset.metadata),
                    },
                    {
                      key: "observations",
                      label: `采集记录 ${observations.length}`,
                      children: (
                        <Table
                          rowKey="id"
                          size="small"
                          columns={observationColumns}
                          dataSource={observations}
                          loading={observationsQuery.isLoading}
                          pagination={false}
                        />
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: "settings",
              label: "设置",
              children: (
                <AssetSettingsPanel
                  asset={asset}
                  departmentOptions={departmentOptions}
                  onUpdated={handleAssetUpdated}
                  onArchive={onArchive}
                />
              ),
            },
            ]}
          />
          <ManualRecordModal
            open={manualRecordOpen}
            asset={asset}
            loading={createEventMutation.isLoading}
            onClose={() => setManualRecordOpen(false)}
            onSubmit={(values) => createEventMutation.mutateAsync(values)}
          />
          <Modal
            title={selectedObservationId ? `采集记录 #${selectedObservationId}` : "采集记录"}
            open={selectedObservationId !== null}
            onCancel={() => setSelectedObservationId(null)}
            footer={null}
            width="min(920px, calc(100vw - 40px))"
            destroyOnClose
          >
            {observationDetailQuery.isLoading ? (
              <Table loading pagination={false} showHeader={false} />
            ) : observationDetailQuery.data ? (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  <Tag>采集：{formatDate(observationDetailQuery.data.observedAt)}</Tag>
                  <Tag>接收：{formatDate(observationDetailQuery.data.receivedAt)}</Tag>
                  <Tag>版本：v{observationDetailQuery.data.schemaVersion}</Tag>
                  <Tag>{observationDetailQuery.data.rawBytes || 0} bytes</Tag>
                  <Button icon={<DownloadOutlined />} onClick={() => downloadObservation(observationDetailQuery.data!)}>
                    下载原始 JSON
                  </Button>
                </Space>
                <Text copyable={{ text: observationDetailQuery.data.contentHash || "" }}>
                  SHA-256：{observationDetailQuery.data.contentHash || "-"}
                </Text>
                <Collapse
                  defaultActiveKey={["identity", "changes"]}
                  items={[
                    {
                      key: "identity",
                      label: `身份判定：${observationDetailQuery.data.identityDecision?.selectedType || "没有可用依据"}`,
                      children: (
                        <Table
                          rowKey="type"
                          size="small"
                          pagination={false}
                          dataSource={observationDetailQuery.data.identityDecision?.evidence || []}
                          columns={[
                            { title: "依据", dataIndex: "label", width: 150 },
                            { title: "结果", dataIndex: "accepted", width: 90, render: (accepted: boolean) => accepted ? <Tag color="green">有效</Tag> : <Tag>未采用</Tag> },
                            { title: "采集值", dataIndex: "value", render: fieldText },
                            { title: "说明", dataIndex: "reason", width: 220 },
                          ]}
                        />
                      ),
                    },
                    {
                      key: "changes",
                      label: `与上次采集差异 ${observationDetailQuery.data.changesFromPrevious?.length || 0}`,
                      children: observationDetailQuery.data.previousObservationId ? (
                        <Table
                          rowKey={(row) => row.path}
                          size="small"
                          pagination={{ pageSize: 20, hideOnSinglePage: true }}
                          dataSource={observationDetailQuery.data.changesFromPrevious || []}
                          columns={[
                            { title: "字段路径", dataIndex: "path", width: 280 },
                            { title: "上次", dataIndex: "before", render: compactJson },
                            { title: "本次", dataIndex: "after", render: compactJson },
                          ]}
                        />
                      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这是第一份采集记录" />,
                    },
                    { key: "hardware", label: "标准化硬件信息", children: renderJsonBlock(observationDetailQuery.data.hardware) },
                    { key: "raw", label: "原始采集数据", children: renderJsonBlock(observationDetailQuery.data.raw || {}) },
                  ]}
                />
              </Space>
            ) : (
              <Empty description="采集记录读取失败" />
            )}
          </Modal>
        </Space>
      ) : (
        <Empty description="未找到资产" />
      )}
    </Modal>
  );
};

const ChangeWorkspace = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [eventMode, setEventMode] = useState<"manual" | "auto">("auto");
  const [hideNames, setHideNames] = useState(false);
  const queryParams = useMemo(
    () => ({ page, pageSize, search, eventMode }),
    [eventMode, page, pageSize, search]
  );
  const eventsQuery = useQuery(["v3-events", queryParams], () => getEvents(queryParams), {
    keepPreviousData: true,
  });
  const events = eventsQuery.data?.data || [];
  const pagination = eventsQuery.data?.pagination;
  const typeFilters = useMemo(
    () =>
      Array.from(new Set(events.map((event) => changeTypeLabel(event)).filter((value) => value && value !== "-")))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ text: value, value })),
    [events]
  );

  const columns: ColumnsType<AssetEvent> = [
    {
      title: "序号",
      width: 96,
      render: (_value, _event, index) => {
        const total = pagination?.totalItems || 0;
        return total ? total - ((page - 1) * pageSize + index) : index + 1;
      },
    },
    {
      title: "姓名",
      width: 160,
      render: (_, event) => (
        <span className={hideNames ? "npcink-v3-name-blur" : undefined}>{changeActorName(event)}</span>
      ),
    },
    {
      title: "类型",
      width: 140,
      filters: typeFilters,
      onFilter: (value, event) => changeTypeLabel(event) === value,
      render: (_, event) => changeTypeLabel(event),
    },
    {
      title: "内容",
      render: (_, event) => <Text className="npcink-v3-change-content">{changeContentText(event)}</Text>,
    },
    {
      title: "设备",
      width: 260,
      render: (_, event) => {
        const asset = changeAssetLabelParts(event.asset);
        return (
          <span>
            <span className={hideNames && asset.name !== "-" ? "npcink-v3-name-blur" : undefined}>{asset.name}</span>
            {asset.suffix ? ` _ ${asset.suffix}` : ""}
          </span>
        );
      },
    },
    {
      title: "日期",
      dataIndex: "createdAt",
      width: 190,
      defaultSortOrder: "descend",
      sorter: (a, b) =>
        new Date(a.createdAt.replace(" ", "T")).getTime() - new Date(b.createdAt.replace(" ", "T")).getTime(),
      render: formatDate,
    },
  ];

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-change-layout">
        <div className="npcink-v3-change-actions">
          <Button
            onClick={() => {
              setPage(1);
              setEventMode((value) => (value === "manual" ? "auto" : "manual"));
            }}
          >
            {eventMode === "manual" ? "手动变更数据" : "自动变更数据"}
          </Button>
          <Button onClick={() => setHideNames((value) => !value)}>
            {hideNames ? "显示姓名" : "隐藏姓名"}
          </Button>
        </div>
        <div className="npcink-v3-change-filters">
          <Input.Search
            allowClear
            placeholder="搜索资产、字段或说明"
            onSearch={(value) => {
              setPage(1);
              setSearch(value);
            }}
            className="npcink-v3-search"
          />
        </div>
      </div>
      <Table
        rowKey="id"
        size="middle"
        className="npcink-v3-change-table"
        columns={columns}
        dataSource={events}
        loading={eventsQuery.isLoading || eventsQuery.isFetching}
        scroll={{ x: 980 }}
        pagination={{
          current: page,
          pageSize,
          total: pagination?.totalItems || 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条变更记录`,
        }}
        onChange={(nextPagination) => {
          setPage(nextPagination.current || 1);
          setPageSize(nextPagination.pageSize || 20);
        }}
        locale={{ emptyText: <Empty description="暂无变更数据" /> }}
      />
    </div>
  );
};

const ISSUE_LEVEL_META: Record<HardwareIssue["level"], { label: string; color: string }> = {
  error: { label: "高", color: "red" },
  warning: { label: "中", color: "orange" },
  info: { label: "低", color: "blue" },
};

const AnalysisWorkspace = () => {
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const assetsQuery = useQuery(
    ["v3-analysis-assets"],
    () => fetchAllAssets({ assetScope: "computer" }),
    { staleTime: 60_000 }
  );
  const assets = useMemo(
    () => (assetsQuery.data || []).filter((asset) => asset.status !== "deleted"),
    [assetsQuery.data]
  );
  const issues = useMemo(() => detectHardwareIssues(assets), [assets]);
  const groupOptions = useMemo(
    () =>
      Array.from(new Set(issues.map((issue) => issueGroup(issue.type))))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [issues]
  );
  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          issues
            .filter((issue) => !selectedGroup || issueGroup(issue.type) === selectedGroup)
            .map((issue) => issue.type)
        )
      )
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [issues, selectedGroup]
  );
  const visibleIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (!selectedGroup || issueGroup(issue.type) === selectedGroup) &&
          (!selectedType || issue.type === selectedType)
      ),
    [issues, selectedGroup, selectedType]
  );
  const connectedCount = assets.filter((asset) => Boolean(asset.latestObservation?.observedAt)).length;
  const duplicateRiskGroups = new Set(
    issues
      .filter((issue) => issueGroup(issue.type) === "重复风险")
      .map((issue) => issue.duplicateGroupKey)
      .filter(Boolean)
  ).size;

  return (
    <div className="npcink-v3-analysis-workspace">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>分析概览</Title>
          <Text type="secondary">
            统计所有未归档电脑。问题由当前资产与最近采集快照实时计算，不写回处理状态。
          </Text>
        </div>
      </div>
      {assetsQuery.isError ? (
        <Alert type="error" showIcon message="分析数据加载失败" description="请刷新页面后重试。" />
      ) : null}
      <div className="npcink-v3-simple-kpis" aria-label="电脑资产概览">
        {[
          { label: "电脑总数", value: assets.length },
          { label: "已接入采集", value: connectedCount },
          { label: "待处理问题", value: issues.length },
          { label: "重复风险组", value: duplicateRiskGroups },
        ].map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{assetsQuery.isLoading || assetsQuery.isError ? "-" : item.value}</strong>
          </div>
        ))}
      </div>
      <div className="npcink-v3-analysis-issues">
        <div className="npcink-v3-analysis-issues-head">
          <div>
            <Title level={4}>问题清单</Title>
            <Text type="secondary">
              共 {assetsQuery.isError ? "-" : visibleIssues.length} 条，只读展示，不在分析页执行修复。
            </Text>
          </div>
          <Space wrap>
            <Select
              allowClear
              placeholder="问题分组"
              aria-label="按问题分组筛选"
              options={groupOptions}
              value={selectedGroup}
              disabled={assetsQuery.isError}
              onChange={(value) => {
                setSelectedGroup(value);
                setSelectedType(undefined);
              }}
              className="npcink-v3-filter"
            />
            <Select
              allowClear
              placeholder="问题类型"
              aria-label="按问题类型筛选"
              options={typeOptions}
              value={selectedType}
              disabled={assetsQuery.isError}
              onChange={setSelectedType}
              className="npcink-v3-filter"
            />
          </Space>
        </div>
        <Table<HardwareIssue>
          rowKey="key"
          size="middle"
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          dataSource={assetsQuery.isError ? [] : visibleIssues}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            {
              title: "级别",
              dataIndex: "level",
              width: 88,
              render: (level: HardwareIssue["level"]) => (
                <Tag color={ISSUE_LEVEL_META[level].color}>{ISSUE_LEVEL_META[level].label}</Tag>
              ),
            },
            { title: "类型", dataIndex: "type", width: 150 },
            {
              title: "资产",
              width: 220,
              render: (_, issue) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{issue.asset.assetNumber || issue.asset.name || issue.asset.uuid}</Text>
                  {issue.asset.assetNumber && issue.asset.name ? <Text type="secondary">{issue.asset.name}</Text> : null}
                </Space>
              ),
            },
            { title: "说明", dataIndex: "message" },
          ]}
          scroll={{ x: 760 }}
          locale={{
            emptyText: (
              <Empty description={assetsQuery.isError ? "分析数据加载失败" : "暂无异常发现"} />
            ),
          }}
        />
      </div>
    </div>
  );
};
const DataToolsWorkspace = () => {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [backupImportModalOpen, setBackupImportModalOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>数据工具</Title>
          <Text type="secondary">集中处理资产表格和完整 JSON 备份。</Text>
        </div>
      </div>
      <div className="npcink-v3-data-tools">
        <div className="npcink-v3-tool-panel">
          <div>
            <Title level={4}>资产表格导入</Title>
            <Text type="secondary">下载标准模板后填写，可按资产编号新增或更新资产、财务字段和手动硬件字段。</Text>
          </div>
          <Button type="primary" onClick={() => setImportModalOpen(true)}>
            导入资产表格
          </Button>
        </div>
        <div className="npcink-v3-tool-panel">
          <div>
            <Title level={4}>资产表格导出</Title>
            <Text type="secondary">导出电脑、自定义设备或全部资产，便于财务和行政筛选统计。</Text>
          </div>
          <Button onClick={() => setExportModalOpen(true)}>导出资产表格</Button>
        </div>
        <BackupManagementPanels onOpenImport={() => setBackupImportModalOpen(true)} />
      </div>
      <AssetImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries(["v3-assets"]);
          queryClient.invalidateQueries(["v3-assets-import-index"]);
        }}
      />
      <AssetExportModal
        open={exportModalOpen}
        currentScopeLabel="全部资产"
        currentQueryParams={{ assetScope: "all", includeDeleted: true }}
        onClose={() => setExportModalOpen(false)}
      />
      <BackupRestoreModal
        open={backupImportModalOpen}
        onClose={() => setBackupImportModalOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries(["v3-assets"]);
          queryClient.invalidateQueries(["v3-assets-import-index"]);
          queryClient.invalidateQueries(["v3-events"]);
          queryClient.invalidateQueries(["v3-observations"]);
          queryClient.invalidateQueries(["v3-settings"]);
        }}
      />
    </div>
  );
};
const SettingsWorkspace = () => {
  const [form] = Form.useForm<InventorySettings>();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(["v3-settings"], getSettings);
  const settingsMutation = useMutation(updateSettings, {
    onSuccess: (settings) => {
      queryClient.setQueryData(["v3-settings"], settings);
      message.success("设置已保存");
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      form.setFieldsValue({
        ...settingsQuery.data,
        departments: normalizeDepartmentList(settingsQuery.data.departments),
      });
    }
  }, [form, settingsQuery.data]);

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>设置</Title>
          <Text type="secondary">管理采集客户端、部门和卸载清理策略。</Text>
        </div>
      </div>
      <div className="npcink-v3-settings-panel">
        <Form
          form={form}
          className="npcink-v3-global-settings-form"
          layout="vertical"
          onFinish={(values) =>
            settingsMutation.mutate({
              ...values,
              departments: normalizeDepartmentList(values.departments),
            })
          }
        >
          <div className="npcink-v3-settings-section">
            <div className="npcink-v3-settings-section-head">
              <Title level={4}>客户端接入</Title>
              <Button onClick={() => setTokenModalOpen(true)}>管理客户端令牌</Button>
            </div>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="clientUploadBaseUrl"
                label="外部访问地址"
                extra="留空使用当前站点 REST 地址；反向代理、内网穿透或 HTTPS 域名不一致时再填写。"
                className="npcink-v3-settings-wide"
              >
                <Input placeholder={RestUrl} />
              </Form.Item>
            </div>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>部门管理</Title>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="departments"
                label="部门列表"
                extra="未分配是系统兜底部门，不能删除；设备详情、批量修改和表格导入只能选择这里维护的部门。"
                className="npcink-v3-settings-wide"
              >
                <Select
                  mode="tags"
                  showSearch
                  tokenSeparators={[",", "，", "\n"]}
                  options={departmentSelectOptions(form.getFieldValue("departments") || [])}
                  tagRender={departmentTagRender}
                  onChange={(value) => form.setFieldValue("departments", normalizeDepartmentList(value))}
                  placeholder="输入部门名称后回车，例如：财务部"
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
            </div>
          </div>
          <div className="npcink-v3-settings-section npcink-v3-danger-section">
            <Title level={4}>危险操作</Title>
            <div className="npcink-v3-settings-grid">
              <div className="npcink-v3-setting-switch-row">
                <div>
                  <Text strong>卸载时删除数据</Text>
                  <Text type="secondary">开启后，删除插件时会清理插件数据表和设置。</Text>
                </div>
                <Form.Item name="deleteDataOnUninstall" valuePropName="checked" noStyle>
                  <Switch checkedChildren="删除" unCheckedChildren="保留" />
                </Form.Item>
              </div>
            </div>
          </div>
          <div className="npcink-v3-settings-actions">
            <Button type="primary" htmlType="submit" loading={settingsMutation.isLoading}>
              保存设置
            </Button>
          </div>
        </Form>
      </div>
      <TokenModal open={tokenModalOpen} onClose={() => setTokenModalOpen(false)} />
    </div>
  );
};
interface AssetCardProps {
  asset: Asset;
  onOpen: () => void;
  searchKeyword?: string;
  selectable?: boolean;
  selected?: boolean;
  compact?: boolean;
  onSelect?: () => void;
}

const AssetCard = ({
  asset,
  onOpen,
  searchKeyword = "",
  selectable = false,
  selected = false,
  compact = false,
  onSelect,
}: AssetCardProps) => {
  const { summary, manualHardware, extracted } = assetHardwareContext(asset);
  const title = asset.ownerName || asset.name || "未命名资产";
  const isPc = isComputerAsset(asset);
  const customInfo = !isPc ? customAssetInfo(asset) : null;
  const baseboardLabel = cardBaseboardLabel(extracted.baseboard || extracted.deviceModel);
  const cpuLabel = cardCpuLabel(extracted.cpu);
  const graphicsLabel = cardGraphicsLabel(extracted.graphics);
  const platformVisual = resolvePlatformVisual(extracted.platform, extracted.cpu, extracted.deviceModel);
  const handleOpen = () => {
    if (selectable) {
      onSelect?.();
      return;
    }
    onOpen();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`npcink-v3-asset-card${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpen();
        }
      }}
    >
      {selectable ? (
        <div className="npcink-v3-card-check" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onChange={() => onSelect?.()} />
        </div>
      ) : null}
      {customInfo ? (
        <div className="npcink-v3-asset-card-body npcink-v3-custom-card-body">
          <h3>{highlightText(customInfo.title, searchKeyword)}</h3>
          <dl>
            <div>
              <dt>编号：</dt>
              <dd>{highlightText(customInfo.number, searchKeyword, true)}</dd>
            </div>
            <div>
              <dt>分类：</dt>
              <dd>{highlightText(customInfo.category, searchKeyword)}</dd>
            </div>
            <div>
              <dt>使用：</dt>
              <dd>{highlightText(customInfo.usage, searchKeyword)}</dd>
            </div>
            <div>
              <dt>价格：</dt>
              <dd>{customInfo.priceText}</dd>
            </div>
            <div>
              <dt>状态：</dt>
              <dd>{customInfo.status || "-"}</dd>
            </div>
            <div>
              <dt>购置：</dt>
              <dd>{formatDate(customInfo.orderTime || customInfo.createdAt)}</dd>
            </div>
            <div>
              <dt>更新：</dt>
              <dd>{assetUpdateTimeText(asset)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <>
          <div className="npcink-v3-asset-card-brand">
            <PlatformMark visual={platformVisual} variant="card" />
            <strong>{platformVisual.label}</strong>
          </div>
          <div className="npcink-v3-asset-card-body">
            <h3>{highlightText(title, searchKeyword)}</h3>
            <p title={fieldText(extracted.baseboard || extracted.deviceModel)}>
              {highlightText(baseboardLabel, searchKeyword)}
            </p>
            <p title={fieldText(extracted.cpu)}>{highlightText(cpuLabel, searchKeyword)}</p>
            <p title={fieldText(extracted.graphics)}>{highlightText(graphicsLabel, searchKeyword)}</p>
            <dl>
              <div>
                <dt>配置：</dt>
                <dd>{formatMemoryDiskText(summary, manualHardware)}</dd>
              </div>
              <div>
                <dt>编号：</dt>
                <dd>{highlightText(asset.assetNumber, searchKeyword, true)}</dd>
              </div>
              <div>
                <dt>状态：</dt>
                <dd>{statusLabel(asset.status)}</dd>
              </div>
              <div>
                <dt>部门：</dt>
                <dd>{highlightText(asset.department, searchKeyword)}</dd>
              </div>
              <div>
                <dt>更新：</dt>
                <dd>{assetUpdateTimeText(asset)}</dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </div>
  );
};

interface AssetWorkspaceProps {
  initialScope?: AssetScope;
  title?: string;
}

const AssetWorkspace = ({
  initialScope = "computer",
  title,
}: AssetWorkspaceProps) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [assetScope, setAssetScope] = useState<AssetScope>(initialScope);
  const [assetType, setAssetType] = useState<AssetType | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [purchasePlatform, setPurchasePlatform] = useState<string | undefined>();
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [assetLayoutMode, setAssetLayoutMode] = useState<AssetLayoutMode>(() =>
    loadStoredTab(ASSET_LAYOUT_MODE_STORAGE_KEY, ["compact", "spacious"] as const, "spacious")
  );
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const [savedFilters, setSavedFilters] = useState<SavedAssetFilter[]>(loadSavedFilters);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const queryParams = useMemo(
    () => ({
      page,
      pageSize,
      search,
      assetScope,
      assetType: assetScope === "computer" ? undefined : assetType,
      status,
      category: assetScope === "other" ? category : undefined,
      purchasePlatform: assetScope === "other" ? purchasePlatform : undefined,
      sortBy: "latestObserved" as const,
    }),
    [assetScope, assetType, category, page, pageSize, purchasePlatform, search, status]
  );
  const initialAssetsData = useMemo(
    () => initialAssetsForParams(queryParams) || readCachedAssetList(queryParams),
    [queryParams]
  );
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const assetsQuery = useQuery(["v3-assets", queryParams], () => getAssets(queryParams), {
    initialData: initialAssetsData,
    keepPreviousData: true,
    onSuccess: (result) => {
      if (result) {
        writeCachedAssetList(queryParams, result);
      }
    },
  });

  useEffect(() => {
    setSelectedUuids(new Set());
  }, [assetScope, assetType, category, page, pageSize, purchasePlatform, search, status]);

  useEffect(() => {
    if (!batchMode) {
      setSelectedUuids(new Set());
    }
  }, [batchMode]);

  const createMutation = useMutation(createAsset, {
    onSuccess: (asset) => {
      setAssetModalOpen(false);
      setEditingAsset(null);
      setSelectedUuid(asset.uuid);
      queryClient.invalidateQueries(["v3-assets"]);
      message.success("资产已创建");
    },
  });
  const updateMutation = useMutation(
    ({ uuid, input }: { uuid: string; input: AssetInput }) => updateAsset(uuid, input),
    {
      onSuccess: (asset) => {
        setAssetModalOpen(false);
        setEditingAsset(null);
        setSelectedUuid(asset.uuid);
        queryClient.invalidateQueries(["v3-assets"]);
        queryClient.invalidateQueries(["v3-asset", asset.uuid]);
        queryClient.invalidateQueries(["v3-asset-events", asset.uuid]);
        message.success("资产已更新");
      },
    }
  );
  const archiveMutation = useMutation(archiveAsset, {
    onSuccess: (asset) => {
      queryClient.invalidateQueries(["v3-assets"]);
      queryClient.invalidateQueries(["v3-asset", asset.uuid]);
      queryClient.invalidateQueries(["v3-asset-events", asset.uuid]);
      message.success("资产已归档");
    },
  });
  const batchArchiveMutation = useMutation(
    async (uuids: string[]) => {
      return batchAssets("archive", uuids, undefined, {
        source: "asset_batch_archive",
        message: "批量归档资产",
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["v3-assets"]);
        setSelectedUuids(new Set());
        setBatchMode(false);
        message.success("已归档所选资产");
      },
    }
  );
  const batchUpdateMutation = useMutation(
    async ({ targets, input }: { targets: Asset[]; input: AssetInput }) => {
      const changedTargets = targets
        .map((asset) => ({ asset, changes: bulkUpdateChanges(asset, input) }))
        .filter((item) => item.changes.length > 0);

      if (!changedTargets.length) {
        message.warning("没有字段发生变化");
        return 0;
      }

      const labels = Array.from(new Set(changedTargets.flatMap(({ changes }) => changes.map((change) => change.label))));
      const result = await batchAssets(
        "update",
        changedTargets.map(({ asset }) => asset.uuid),
        input,
        { source: "asset_batch_edit", message: `批量修改：${labels.join("、")}` }
      );
      return result.updated;
    },
    {
      onSuccess: (changedCount) => {
        if (changedCount === 0) {
          return;
        }
        queryClient.invalidateQueries(["v3-assets"]);
        queryClient.invalidateQueries(["v3-events"]);
        setBulkModalOpen(false);
        setSelectedUuids(new Set());
        setBatchMode(false);
        message.success(`已批量修改 ${changedCount} 条资产并写入变更记录`);
      },
    }
  );

  const assets = assetsQuery.data?.data || [];
  const pagination = assetsQuery.data?.pagination;
  const departmentOptions = useMemo(
    () => normalizeDepartmentList(settingsQuery.data?.departments || []),
    [settingsQuery.data?.departments]
  );
  const selectedCount = selectedUuids.size;
  const allSelected = assets.length > 0 && assets.every((asset) => selectedUuids.has(asset.uuid));
  const compactLayout = assetLayoutMode === "compact";
  const activeCount = countStatus(assets, "active");
  const maintenanceCount = countStatus(assets, "maintenance");
  const activeScopeLabel =
    title || ASSET_SCOPE_OPTIONS.find((item) => item.value === assetScope)?.label || "资产";
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set([...DEFAULT_CUSTOM_CATEGORIES, ...assets.map((asset) => asset.category).filter(Boolean)]))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [assets]
  );

  const toggleSelect = (uuid: string) => {
    setSelectedUuids((previous) => {
      const next = new Set(previous);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUuids(new Set());
      return;
    }
    setSelectedUuids(new Set(assets.map((asset) => asset.uuid)));
  };

  const selectedAssets = assets.filter((asset) => selectedUuids.has(asset.uuid));
  const selectedAsset = selectedUuid ? assets.find((asset) => asset.uuid === selectedUuid) || null : null;

  const applySavedFilter = (id: string) => {
    const filter = savedFilters.find((item) => item.id === id);
    if (!filter) {
      return;
    }
    setAssetScope(filter.assetScope);
    setAssetType(filter.assetType);
    setStatus(filter.status);
    setCategory(filter.category);
    setPurchasePlatform(filter.purchasePlatform);
    setSearch(filter.search || "");
    setSearchDraft(filter.search || "");
    setPage(1);
  };

  const saveCurrentFilter = () => {
    const name = window.prompt("筛选名称", activeScopeLabel);
    if (!name) {
      return;
    }
    const next = [
      ...savedFilters.filter((item) => item.name !== name),
      {
        id: `${Date.now()}`,
        name,
        assetScope,
        assetType,
        status,
        search,
        category,
        purchasePlatform,
      },
    ];
    setSavedFilters(next);
    saveFilters(next);
    message.success("筛选已保存");
  };

  const columns: ColumnsType<Asset> = [
    {
      title: "资产编号",
      dataIndex: "assetNumber",
      width: 170,
      render: (value: string) => <Text code>{highlightText(value, search, true)}</Text>,
    },
    {
      title: "资产名称",
      dataIndex: "name",
      render: (value: string, asset) => (
        <Button
          type="link"
          className="npcink-v3-link"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedUuid(asset.uuid);
          }}
        >
          {highlightText(value || "未命名资产", search)}
        </Button>
      ),
    },
    {
      title: "类型",
      dataIndex: "assetType",
      width: 120,
      render: assetTypeLabel,
    },
    { title: "使用人", dataIndex: "ownerName", width: 120, render: (value) => highlightText(value, search) },
    { title: "部门", dataIndex: "department", width: 140, render: (value) => highlightText(value, search) },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={statusColor[value] || "default"}>{statusLabel(value)}</Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (_value, asset) => assetUpdateTimeText(asset),
    },
    {
      title: "操作",
      width: 96,
      render: (_, asset) => (
        <Button
          type="link"
          className="npcink-v3-link"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedUuid(asset.uuid);
          }}
        >
          查看
        </Button>
      ),
    },
  ];

  const submitAsset = async (values: AssetInput) => {
    if (editingAsset) {
      await updateMutation.mutateAsync({ uuid: editingAsset.uuid, input: values });
      return;
    }
    await createMutation.mutateAsync(values);
  };

  const openCreateModal = () => {
    setEditingAsset(null);
    setAssetModalOpen(true);
  };

  const submitSearch = () => {
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const updateSearchDraft = (value: string) => {
    setSearchDraft(value);
    if (!value && search) {
      setPage(1);
      setSearch("");
    }
  };

  const confirmArchive = (asset: Asset) => {
    Modal.confirm({
      title: "归档这台资产？",
      content: `${asset.assetNumber || asset.uuid} 将被标记为已归档，不会物理删除。`,
      okText: "归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => archiveMutation.mutateAsync(asset.uuid),
    });
  };

  const confirmBatchArchive = () => {
    if (selectedCount === 0) {
      message.warning("请先选择要归档的资产");
      return;
    }
    const targets = Array.from(selectedUuids);
    Modal.confirm({
      title: "归档所选资产？",
      content: `已选 ${selectedCount} 条资产记录，将统一标记为已归档，不会物理删除。`,
      okText: "归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => batchArchiveMutation.mutateAsync(targets),
    });
  };

  const handleTableChange = (nextPagination: TablePaginationConfig) => {
    setPage(nextPagination.current || 1);
    setPageSize(nextPagination.pageSize || 20);
  };

  const toggleAssetLayoutMode = () => {
    setAssetLayoutMode((value) => {
      const next = value === "compact" ? "spacious" : "compact";
      saveStoredTab(ASSET_LAYOUT_MODE_STORAGE_KEY, next);
      return next;
    });
  };

  return (
    <div className={`npcink-v3-section${viewMode === "card" && compactLayout ? " is-compact-card-layout" : ""}`}>
      <div className="npcink-v3-toolbar-shell is-plain">
        <div className="npcink-v3-toolbar-title">
          <Text strong>{activeScopeLabel}</Text>
          <Text type="secondary">
            共 {pagination?.totalItems ?? "-"} 条，当前页在用 {activeCount}，维护 {maintenanceCount}
          </Text>
        </div>
        <div className="npcink-v3-toolbar">
          <Select
            allowClear
            placeholder={assetScope === "other" ? "设备状态" : "状态"}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            className="npcink-v3-filter"
          />
          {assetScope === "other" ? (
            <>
              <Select
                allowClear
                placeholder="分类"
                options={categoryOptions}
                value={category}
                onChange={(value) => {
                  setPage(1);
                  setCategory(value);
                }}
                className="npcink-v3-filter"
              />
              <Select
                allowClear
                placeholder="采购平台"
                options={CUSTOM_PURCHASE_PLATFORM_OPTIONS}
                value={purchasePlatform}
                onChange={(value) => {
                  setPage(1);
                  setPurchasePlatform(value);
                }}
                className="npcink-v3-filter"
              />
            </>
          ) : assetScope !== "computer" ? (
            <Select
              allowClear
              placeholder="资产类型"
              options={ASSET_TYPES}
              value={assetType}
              onChange={(value) => {
                setPage(1);
                setAssetType(value);
              }}
              className="npcink-v3-filter"
            />
          ) : null}
          <div className="npcink-v3-toolbar-search">
            <Input
              allowClear
              value={searchDraft}
              placeholder={assetScope === "other" ? "搜索姓名、订单号、产品名称" : "搜索编号、名称、使用人、部门"}
              onChange={(event) => updateSearchDraft(event.target.value)}
              onPressEnter={submitSearch}
            />
            <Button
              aria-label="搜索资产"
              icon={<SearchOutlined />}
              onClick={submitSearch}
            />
          </div>
          <Space.Compact>
            <Button
              type={viewMode === "card" ? "primary" : "default"}
              onClick={() => setViewMode("card")}
            >
              卡片
            </Button>
            <Button
              type={viewMode === "table" ? "primary" : "default"}
              onClick={() => setViewMode("table")}
            >
              列表
            </Button>
          </Space.Compact>
          {assetScope === "other" ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新增
            </Button>
          ) : null}
          <Dropdown
            menu={{
              items: [
                { key: "export", label: "导出表格" },
                { key: "save-filter", label: "保存筛选" },
                { key: "batch", label: batchMode ? "退出批量模式" : "批量模式" },
                ...(viewMode === "card"
                  ? [{ key: "layout", label: compactLayout ? "舒展模式" : "紧凑模式" }]
                  : []),
                ...savedFilters.map((filter) => ({
                  key: `filter:${filter.id}`,
                  label: `筛选：${filter.name}`,
                })),
              ],
              onClick: ({ key }) => {
                if (key === "export") {
                  setExportModalOpen(true);
                } else if (key === "save-filter") {
                  saveCurrentFilter();
                } else if (key === "batch") {
                  setBatchMode((value) => !value);
                } else if (key === "layout") {
                  toggleAssetLayoutMode();
                } else if (key.startsWith("filter:")) {
                  applySavedFilter(key.replace("filter:", ""));
                }
              },
            }}
          >
            <Button>更多</Button>
          </Dropdown>
        </div>
      </div>
      {batchMode ? (
        <div className="npcink-v3-batch-actions">
          <Space wrap>
            <Text type="secondary">已选 {selectedCount} 条</Text>
            <Button onClick={toggleSelectAll} disabled={!assets.length}>
              {allSelected ? "取消全选" : "全选当前页"}
            </Button>
            <Button
              danger
              disabled={selectedCount === 0}
              loading={batchArchiveMutation.isLoading}
              onClick={confirmBatchArchive}
            >
              归档已选
            </Button>
            <Button disabled={selectedCount === 0} onClick={() => setBulkModalOpen(true)}>
              批量修改
            </Button>
            <Button disabled={selectedCount === 0} onClick={() => setExportModalOpen(true)}>
              导出已选
            </Button>
            <Button onClick={() => setBatchMode(false)}>退出批量</Button>
          </Space>
        </div>
      ) : null}

      {viewMode === "card" ? (
        <div className="npcink-v3-card-surface">
          {assetsQuery.isLoading && !assets.length ? (
            <Table loading pagination={false} showHeader={false} />
          ) : assets.length ? (
            <div className="npcink-v3-card-grid">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.uuid}
                  asset={asset}
                  searchKeyword={search}
                  onOpen={() => setSelectedUuid(asset.uuid)}
                  selectable={batchMode}
                  selected={selectedUuids.has(asset.uuid)}
                  onSelect={() => toggleSelect(asset.uuid)}
                />
              ))}
            </div>
          ) : (
            <div className="npcink-v3-empty-state">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  assetScope === "other"
                    ? "暂无自定义资产，可新增自定义资产或在数据工具中导入标准表格"
                    : "暂无电脑资产，可在数据工具中导入标准表格或等待客户端采集"
                }
              />
            </div>
          )}
          <div className="npcink-v3-card-pagination">
            <Text type="secondary">共 {pagination?.totalItems || 0} 条资产</Text>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={pagination?.totalItems || 0}
              showSizeChanger
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              }}
            />
          </div>
        </div>
      ) : (
        <Table
          rowKey="uuid"
          size="middle"
          columns={columns}
          dataSource={assets}
          loading={assetsQuery.isLoading && !assets.length}
          onChange={handleTableChange}
          rowSelection={
            batchMode
              ? {
                  selectedRowKeys: Array.from(selectedUuids),
                  onChange: (keys) => setSelectedUuids(new Set(keys.map(String))),
                }
              : undefined
          }
          onRow={(asset) => ({
            onClick: () => {
              if (batchMode) {
                toggleSelect(asset.uuid);
                return;
              }
              setSelectedUuid(asset.uuid);
            },
          })}
          scroll={{ x: 980 }}
          pagination={{
            current: page,
            pageSize,
            total: pagination?.totalItems || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条资产`,
          }}
          locale={{ emptyText: <Empty description="暂无资产" /> }}
        />
      )}

      <DetailDrawer
        uuid={selectedUuid}
        open={Boolean(selectedUuid)}
        initialAsset={selectedAsset}
        departmentOptions={departmentOptions}
        onClose={() => setSelectedUuid(null)}
        onArchive={confirmArchive}
      />
      <AssetFormModal
        asset={editingAsset}
        open={assetModalOpen}
        departmentOptions={departmentOptions}
        onClose={() => setAssetModalOpen(false)}
        onSubmit={submitAsset}
      />
      <BulkEditModal
        open={bulkModalOpen}
        count={selectedCount}
        loading={batchUpdateMutation.isLoading}
        departmentOptions={departmentOptions}
        onClose={() => setBulkModalOpen(false)}
        onSubmit={async (input) => {
          await batchUpdateMutation.mutateAsync({ targets: selectedAssets, input });
        }}
      />
      <AssetExportModal
        open={exportModalOpen}
        currentScopeLabel={activeScopeLabel}
        currentQueryParams={queryParams}
        currentTotal={pagination?.totalItems}
        selectedAssets={selectedAssets}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
};

const WORKSPACE_TAB_KEYS = ["computer", "custom", "events", "analysis", "tools", "settings"] as const;

const InventoryAdmin = () => {
  const [activeTab, setActiveTab] = useState<(typeof WORKSPACE_TAB_KEYS)[number]>(() =>
    loadStoredTab(WORKSPACE_TAB_STORAGE_KEY, WORKSPACE_TAB_KEYS, "computer")
  );
  const openWorkspaceTab = (tab: (typeof WORKSPACE_TAB_KEYS)[number]) => {
    setActiveTab(tab);
    saveStoredTab(WORKSPACE_TAB_STORAGE_KEY, tab);
  };
  return (
    <div className="npcink-v3-app">
      <Tabs
        activeKey={activeTab}
        className="npcink-v3-workspace-tabs"
        onChange={(key) => {
          const nextKey = WORKSPACE_TAB_KEYS.includes(key as (typeof WORKSPACE_TAB_KEYS)[number])
            ? (key as (typeof WORKSPACE_TAB_KEYS)[number])
            : "computer";
          openWorkspaceTab(nextKey);
        }}
        items={[
          {
            key: "computer",
            label: "电脑设备",
            children: <AssetWorkspace initialScope="computer" title="电脑资产" />,
          },
          {
            key: "custom",
            label: "自定义设备",
            children: <AssetWorkspace initialScope="other" title="自定义资产" />,
          },
          {
            key: "events",
            label: "变更数据",
            children: <ChangeWorkspace />,
          },
          {
            key: "analysis",
            label: "分析",
            children: <AnalysisWorkspace />,
          },
          {
            key: "tools",
            label: "数据工具",
            children: <DataToolsWorkspace />,
          },
          {
            key: "settings",
            label: "设置",
            children: <SettingsWorkspace />,
          },
        ]}
      />
    </div>
  );
};

export default InventoryAdmin;

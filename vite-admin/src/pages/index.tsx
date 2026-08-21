import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppleFilled, DesktopOutlined, InfoCircleOutlined, PlusOutlined, SearchOutlined, WindowsFilled } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  DatePicker,
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
  Tooltip,
  Typography,
  message,
} from "antd";
import type { SelectProps } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { InitialAssets, RestUrl } from "@/utils/index";
import {
  archiveAsset,
  batchAssets,
  cleanupObservations,
  createAsset,
  createAssetEvent,
  createClientToken,
  deleteClientToken,
  getAsset,
  getAssetEvents,
  getAssetIdentities,
  getAssetObservations,
  getAssets,
  getCollectionTrends,
  getEvents,
  getObservations,
  getSettings,
  importAssets,
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
  collectionAgeBand,
  collectionAgeDays,
  detectHardwareIssues,
  firstText,
  formatBytes,
  getArray,
  getRecord,
  hardwareSummary,
  hardwareDiskBytes,
  hardwareMemoryBytes,
  inferredGraphicsForFallbackDriver,
  issueGroup,
  physicalGraphicsControllers,
  toNumber,
} from "@/utils/hardwareAudit";
import { BackupManagementPanels, BackupRestoreModal } from "@/components/backup-management";
import { AnalysisDistribution, analysisDistribution } from "@/components/analysis/AnalysisDistribution";
import {
  buildHardwareInventoryRows,
  buildHardwareQueryItems,
  filterHardwareQueryItems,
  observationComparableFields,
} from "@/components/analysis/analysisData";
import {
  COLLECTION_BAND_META,
  HARDWARE_INVENTORY_OPTIONS,
  createEmptyHardwareQuery,
  type AnalysisTabKey,
  type AnalysisViewKey,
  type AssetPlanningView,
  type DataHealthView,
  type HardwareAnalysisView,
  type HardwareChangeRow,
  type HardwareInventoryKey,
  type HardwareQueryItem,
  type HardwareQueryState,
  type AssetCompletenessRow,
  type RenewalCandidateRow,
} from "@/components/analysis/analysisTypes";
import { HardwareInventoryView } from "@/components/analysis/HardwareInventoryView";
import { HardwareQueryView } from "@/components/analysis/HardwareQueryView";
import { CollectionHealthView } from "@/components/analysis/CollectionHealthView";
import { DataQualityView } from "@/components/analysis/DataQualityView";
import { HardwareChangesView } from "@/components/analysis/HardwareChangesView";
import { RenewalView, ValueOverviewView } from "@/components/analysis/AssetPlanningViews";

const { Text, Title } = Typography;

const ASSET_TYPES: Array<{ label: string; value: AssetType }> = [
  { label: "电脑", value: "computer" },
  { label: "自定义", value: "custom" },
];

const DEFAULT_CUSTOM_CATEGORIES = ["显卡", "手机", "机房设备", "网络设备", "办公设备"];

const DEFAULT_COMPUTER_DEVICE_TYPE = "台式电脑";
const COMPUTER_DEVICE_TYPE_OPTIONS = ["笔记本", DEFAULT_COMPUTER_DEVICE_TYPE, "苹果电脑", "一体机"].map((value) => ({
  label: value,
  value,
}));

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
  { label: "归档", value: "deleted" },
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
type FinancialDataStatus = NonNullable<AssetListParams["financialDataStatus"]>;

const FINANCIAL_DATA_STATUS_OPTIONS: Array<{ label: string; value: FinancialDataStatus }> = [
  { label: "缺采购价", value: "missing_purchase_price" },
  { label: "缺二手市场价", value: "missing_second_hand_market_value" },
  { label: "两项都缺", value: "missing_both" },
  { label: "财务资料完整", value: "complete" },
];

interface SavedAssetFilter {
  id: string;
  name: string;
  assetScope: AssetScope;
  assetType?: AssetType;
  status?: string;
  search?: string;
  category?: string;
  purchasePlatform?: string;
  financialDataStatus?: FinancialDataStatus;
}

const ASSET_IMPORT_FIELDS = [
  { label: "资产编号", value: "assetNumber", required: true },
  { label: "资产名称", value: "name" },
  { label: "资产类型", value: "assetType" },
  { label: "使用人", value: "ownerName" },
  { label: "部门", value: "department" },
  { label: "状态", value: "status" },
  { label: "设备类型 / 分类", value: "category" },
  { label: "购置价格", value: "purchasePrice" },
  { label: "二手市场价", value: "secondHandMarketValue" },
  { label: "账面净值（估算）", value: "financialResidualValue" },
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
  | "secondHandMarketValue"
  | "financialResidualValue"
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
type AssetExportFormat = "xlsx" | "csv";
type AssetExportColorMode = "row" | "status-cell";
type AssetExportStatusColors = Record<string, string>;

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

const formatDateOnly = (value?: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN");
};

const computerDeviceType = (value?: string) => {
  const normalized = String(value || "").trim();
  return !normalized || normalized === "computer" || normalized === "台式机"
    ? DEFAULT_COMPUTER_DEVICE_TYPE
    : normalized;
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

const fetchAllObservations = async () => {
  const first = await getObservations({ page: 1, pageSize: 100 });
  const observations = [...first.data];
  const totalPages = first.pagination.totalPages || 1;
  for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
    const next = await getObservations({ page: nextPage, pageSize: 100 });
    observations.push(...next.data);
  }
  return observations;
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

const cardGraphicsLabel = (value: unknown, cpu?: unknown) => {
  const text = hardwareModelLabel(value, "-")
    .replace(/\bNVIDIA\s+(?:GeForce\s+)?/gi, "")
    .replace(/\bIntel(?:\(R\)|®)?\s*/gi, "")
    .replace(/\bAMD\s+/gi, "")
    .replace(/\(R\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/Microsoft\s+(?:Basic Display Adapter|基本显示适配器)|Microsoft\s*基本显示适配器/i.test(text)) {
    return inferredGraphicsForFallbackDriver(cpu);
  }
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

const downloadBlobFile = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const compatibilityAliases: Partial<Record<AssetImportFieldKey, string[]>> = {
    category: ["分类", "设备类型"],
    financialResidualValue: ["财务残值", "账面净值"],
    secondHandMarketValue: ["residualValue", "残值", "二手价"],
  };
  return pickRowValue(row, [field, fieldConfig?.label || "", ...(compatibilityAliases[field] || [])]);
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

const calculateFinancialResidualValue = (
  purchasePrice: number,
  purchaseDate: string,
  depreciationPeriodMonths: number,
  residualRate: number,
  now = new Date()
) => {
  const price = Math.max(0, Number(purchasePrice || 0));
  const periodMonths = Math.max(1, Math.round(Number(depreciationPeriodMonths || 0)));
  const normalizedRate = Math.min(100, Math.max(0, Number(residualRate || 0)));
  const purchasedAt = new Date(purchaseDate);
  if (!price || !purchaseDate || Number.isNaN(purchasedAt.getTime())) {
    return null;
  }
  const monthDifference = (now.getFullYear() - purchasedAt.getFullYear()) * 12 + now.getMonth() - purchasedAt.getMonth();
  const elapsedMonths = Math.max(0, monthDifference - (now.getDate() < purchasedAt.getDate() ? 1 : 0));
  const depreciatedMonths = Math.min(periodMonths, elapsedMonths);
  const terminalResidual = price * (normalizedRate / 100);
  const monthlyDepreciation = (price - terminalResidual) / periodMonths;
  return Math.round(Math.max(terminalResidual, price - monthlyDepreciation * depreciatedMonths) * 100) / 100;
};

type FinancialResidualMode = "auto" | "manual";

const financialResidualMode = (asset?: Asset | null): FinancialResidualMode => {
  const finance = getRecord(getRecord(asset?.metadata).finance);
  const configuredMode = String(finance.financial_residual_mode || "");
  if (configuredMode === "auto" || configuredMode === "manual") {
    return configuredMode;
  }
  // Preserve explicitly recorded historical values; assets without one enter the new automatic mode.
  return Number(asset?.financialResidualValue || 0) > 0 ? "manual" : "auto";
};

const calculatedFinancialResidualForAsset = (asset: Asset, settings?: InventorySettings) => {
  if (!settings) {
    return null;
  }
  return calculateFinancialResidualValue(
    asset.purchasePrice,
    assetPurchaseDateText(asset),
    settings.depreciationPeriodMonths,
    settings.defaultResidualRate
  );
};

const effectiveFinancialResidualValue = (asset: Asset, settings?: InventorySettings) => {
  if (asset.status === "retired") {
    return 0;
  }
  if (financialResidualMode(asset) === "manual") {
    return Number(asset.financialResidualValue || 0);
  }
  return calculatedFinancialResidualForAsset(asset, settings) ?? Number(asset.financialResidualValue || 0);
};

const assetUpdateTimeText = (asset: Asset) =>
  formatDate(asset.latestObservation?.observedAt || asset.updatedAt);

const assetUpdateDateText = (asset: Asset) =>
  formatDateOnly(asset.latestObservation?.observedAt || asset.updatedAt);

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
  financialDataStatus: params.financialDataStatus || "",
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

const DEFAULT_ASSET_EXPORT_FIELD_KEYS = ASSET_EXPORT_FIELDS
  .filter((field) => field.defaultChecked)
  .map((field) => field.key);

const selectedAssetExportFields = (fieldKeys: AssetExportFieldKey[]) => fieldKeys
  .map((key) => ASSET_EXPORT_FIELDS.find((field) => field.key === key))
  .filter((field): field is (typeof ASSET_EXPORT_FIELDS)[number] => Boolean(field));

const exportableAssets = (assets: Asset[]) => assets.filter((asset) => asset.status !== "deleted");

const assetsToCsv = (assets: Asset[], fieldKeys: AssetExportFieldKey[] = DEFAULT_ASSET_EXPORT_FIELD_KEYS) => {
  const fields = selectedAssetExportFields(fieldKeys);
  const selectedFields = fields.length ? fields : ASSET_EXPORT_FIELDS.filter((field) => field.defaultChecked);
  const headers = selectedFields.map((field) => field.label);
  const rows = assets.map((asset) => selectedFields.map((field) => field.value(asset)));
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
};

const ASSET_EXPORT_COLOR_STORAGE_KEY = "npcink-device-inventory.exportStatusColors";
const DEFAULT_ASSET_EXPORT_STATUS_COLORS: AssetExportStatusColors = {
  active: "",
  inactive: "#e7e9ec",
  maintenance: "#ffe7ba",
  retired: "#d6e4ff",
  deleted: "#ffd6d6",
};

const loadAssetExportStatusColors = (): AssetExportStatusColors => {
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

const exportAssetWorkbook = async (
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
        label: key === "category" && isComputerAsset(asset) ? "设备类型" : label,
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
const DESKTOP_RELEASE_URL = "https://github.com/npcink/npcink-device-inventory/releases/latest";

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

const formatDisplayResolution = (display: JsonRecord) => {
  const width = firstText(display.currentResX, display.resolutionX);
  const height = firstText(display.currentResY, display.resolutionY);
  return width && height ? `${width} x ${height}` : "";
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
  context: ReturnType<typeof assetHardwareContext>,
  settings?: InventorySettings
): DetailSpecSection[] => {
  const hardware = context.hardware;
  const summary = context.summary;
  const cpu = getRecord(hardware.cpu);
  const graphics = getRecord(hardware.graphics);
  const controllers = physicalGraphicsControllers(graphics);
  const displays = getArray(graphics.displays);
  const baseboard = getRecord(hardware.baseboard);
  const bios = getRecord(hardware.bios);
  const os = getRecord(hardware.os);
  const system = getRecord(hardware.system);
  const chassis = getRecord(hardware.chassis);
  const uuid = getRecord(hardware.uuid);
  const net = getRecord(hardware.net);
  const networkRecord = getRecord(hardware.network);
  const primaryNetwork = getRecord(networkRecord.primary);
  const network = getArray(networkRecord.interfaces).length
    ? getArray(networkRecord.interfaces)
    : getArray(hardware.network).length
      ? getArray(hardware.network)
      : getArray(net.adapters);
  const batteries = getArray(hardware.battery);
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
        detailRow("category", "类型", computerDeviceType(asset.category)),
        detailRow("purchase", "购置价值", formatMoney(asset.purchasePrice)),
        detailRow("secondHandMarketValue", "二手市场价", formatMoney(asset.secondHandMarketValue)),
        detailRow("financialResidualValue", "账面净值（估算）", formatMoney(effectiveFinancialResidualValue(asset, settings))),
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
      key: "battery",
      label: "电池",
      rows: detailRows(
        ...batteries.flatMap((item, index) => [
          detailRow(`battery-${index}-name`, `电池 ${index + 1}`, firstText(item.name, item.deviceId)),
          detailRow(`battery-${index}-health`, `电池 ${index + 1} 健康度`, item.healthPercent !== undefined && item.healthPercent !== null ? `${item.healthPercent}%` : ""),
          detailRow(`battery-${index}-charge`, `电池 ${index + 1} 当前电量`, item.chargePercent !== undefined && item.chargePercent !== null ? `${item.chargePercent}%` : ""),
          detailRow(`battery-${index}-cycles`, `电池 ${index + 1} 循环次数`, item.cycleCount),
          detailRow(`battery-${index}-condition`, `电池 ${index + 1} 状态`, firstText(item.condition, item.status)),
          detailRow(`battery-${index}-serial`, `电池 ${index + 1} 序列号`, item.serial),
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
          detailRow(`display-${index}-model`, `显示器 ${index + 1} 型号`, item.model),
          detailRow(`display-${index}-vendor`, `显示器 ${index + 1} 厂商`, item.vendor),
          detailRow(`display-${index}-serial`, `显示器 ${index + 1} 序列号`, item.serial),
          detailRow(`display-${index}-resolution`, `显示器 ${index + 1} 分辨率`, formatDisplayResolution(item)),
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
          detailRow(`disk-${index}-type`, `硬盘 ${index + 1} 类型`, firstText(item.type, item.mediaType)),
          detailRow(`disk-${index}-interface`, `硬盘 ${index + 1} 接口`, item.interfaceType),
          detailRow(`disk-${index}-serial`, `硬盘 ${index + 1} 序列号`, firstText(item.serialNum, item.serial, item.serialNumber)),
        ])
      ),
    },
    {
      key: "network",
      label: "网卡",
      rows: detailRows(
        detailRow("network-ip", "IP 地址", firstText(context.extracted.primaryIp, context.manualHardware.ip)),
        detailRow("network-gateway", "默认网关", firstText(primaryNetwork.defaultGateway, primaryNetwork.gateway, net.defaultGateway, net.gateway)),
        detailRow("network-dns", "DNS", Array.isArray(primaryNetwork.dnsServers) ? primaryNetwork.dnsServers.map(String).join(", ") : ""),
        detailRow("network-dhcp", "DHCP", typeof primaryNetwork.dhcp === "boolean" ? (primaryNetwork.dhcp ? "启用" : "停用") : ""),
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
  depreciation: "二手市场价",
  residualValue: "二手市场价（兼容字段）",
  secondHandMarketValue: "二手市场价",
  financialResidualValue: "账面净值（估算）",
  residual_value: "二手市场价",
  financial_residual_value: "账面净值（估算）",
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
  financialResidualMode?: FinancialResidualMode;
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
  const existingFinance = getRecord(metadata.finance);
  return {
    assetType: values.assetType,
    assetNumber: values.assetNumber,
    name: values.name,
    ownerName: values.ownerName,
    department: values.department,
    status: values.status,
    category: values.category,
    purchasePrice: Number(values.purchasePrice || 0),
    secondHandMarketValue: Number(values.secondHandMarketValue || 0),
    financialResidualValue: Number(values.financialResidualValue || 0),
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
      finance: {
        ...existingFinance,
        financial_residual_mode: values.financialResidualMode || "auto",
      },
    },
  };
};

const AssetFormModal = ({ asset, open, departmentOptions = [], onClose, onSubmit }: AssetFormModalProps) => {
  const [form] = Form.useForm<AssetFormValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const customInfo = useMemo(() => (asset ? customAssetInfo(asset) : null), [asset]);
  const showCustomFields = !asset || !isComputerAsset(asset);
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      Number(watchedPurchasePrice || 0),
      String(watchedPurchaseDate || asset?.createdAt || ""),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset?.createdAt, settingsQuery.data, watchedPurchaseDate, watchedPurchasePrice]);

  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);

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
      category: asset && isComputerAsset(asset) ? computerDeviceType(asset.category) : asset?.category || "",
      status: asset?.status || "active",
      purchasePrice: asset?.purchasePrice || 0,
      secondHandMarketValue: asset?.secondHandMarketValue || 0,
      financialResidualValue: asset?.financialResidualValue || 0,
      financialResidualMode: financialResidualMode(asset),
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
      okText={asset ? "保存" : "确认录入"}
      cancelText="取消"
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
            <Form.Item name="category" label={showCustomFields ? "分类" : "设备类型"}>
              {showCustomFields ? (
                <Input placeholder="例如：显卡、手机、机房设备" />
              ) : (
                <Select
                  allowClear
                  options={COMPUTER_DEVICE_TYPE_OPTIONS}
                  placeholder="选择设备类型"
                  popupMatchSelectWidth={false}
                />
              )}
            </Form.Item>
            <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
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
                <Form.Item name="secondHandMarketValue" label="二手市场价">
                  <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
                <Form.Item name="financialResidualMode" label="账面净值方式">
                  <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
                </Form.Item>
                <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
                  <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
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
            <Form.Item name="secondHandMarketValue" label="二手市场价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="financialResidualMode" label="账面净值方式">
              <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
            </Form.Item>
            <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
              <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
          </div>
        )}
        <div className="npcink-v3-finance-summary">
          <span>
            系统估算账面净值：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}
          </span>
          <span>当前方式：{watchedFinancialResidualMode === "manual" ? "手动设置" : "自动计算"}</span>
        </div>
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
      const executable = rows.filter((row) => row.action === "create" || row.action === "update");
      const result = await importAssets(executable.map((row) => ({
        operation: row.action as "create" | "update",
        uuid: row.existing?.uuid,
        input: row.input,
      })));
      return { ...result, skipped: rows.length - executable.length };
    },
    {
      onSuccess: (result) => {
        onImported();
        message.success(`导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`);
        setRawText("");
        setPreviewRows([]);
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
          disabled={
            settingsQuery.isError ||
            settingsQuery.isLoading ||
            existingAssetsQuery.isError ||
            existingAssetsQuery.isLoading ||
            !previewRows.some((row) => row.action === "create" || row.action === "update")
          }
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
        {settingsQuery.isError || existingAssetsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="导入预检数据加载失败"
            description="无法安全判断部门和已有资产，请重试后再导入。"
            action={<Button onClick={() => { settingsQuery.refetch(); existingAssetsQuery.refetch(); }}>重试</Button>}
          />
        ) : null}
        <Alert type="success" showIcon message="导入使用单次服务端事务" description="任意一行写入失败时，本次可执行数据会全部回滚，不会留下半导入。" />
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
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const [scope, setScope] = useState<AssetExportScope>("current-filter");
  const [fieldKeys, setFieldKeys] = useState<AssetExportFieldKey[]>(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
  const [format, setFormat] = useState<AssetExportFormat>("xlsx");
  const [statusColors, setStatusColors] = useState<AssetExportStatusColors>(loadAssetExportStatusColors);
  const [colorMode, setColorMode] = useState<AssetExportColorMode>("row");
  const [draggedField, setDraggedField] = useState<AssetExportFieldKey>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLeftOffset, setPreviewLeftOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportParams: Record<Exclude<AssetExportScope, "current-filter" | "selected">, AssetListParams> = {
    computer: { assetScope: "computer" },
    custom: { assetScope: "other" },
    all: { assetScope: "all" },
  };

  useEffect(() => {
    if (open) {
      setScope(selectedAssets.length ? "selected" : "current-filter");
      setFieldKeys(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
      setFormat("xlsx");
      setStatusColors(loadAssetExportStatusColors());
      setColorMode("row");
      setPreviewOpen(false);
    }
  }, [open, selectedAssets.length]);

  useEffect(() => {
    if (!previewOpen) return;
    const updatePreviewOffset = () => {
      const menu = document.getElementById("adminmenuwrap");
      const right = menu?.getBoundingClientRect().right || 0;
      setPreviewLeftOffset(right > 0 && right < window.innerWidth * 0.4 ? Math.round(right) : 0);
    };
    updatePreviewOffset();
    window.addEventListener("resize", updatePreviewOffset);
    return () => window.removeEventListener("resize", updatePreviewOffset);
  }, [previewOpen]);

  const previewParams = scope === "current-filter" ? currentQueryParams : scope === "selected" ? undefined : exportParams[scope];
  const previewQuery = useQuery(
    ["v3-export-preview", scope, previewParams],
    () => getAssets({ ...previewParams, page: 1, pageSize: 30 }),
    { enabled: open && previewOpen && scope !== "selected", staleTime: 30_000 }
  );
  const selectedExportAssets = exportableAssets(selectedAssets);
  const previewAssets = exportableAssets(scope === "selected" ? selectedAssets : previewQuery.data?.data || []).slice(0, 30).map((asset) => ({
    ...asset,
    financialResidualValue: effectiveFinancialResidualValue(asset, settingsQuery.data),
  }));
  const previewFields = selectedAssetExportFields(fieldKeys);

  const toggleField = (key: AssetExportFieldKey, checked: boolean) => {
    setFieldKeys((keys) => checked ? [...keys, key] : keys.filter((item) => item !== key));
  };
  const moveField = (target: AssetExportFieldKey) => {
    if (!draggedField || draggedField === target) return;
    setFieldKeys((keys) => {
      const next = keys.filter((key) => key !== draggedField);
      next.splice(next.indexOf(target), 0, draggedField);
      return next;
    });
    setDraggedField(undefined);
  };
  const saveColorDefaults = () => {
    window.localStorage.setItem(ASSET_EXPORT_COLOR_STORAGE_KEY, JSON.stringify(statusColors));
    message.success("状态颜色已保存为默认方案");
  };

  const exportAssets = async () => {
    if (!fieldKeys.length) {
      message.warning("请至少选择一个导出字段");
      return;
    }
    setExporting(true);
    try {
      const assets = exportableAssets(scope === "selected"
        ? selectedAssets
        : await fetchAllAssets(scope === "current-filter" ? currentQueryParams : exportParams[scope]));
      if (!assets.length) {
        message.warning("当前范围没有可导出的未归档资产");
        return;
      }
      const exportAssetsWithEffectiveFinancialValue = assets.map((asset) => ({
        ...asset,
        financialResidualValue: effectiveFinancialResidualValue(asset, settingsQuery.data),
      }));
      if (format === "xlsx") {
        await exportAssetWorkbook(exportAssetsWithEffectiveFinancialValue, fieldKeys, statusColors, colorMode);
      } else {
        downloadCsvFile(`电脑设备-${Date.now()}.csv`, assetsToCsv(exportAssetsWithEffectiveFinancialValue, fieldKeys));
      }
      message.success(`已导出 ${assets.length} 条资产`);
      setPreviewOpen(false);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "表格导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  };
  const currentFilterCountText =
    typeof currentTotal === "number" ? `${currentTotal} 条` : "导出时计算";
  const previewTotalText = scope === "current-filter"
    ? currentFilterCountText
    : scope === "selected"
      ? `${selectedExportAssets.length} 条`
      : previewQuery.data
        ? `${previewQuery.data.pagination.totalItems} 条`
        : "计算中";
  const previewScopeLabel = scope === "current-filter"
    ? `${currentScopeLabel}（当前筛选）`
    : scope === "selected"
      ? "已勾选资产"
      : scope === "computer"
        ? "全部电脑设备"
        : scope === "custom"
          ? "全部自定义设备"
          : "全部资产";

  return (
    <>
    <Modal
      title="资产表格导出"
      open={open}
      onCancel={onClose}
      width={820}
      destroyOnClose
      className="npcink-v3-export-modal"
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="preview" disabled={!fieldKeys.length} onClick={() => setPreviewOpen(true)}>预览表格</Button>,
        <Button key="export" type="primary" loading={exporting} disabled={!fieldKeys.length} onClick={exportAssets}>{format === "xlsx" ? "导出 Excel" : "导出 CSV"}</Button>,
      ]}
    >
      <div className="npcink-v3-export-config">
        <section>
          <Text strong>文件格式</Text>
          <Radio.Group
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            options={[
              { label: "Excel（推荐，包含状态颜色）", value: "xlsx" },
              { label: "CSV（通用，无颜色）", value: "csv" },
            ]}
          />
          {format === "csv" ? <Alert type="info" showIcon message="CSV 不保存颜色和单元格样式，预览窗口仅展示数据内容。" /> : null}
        </section>
        <section>
          <Text strong>导出范围</Text>
          <Text type="secondary" className="npcink-v3-export-range-note">
            符合当前筛选条件的数据，就是资产列表里筛选后的全部结果，不只是当前页；已归档设备始终不会导出。
          </Text>
          <Radio.Group className="npcink-v3-export-scope-grid" value={scope} onChange={(event) => setScope(event.target.value)}>
            <Radio value="current-filter"><strong>当前筛选结果</strong><small>{currentScopeLabel} · {currentFilterCountText}</small></Radio>
            {selectedAssets.length ? <Radio value="selected"><strong>已勾选设备</strong><small>可导出 {selectedExportAssets.length} 条（自动排除已归档）</small></Radio> : <div className="npcink-v3-export-scope-empty"><strong>已勾选设备</strong><small>尚未选择设备，请先在资产列表进入批量模式并勾选。</small></div>}
            <Radio value="computer"><strong>全部电脑设备</strong><small>不受当前筛选条件影响</small></Radio>
            <Radio value="custom"><strong>全部自定义设备</strong><small>不受当前筛选条件影响</small></Radio>
            <Radio value="all"><strong>全部资产</strong><small>忽略当前筛选，包含电脑与自定义设备</small></Radio>
          </Radio.Group>
        </section>
        <section>
          <div className="npcink-v3-export-section-head"><Text strong>导出字段</Text><Text type="secondary">已选 {fieldKeys.length} 个，可拖动排序</Text></div>
          <div className="npcink-v3-export-field-toolbar">
            <div><Text type="secondary">常用方案</Text><Space wrap size={6}>
              <Button type="primary" ghost size="small" onClick={() => setFieldKeys(["assetNumber", "ownerName", "department", "status", "purchasePrice", "secondHandMarketValue", "financialResidualValue", "baseboard", "cpu"])}>推荐电脑台账</Button>
              <Button size="small" onClick={() => setFieldKeys(["assetNumber", "name", "ownerName", "department", "status", "purchasePrice", "secondHandMarketValue", "financialResidualValue", "purchaseDate"])}>财务台账</Button>
              <Button size="small" onClick={() => setFieldKeys(["assetNumber", "ownerName", "department", "status", "cpu", "memory", "disk", "graphics", "deviceModel", "baseboard", "ip"])}>硬件配置</Button>
            </Space></div>
            <Space size={6}><Button size="small" onClick={() => setFieldKeys(ASSET_EXPORT_FIELDS.map((field) => field.key))}>全选</Button><Button danger type="text" size="small" onClick={() => setFieldKeys([])}>清空</Button></Space>
          </div>
          {fieldKeys.length ? <div className="npcink-v3-export-field-order">
            {previewFields.map((field) => <button key={field.key} type="button" draggable onDragStart={() => setDraggedField(field.key)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveField(field.key)}>{field.label}<span>⋮⋮</span></button>)}
          </div> : null}
          <div className="npcink-v3-export-fields">
            {["基础信息", "财务信息", "硬件信息", "系统信息"].map((group) => (
              <div key={group}>
                <div className="npcink-v3-export-field-group-head">
                  <Text type="secondary">{group} {ASSET_EXPORT_FIELDS.filter((field) => field.group === group && fieldKeys.includes(field.key)).length}/{ASSET_EXPORT_FIELDS.filter((field) => field.group === group).length}</Text>
                  <Space size={4}><Button type="link" size="small" onClick={() => setFieldKeys((keys) => [...keys, ...ASSET_EXPORT_FIELDS.filter((field) => field.group === group && !keys.includes(field.key)).map((field) => field.key)])}>全选本组</Button><Button type="link" size="small" onClick={() => setFieldKeys((keys) => keys.filter((key) => ASSET_EXPORT_FIELDS.find((field) => field.key === key)?.group !== group))}>清空本组</Button></Space>
                </div>
                <div className="npcink-v3-export-field-options">{ASSET_EXPORT_FIELDS.filter((field) => field.group === group).map((field) => <Checkbox key={field.key} checked={fieldKeys.includes(field.key)} onChange={(event) => toggleField(field.key, event.target.checked)}>{field.label}</Checkbox>)}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="npcink-v3-export-section-head"><Text strong>状态颜色</Text><Text type="secondary">仅 Excel 生效</Text></div>
          <Radio.Group disabled={format === "csv"} value={colorMode} onChange={(event) => setColorMode(event.target.value)} options={[{ label: "整行背景", value: "row" }, { label: "仅状态单元格", value: "status-cell" }]} />
          <div className={`npcink-v3-export-colors${format === "csv" ? " is-disabled" : ""}`}>
            {STATUS_OPTIONS.map((status) => <div key={status.value}><span>{status.label}</span><input type="color" disabled={format === "csv"} value={statusColors[status.value] || "#ffffff"} onChange={(event) => setStatusColors((colors) => ({ ...colors, [status.value]: event.target.value }))} /><Button size="small" disabled={format === "csv" || !statusColors[status.value]} onClick={() => setStatusColors((colors) => ({ ...colors, [status.value]: "" }))}>不填色</Button></div>)}
          </div>
          <Space wrap><Button size="small" disabled={format === "csv"} onClick={() => setStatusColors({ ...DEFAULT_ASSET_EXPORT_STATUS_COLORS })}>恢复默认</Button><Button size="small" disabled={format === "csv"} onClick={saveColorDefaults}>保存为默认方案</Button></Space>
        </section>
      </div>
    </Modal>
    <Modal
      title="导出表格预览"
      open={previewOpen}
      onCancel={() => setPreviewOpen(false)}
      width={`calc(100vw - ${previewLeftOffset + 32}px)`}
      style={{ marginLeft: previewLeftOffset + 16, marginRight: 16 }}
      className="npcink-v3-export-preview-modal"
      destroyOnClose
      footer={[
        <Button key="back" onClick={() => setPreviewOpen(false)}>返回修改</Button>,
        <Button key="export" type="primary" loading={exporting} onClick={exportAssets}>{format === "xlsx" ? "确认导出 Excel" : "确认导出 CSV"}</Button>,
      ]}
    >
      <div className="npcink-v3-export-preview-summary">
        <div><Text strong>{previewScopeLabel}</Text><Text type="secondary">预览前 {previewAssets.length} 条，导出时包含范围内全部数据。</Text></div>
        <Text type="secondary">{previewTotalText} · {fieldKeys.length} 列 · {format === "xlsx" ? "Excel" : "CSV"}{format === "xlsx" ? ` · ${colorMode === "row" ? "整行着色" : "状态单元格着色"}` : ""}</Text>
      </div>
      <div className="npcink-v3-export-preview-table is-fullscreen">
        {fieldKeys.length ? <table><thead><tr>{previewFields.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{previewAssets.map((asset) => <tr key={asset.uuid}>{previewFields.map((field) => {
          const colored = format === "xlsx" && statusColors[asset.status] && (colorMode === "row" || field.key === "status");
          return <td key={field.key} style={colored ? { backgroundColor: statusColors[asset.status] } : undefined} title={String(field.value(asset) ?? "")}>{String(field.value(asset) ?? "") || "-"}</td>;
        })}</tr>)}</tbody></table> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择至少一个导出字段" />}
        {previewQuery.isLoading && scope !== "selected" ? <div className="npcink-v3-export-preview-loading">正在加载预览…</div> : null}
      </div>
    </Modal>
    </>
  );
};

interface BulkEditModalProps {
  open: boolean;
  count: number;
  loading: boolean;
  categoryMode: "computer" | "custom" | "mixed";
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

const BulkEditModal = ({ open, count, loading, categoryMode, departmentOptions = [], onClose, onSubmit }: BulkEditModalProps) => {
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
      okText="确认修改"
      cancelText="取消"
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
        <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
          <Select allowClear options={EDITABLE_STATUS_OPTIONS} placeholder="统一修改状态" />
        </Form.Item>
        {categoryMode === "computer" ? (
          <Form.Item name="category" label="设备类型" extra="留空表示不修改。">
            <Select
              allowClear
              options={COMPUTER_DEVICE_TYPE_OPTIONS}
              placeholder="统一修改设备类型"
              popupMatchSelectWidth={false}
            />
          </Form.Item>
        ) : categoryMode === "custom" ? (
          <Form.Item name="category" label="分类" extra="留空表示不修改。">
            <Input placeholder="统一修改分类" />
          </Form.Item>
        ) : (
          <Form.Item label="设备类型 / 分类" extra="电脑与自定义资产含义不同，请按同一资产类型分批修改。">
            <Input disabled placeholder="混合选择时不可修改" />
          </Form.Item>
        )}
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
      <Alert
        type="info"
        showIcon
        message="先下载客户端，再导入配置"
        description={
          <Space direction="vertical" size={4}>
            <Text>支持 Windows x64 和 macOS Apple Silicon。安装包尚未完成平台代码签名，仅建议在可信内部环境使用。</Text>
            <Button type="link" href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">打开客户端下载页</Button>
          </Space>
        }
      />
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
  financialResidualMode?: FinancialResidualMode;
};

const AssetSettingsPanel = ({ asset, departmentOptions = [], onUpdated, onArchive }: AssetSettingsPanelProps) => {
  const [form] = Form.useForm<AssetSettingsValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const settingsHardware = assetHardwareContext(asset);
  const primaryIp = firstText(settingsHardware.extracted.primaryIp, settingsHardware.manualHardware.ip);
  const normalizedDepartmentOptions = useMemo(
    () => normalizeDepartmentList(departmentOptions),
    [departmentOptions]
  );
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualValue = Form.useWatch("financialResidualValue", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const financialResidualValue = Number(watchedFinancialResidualValue ?? asset.financialResidualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((financialResidualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      purchasePrice,
      String(watchedPurchaseDate || asset.createdAt),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset.createdAt, purchasePrice, settingsQuery.data, watchedPurchaseDate]);
  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);
  const updateMutation = useMutation(
    (values: AssetSettingsValues) => {
      const metadata = getRecord(asset.metadata);
      const existingPurchase = getRecord(metadata.purchase);
      const existingFinance = getRecord(metadata.finance);
      return updateAsset(asset.uuid, {
        assetNumber: values.assetNumber,
        name: values.name ?? asset.name,
        ownerName: values.ownerName,
        department: values.department,
        status: values.status,
        category: values.category,
        purchasePrice: Number(values.purchasePrice || 0),
        secondHandMarketValue: Number(values.secondHandMarketValue || 0),
        financialResidualValue: Number(values.financialResidualValue || 0),
        metadata: {
          ...metadata,
          purchase: {
            ...existingPurchase,
            order_time: values.orderTime || "",
            total: Number(values.purchasePrice || 0),
          },
          finance: {
            ...existingFinance,
            financial_residual_mode: values.financialResidualMode || "auto",
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
      category: computerDeviceType(asset.category),
      purchasePrice: asset.purchasePrice,
      secondHandMarketValue: asset.secondHandMarketValue,
      financialResidualValue: asset.financialResidualValue,
      financialResidualMode: financialResidualMode(asset),
      orderTime: formatDateInput(assetPurchaseDateText(asset)),
    });
  }, [asset, form]);

  return (
    <div className="npcink-v3-settings-panel npcink-v3-detail-settings">
      <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
        <div className="npcink-v3-settings-section">
          <h4>基础信息</h4>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item name="assetNumber" label="编号">
              <Input />
            </Form.Item>
            <Form.Item label="IP 地址">
              <Input value={primaryIp} readOnly placeholder="暂无采集 IP" />
            </Form.Item>
          </div>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item
              name="department"
              label={(
                <span className="npcink-v3-form-label-with-help">
                  部门
                  <Tooltip title="只能选择设置中维护的部门；未选择时会归入未分配。">
                    <InfoCircleOutlined tabIndex={0} aria-label="部门填写说明" />
                  </Tooltip>
                </span>
              )}
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
            <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="category" label="设备类型">
              <Select
                allowClear
                options={COMPUTER_DEVICE_TYPE_OPTIONS}
                placeholder="选择设备类型"
                popupMatchSelectWidth={false}
              />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-settings-section">
          <h4>财务参数</h4>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item name="purchasePrice" label="采购价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="secondHandMarketValue" label="二手市场价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="financialResidualMode" label="账面净值方式">
              <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
            </Form.Item>
            <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
              <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item
              name="orderTime"
              label="购置日期"
              normalize={(value) => value ? value.format("YYYY-MM-DD") : ""}
              getValueProps={(value) => {
                const date = value ? dayjs(value) : null;
                return { value: date?.isValid() ? date : null };
              }}
            >
              <DatePicker
                format="YYYY-MM-DD"
                placeholder="选择购置日期"
                allowClear
                className="npcink-v3-date-picker"
              />
            </Form.Item>
          </div>
          <div className="npcink-v3-finance-summary">
            <span>折旧率：{depreciationRate}%</span>
            <span>账面净值：{formatMoney(financialResidualValue)}</span>
            <span>账面净值率：{residualRate}%</span>
            <span>系统估算：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}</span>
            <span>当前采用：{watchedFinancialResidualMode === "manual" ? "手动值" : "系统估算值"}</span>
          </div>
        </div>

        <div className="npcink-v3-settings-actions">
          <Button type="primary" htmlType="submit" loading={updateMutation.isLoading}>
            保存设置
          </Button>
          <Button danger type="text" onClick={() => onArchive(asset)}>
            归档设备
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
  secondHandMarketValue?: number;
  financialResidualValue?: number;
  financialResidualMode?: FinancialResidualMode;
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
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const info = useMemo(() => customAssetInfo(asset), [asset]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualValue = Form.useWatch("financialResidualValue", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const financialResidualValue = Number(watchedFinancialResidualValue ?? asset.financialResidualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((financialResidualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      purchasePrice,
      String(watchedPurchaseDate || asset.createdAt),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset.createdAt, purchasePrice, settingsQuery.data, watchedPurchaseDate]);
  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);
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
      const existingFinance = getRecord(metadata.finance);
      return updateAsset(asset.uuid, {
        name: values.name,
        assetNumber: values.assetNumber,
        ownerName: values.ownerName,
        status: values.status,
        category: values.category,
        purchasePrice: Number(values.purchasePrice || 0),
        secondHandMarketValue: Number(values.secondHandMarketValue || 0),
        financialResidualValue: Number(values.financialResidualValue || 0),
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
          finance: {
            ...existingFinance,
            financial_residual_mode: values.financialResidualMode || "auto",
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
      secondHandMarketValue: asset.secondHandMarketValue,
      financialResidualValue: asset.financialResidualValue,
      financialResidualMode: financialResidualMode(asset),
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
            <Form.Item name="status" label="当前状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
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
            <Form.Item name="secondHandMarketValue" label="二手市场价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
            </Form.Item>
            <Form.Item name="financialResidualMode" label="账面净值方式">
              <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
            </Form.Item>
            <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
              <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
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
            <span>账面净值：{formatMoney(financialResidualValue)}</span>
            <span>账面净值率：{residualRate}%</span>
            <span>系统估算：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}</span>
            <span>当前采用：{watchedFinancialResidualMode === "manual" ? "手动值" : "系统估算值"}</span>
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
            归档设备
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
  readOnly?: boolean;
}

const CustomAssetDetail = ({
  asset,
  autoRecordRows,
  onUpdated,
  onArchive,
  readOnly = false,
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
        ...(!readOnly ? [{
          key: "settings",
          label: "信息修改",
          children: (
            <CustomAssetSettingsPanel
              asset={asset}
              onUpdated={onUpdated}
              onArchive={onArchive}
            />
          ),
        }] : []),
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
  readOnly?: boolean;
  previousAsset?: Asset;
  nextAsset?: Asset;
  navigationLabel?: string;
  onNavigate?: (asset: Asset) => void;
}

const DetailDrawer = ({
  uuid,
  open,
  initialAsset = null,
  departmentOptions = [],
  onClose,
  onArchive,
  readOnly = false,
  previousAsset,
  nextAsset,
  navigationLabel,
  onNavigate,
}: DetailDrawerProps) => {
  const queryClient = useQueryClient();
  const [manualRecordOpen, setManualRecordOpen] = useState(false);
  const [manualRecordKeyword, setManualRecordKeyword] = useState("");
  const [manualRecordSearch, setManualRecordSearch] = useState("");
  const [activeDetailKey, setActiveDetailKey] = useState("processor");
  const [autoRecordSearch, setAutoRecordSearch] = useState("");
  const enabled = Boolean(uuid && open);
  const assetQuery = useQuery(["v3-asset", uuid], () => getAsset(uuid || ""), {
    enabled,
    initialData: initialAsset || undefined,
  });
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
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
    () => (asset ? hardwareDetailSections(asset, hardwareContext, settingsQuery.data) : []),
    [asset, hardwareContext, settingsQuery.data]
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
  const purchaseRecord = asset ? assetPurchaseRecord(asset) : {};
  const purchaseDate = firstText(purchaseRecord.order_time);
  const purchasePrice = Number(asset?.purchasePrice || 0);
  const secondHandMarketValue = Number(asset?.secondHandMarketValue || 0);
  const financialResidualValue = asset ? effectiveFinancialResidualValue(asset, settingsQuery.data) : 0;
  const activeFinancialResidualMode = financialResidualMode(asset);
  const hasPurchasePrice = purchasePrice > 0;
  const hasFinancialResidualValue = financialResidualValue > 0;
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
  ];

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
      width={readOnly ? "min(780px, calc(100vw - 32px))" : (isComputerAsset(asset) ? "min(840px, calc(100vw - 32px))" : "min(860px, calc(100vw - 32px))")}
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
          readOnly={readOnly}
        />
      ) : asset ? (
        <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
          {readOnly && navigationLabel ? (
            <div className="npcink-v3-detail-navigation">
              <Text type="secondary">{navigationLabel}</Text>
              <Space.Compact>
                <Button disabled={!previousAsset} onClick={() => previousAsset && onNavigate?.(previousAsset)}>上一台</Button>
                <Button disabled={!nextAsset} onClick={() => nextAsset && onNavigate?.(nextAsset)}>下一台</Button>
              </Space.Compact>
            </div>
          ) : null}
          <div className={`npcink-v3-device-hero is-${platformVisual.kind}`}>
            <div className="npcink-v3-device-brand">
              <PlatformMark visual={platformVisual} variant="hero" />
              <strong>{platformVisual.label}</strong>
            </div>
            <div>
              <h3>{asset.ownerName || asset.name || "未命名资产"}</h3>
              <p>
                {firstText(extracted.deviceModel, extracted.baseboard, formatHardwareHeroText(extracted.cpu, summary, hardwareContext.manualHardware, assetTypeLabel(asset.assetType)))}
              </p>
              <div className="npcink-v3-device-meta">
                <span>部门：{asset.department || "-"}</span>
                <span>状态：{statusLabel(asset.status)}</span>
                <span>编号：{asset.assetNumber || "-"}</span>
                <span>采集：{formatDate(asset.latestObservation?.observedAt)}</span>
              </div>
            </div>
          </div>
          <div className="npcink-v3-detail-finance-summary" aria-label="资产财务摘要">
            <div><span>购置日期</span><strong>{purchaseDate ? formatDate(purchaseDate) : "未登记"}</strong></div>
            <div><span>采购价</span><strong>{hasPurchasePrice ? formatMoney(purchasePrice) : "未登记"}</strong></div>
            <div><span>二手市场价</span><strong>{secondHandMarketValue > 0 ? formatMoney(secondHandMarketValue) : "未登记"}</strong></div>
            <div className="is-emphasis">
              <span className="npcink-v3-finance-label">
                账面净值（估算）
                <em>{activeFinancialResidualMode === "manual" ? "手动" : "自动"}</em>
              </span>
              <strong>{hasFinancialResidualValue ? formatMoney(financialResidualValue) : "未登记"}</strong>
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
                    自动记录字段：姓名、状态、编号、部门、IP、采购价、二手市场价、账面净值
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
            ...(!readOnly ? [{
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
            }] : []),
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
                          expandable={{
                            expandedRowRender: (observation) => (
                              <Collapse
                                size="small"
                                items={[
                                  {
                                    key: "hardware",
                                    label: "硬件明细",
                                    children: renderJsonBlock(observation.hardware),
                                  },
                                  {
                                    key: "raw",
                                    label: "原始数据",
                                    children: renderJsonBlock(observation.raw),
                                  },
                                ]}
                              />
                            ),
                          }}
                        />
                      ),
                    },
                  ]}
                />
              ),
            },
            ...(!readOnly ? [{
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
            }] : []),
            ]}
          />
          {!readOnly ? (
            <ManualRecordModal
              open={manualRecordOpen}
              asset={asset}
              loading={createEventMutation.isLoading}
              onClose={() => setManualRecordOpen(false)}
              onSubmit={(values) => createEventMutation.mutateAsync(values)}
            />
          ) : null}
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
        <span>{hideNames ? "已隐藏" : changeActorName(event)}</span>
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
            <span>{hideNames && asset.name !== "-" ? "已隐藏" : asset.name}</span>
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
      {eventsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="变更记录加载失败"
          description="当前内容不是空数据，请重试获取真实记录。"
          action={<Button onClick={() => eventsQuery.refetch()}>重试</Button>}
        />
      ) : null}
      <Table
        rowKey="id"
        size="middle"
        className="npcink-v3-change-table"
        columns={columns}
        dataSource={eventsQuery.isError ? [] : events}
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
        locale={{ emptyText: eventsQuery.isError ? null : <Empty description="暂无变更数据" /> }}
      />
    </div>
  );
};

const AnalysisWorkspace = () => {
  const [analysisNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("summary");
  const [hardwareAnalysisView, setHardwareAnalysisView] = useState<HardwareAnalysisView>("inventory");
  const [dataHealthView, setDataHealthView] = useState<DataHealthView>("collection");
  const [assetPlanningView, setAssetPlanningView] = useState<AssetPlanningView>("value");
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const [selectedChangeType, setSelectedChangeType] = useState<string>();
  const [selectedRenewalUuids, setSelectedRenewalUuids] = useState<Set<string>>(new Set());
  const [hardwareInventoryKey, setHardwareInventoryKey] = useState<HardwareInventoryKey>("cpu");
  const [hardwareInventorySearch, setHardwareInventorySearch] = useState("");
  const [hardwareQuery, setHardwareQuery] = useState<HardwareQueryState>(createEmptyHardwareQuery);
  const [drillDown, setDrillDown] = useState<{ title: string; assets: Asset[] } | null>(null);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [detailAssets, setDetailAssets] = useState<Asset[]>([]);
  const analysisViewKey: AnalysisViewKey = activeTab === "hardware"
    ? hardwareAnalysisView
    : activeTab === "health"
      ? dataHealthView
      : activeTab === "planning"
        ? assetPlanningView
        : "summary";
  const assetsQuery = useQuery(
    ["v3-analysis-assets"],
    () => fetchAllAssets({ assetScope: "all" }),
    { staleTime: 60_000 }
  );
  const trendsQuery = useQuery(["v3-analysis-collection-trends"], getCollectionTrends, { staleTime: 60_000 });
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const observationsQuery = useQuery(["v3-analysis-observations"], fetchAllObservations, {
    enabled: analysisViewKey === "changes",
    staleTime: 60_000,
  });
  const allAssets = useMemo(
    () => (assetsQuery.data || []).filter((asset) => asset.status !== "deleted"),
    [assetsQuery.data]
  );
  const assets = useMemo(() => allAssets.filter((asset) => asset.assetType === "computer"), [allAssets]);
  const hardwareInventoryRows = useMemo(
    () => buildHardwareInventoryRows(assets, hardwareInventoryKey),
    [assets, hardwareInventoryKey]
  );
  const visibleHardwareInventoryRows = useMemo(() => {
    const keyword = hardwareInventorySearch.trim().toLowerCase();
    if (!keyword) return hardwareInventoryRows;
    return hardwareInventoryRows.filter((row) => `${row.label} ${row.detail}`.toLowerCase().includes(keyword));
  }, [hardwareInventoryRows, hardwareInventorySearch]);
  const hardwareInventoryCollectedAssets = useMemo(
    () => new Set(hardwareInventoryRows.flatMap((row) => row.assets.map((asset) => asset.uuid))).size,
    [hardwareInventoryRows]
  );
  const hardwareInventoryComponents = hardwareInventoryRows.reduce((total, row) => total + row.componentCount, 0);
  const hardwareQueryItems = useMemo<HardwareQueryItem[]>(() => buildHardwareQueryItems(assets), [assets]);
  const matchedHardwareQueryItems = useMemo(
    () => filterHardwareQueryItems(hardwareQueryItems, hardwareQuery),
    [hardwareQuery, hardwareQueryItems]
  );
  const hardwareDepartmentOptions = useMemo(() => analysisDistribution(assets.map((asset) => asset.department || "未填写")).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [assets]);
  const hardwareGraphicsOptions = useMemo(() => analysisDistribution(hardwareQueryItems.map((item) => item.graphics).filter(Boolean)).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [hardwareQueryItems]);
  const hardwareCpuOptions = useMemo(() => analysisDistribution(hardwareQueryItems.map((item) => item.cpu).filter(Boolean)).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [hardwareQueryItems]);
  const hardwareQueryConditions = [
    ...hardwareQuery.departments.map((value) => `部门：${value}`),
    ...hardwareQuery.statuses.map((value) => `状态：${statusLabel(value)}`),
    ...(hardwareQuery.ownerMode ? [`使用人：${hardwareQuery.ownerMode === "assigned" ? "已分配" : "未分配"}`] : []),
    ...(hardwareQuery.ownerKeyword.trim() ? [`使用人包含：${hardwareQuery.ownerKeyword.trim()}`] : []),
    ...hardwareQuery.graphicsTerms.map((value) => `显卡${hardwareQuery.graphicsMode === "exact" ? "等于" : "包含"}：${value}`),
    ...hardwareQuery.cpuTerms.map((value) => `CPU${hardwareQuery.cpuMode === "exact" ? "等于" : "包含"}：${value}`),
    ...(hardwareQuery.minMemoryGb ? [`内存 ≥ ${hardwareQuery.minMemoryGb} GB`] : []),
    ...(hardwareQuery.minDiskGb ? [`硬盘 ≥ ${hardwareQuery.minDiskGb} GB`] : []),
  ];
  const hardwareQueryTags: ReactNode[] = [
    ...hardwareQuery.departments.map((item) => <Tag key={`department:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, departments: value.departments.filter((entry) => entry !== item) }))}>部门：{item}</Tag>),
    ...hardwareQuery.statuses.map((item) => <Tag key={`status:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, statuses: value.statuses.filter((entry) => entry !== item) }))}>状态：{statusLabel(item)}</Tag>),
    ...(hardwareQuery.ownerMode ? [<Tag key="owner-mode" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, ownerMode: undefined }))}>使用人：{hardwareQuery.ownerMode === "assigned" ? "已分配" : "未分配"}</Tag>] : []),
    ...(hardwareQuery.ownerKeyword.trim() ? [<Tag key="owner-keyword" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, ownerKeyword: "" }))}>使用人包含：{hardwareQuery.ownerKeyword.trim()}</Tag>] : []),
    ...hardwareQuery.graphicsTerms.map((item) => <Tag key={`graphics:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, graphicsTerms: value.graphicsTerms.filter((entry) => entry !== item) }))}>显卡{hardwareQuery.graphicsMode === "exact" ? "等于" : "包含"}：{item}</Tag>),
    ...hardwareQuery.cpuTerms.map((item) => <Tag key={`cpu:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, cpuTerms: value.cpuTerms.filter((entry) => entry !== item) }))}>CPU{hardwareQuery.cpuMode === "exact" ? "等于" : "包含"}：{item}</Tag>),
    ...(hardwareQuery.minMemoryGb ? [<Tag key="min-memory" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, minMemoryGb: undefined }))}>内存 ≥ {hardwareQuery.minMemoryGb} GB</Tag>] : []),
    ...(hardwareQuery.minDiskGb ? [<Tag key="min-disk" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, minDiskGb: undefined }))}>硬盘 ≥ {hardwareQuery.minDiskGb} GB</Tag>] : []),
  ];
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
  const departmentRows = useMemo(() => analysisDistribution(allAssets.map((asset) => asset.department)), [allAssets]);
  const statusRows = useMemo(
    () => analysisDistribution(allAssets.map((asset) => STATUS_OPTIONS.find((item) => item.value === asset.status)?.label || asset.status)),
    [allAssets]
  );
  const platformRows = useMemo(
    () => analysisDistribution(assets.map((asset) => assetHardwareContext(asset).extracted.platform || "未采集"), "未采集"),
    [assets]
  );
  const issueGroupRows = useMemo(() => analysisDistribution(issues.map((issue) => issueGroup(issue.type))), [issues]);
  const totalPurchase = allAssets.reduce((total, asset) => total + Math.max(0, Number(asset.purchasePrice || 0)), 0);
  const totalResidual = allAssets.reduce((total, asset) => total + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)), 0);
  const valuedAssets = allAssets.filter((asset) => Number(asset.purchasePrice || 0) > 0 || effectiveFinancialResidualValue(asset, settingsQuery.data) > 0);
  const pendingFinancialRows = useMemo(() => allAssets
    .map((asset) => {
      const missing: string[] = [];
      if (Number(asset.purchasePrice || 0) <= 0) missing.push("采购价");
      if (Number(asset.secondHandMarketValue || 0) <= 0) missing.push("二手市场价");
      return { asset, missing };
    })
    .filter((row) => row.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN")), [allAssets]);
  const fullyValuedAssets = allAssets.filter((asset) => Number(asset.purchasePrice || 0) > 0 && effectiveFinancialResidualValue(asset, settingsQuery.data) > 0);
  const knownDepreciation = fullyValuedAssets.reduce(
    (total, asset) => total + Math.max(0, Number(asset.purchasePrice) - effectiveFinancialResidualValue(asset, settingsQuery.data)),
    0
  );
  const departmentValueRows = useMemo(() => {
    const totals = new Map<string, { count: number; value: number }>();
    allAssets.forEach((asset) => {
      const label = asset.department.trim() || "未填写";
      const current = totals.get(label) || { count: 0, value: 0 };
      totals.set(label, { count: current.count + 1, value: current.value + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)) });
    });
    return Array.from(totals, ([label, value]) => ({ label, value: value.value, meta: `${formatMoney(value.value)} · ${value.count} 条` }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [allAssets, settingsQuery.data]);
  const trend = trendsQuery.data?.collection || [];
  const trendMax = Math.max(...trend.map((item) => item.count), 1);
  const openDrillDown = (title: string, rows: Asset[]) => setDrillDown({ title, assets: rows });
  const openAnalysisAsset = (asset: Asset, candidates?: Asset[]) => {
    setDetailAssets(candidates?.length ? candidates : (drillDown?.assets.length ? drillDown.assets : assets));
    setDetailAsset(asset);
    setDrillDown(null);
  };
  const analysisAssetLink = (asset: Asset, candidates?: Asset[]) => (
    <Button type="link" className="npcink-v3-link" onClick={() => openAnalysisAsset(asset, candidates)}>
      {asset.assetNumber || asset.name || asset.uuid}
    </Button>
  );
  const detailAssetIndex = detailAsset ? detailAssets.findIndex((asset) => asset.uuid === detailAsset.uuid) : -1;
  const previousDetailAsset = detailAssetIndex > 0 ? detailAssets[detailAssetIndex - 1] : undefined;
  const nextDetailAsset = detailAssetIndex >= 0 && detailAssetIndex < detailAssets.length - 1 ? detailAssets[detailAssetIndex + 1] : undefined;
  const collectionRows = useMemo(
    () => assets.map((asset) => ({ asset, band: collectionAgeBand(asset, analysisNow), days: collectionAgeDays(asset, analysisNow) })),
    [analysisNow, assets]
  );
  const collectionBandRows = useMemo(
    () => Object.entries(COLLECTION_BAND_META).map(([key, meta]) => ({
      label: meta.label,
      value: collectionRows.filter((row) => row.band === key).length,
    })),
    [collectionRows]
  );
  const departmentCoverageRows = useMemo(() => {
    const groups = new Map<string, { total: number; connected: number }>();
    assets.forEach((asset) => {
      const label = asset.department.trim() || "未填写";
      const current = groups.get(label) || { total: 0, connected: 0 };
      groups.set(label, {
        total: current.total + 1,
        connected: current.connected + ((collectionAgeDays(asset, analysisNow) ?? Number.POSITIVE_INFINITY) <= 30 ? 1 : 0),
      });
    });
    return Array.from(groups, ([label, group]) => ({
      label,
      value: group.total ? Math.round((group.connected / group.total) * 100) : 0,
      meta: `${group.connected}/${group.total} · ${group.total ? Math.round((group.connected / group.total) * 100) : 0}%`,
    })).sort((a, b) => a.value - b.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [assets]);
  const completenessRows = useMemo<AssetCompletenessRow[]>(() => assets.map((asset) => {
    const context = assetHardwareContext(asset);
    const checks = [
      { label: "资产编号", complete: Boolean(asset.assetNumber.trim()) },
      { label: "资产名称", complete: Boolean(asset.name.trim()) },
      { label: "具体部门", complete: Boolean(asset.department.trim() && !["未分配", "默认"].includes(asset.department.trim())) },
      ...(asset.status === "active" ? [{ label: "责任人", complete: Boolean(asset.ownerName.trim()) }] : []),
      { label: "采集快照", complete: Boolean(asset.latestObservation?.observedAt) },
      { label: "CPU", complete: Boolean(context.extracted.cpu) },
      { label: "内存", complete: hardwareMemoryBytes(asset) > 0 },
      { label: "硬盘", complete: hardwareDiskBytes(asset) > 0 },
      { label: "采购价", complete: Number(asset.purchasePrice || 0) > 0 },
      { label: "账面净值", complete: effectiveFinancialResidualValue(asset, settingsQuery.data) > 0 },
    ];
    const missing = checks.filter((check) => !check.complete).map((check) => check.label);
    return { asset, missing, score: Math.round(((checks.length - missing.length) / checks.length) * 100) };
  }).sort((a, b) => a.score - b.score || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN")), [assets]);
  const completenessFieldRows = useMemo(() => {
    const fields = new Map<string, number>();
    completenessRows.forEach((row) => row.missing.forEach((field) => fields.set(field, (fields.get(field) || 0) + 1)));
    return Array.from(fields, ([label, missing]) => ({
      label,
      value: assets.length ? Math.round(((assets.length - missing) / assets.length) * 100) : 0,
      meta: `${assets.length - missing}/${assets.length} · 缺 ${missing}`,
    })).sort((a, b) => a.value - b.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [assets.length, completenessRows]);
  const averageCompleteness = completenessRows.length
    ? Math.round(completenessRows.reduce((total, row) => total + row.score, 0) / completenessRows.length)
    : 0;
  const renewalSettings = settingsQuery.data || {
    renewalAgeYears: 5,
    renewalMinMemoryGb: 8,
    renewalMinDiskGb: 256,
    renewalMaxResidualRate: 20,
  };
  const renewalRows = useMemo<RenewalCandidateRow[]>(() => assets.map((asset) => {
    const reasons: string[] = [];
    const purchaseDate = parseDateValue(assetPurchaseDateText(asset));
    if (purchaseDate) {
      const years = (analysisNow - purchaseDate.getTime()) / (365.25 * 86400000);
      if (years >= renewalSettings.renewalAgeYears) reasons.push(`购置约 ${years.toFixed(1)} 年`);
    }
    const memoryGb = hardwareMemoryBytes(asset) / (1024 ** 3);
    if (memoryGb > 0 && memoryGb < renewalSettings.renewalMinMemoryGb) reasons.push(`内存 ${Number(memoryGb.toFixed(1))} GB`);
    const diskGb = hardwareDiskBytes(asset) / (1024 ** 3);
    if (diskGb > 0 && diskGb < renewalSettings.renewalMinDiskGb * 0.92) reasons.push(`硬盘 ${Number(diskGb.toFixed(0))} GB`);
    if (asset.status === "maintenance") reasons.push("当前处于维护状态");
    const effectiveResidual = effectiveFinancialResidualValue(asset, settingsQuery.data);
    if (asset.purchasePrice > 0 && effectiveResidual > 0) {
      const residualRate = (effectiveResidual / asset.purchasePrice) * 100;
      if (residualRate <= renewalSettings.renewalMaxResidualRate) reasons.push(`账面净值率 ${Math.round(residualRate)}%`);
    }
    return { asset, reasons };
  }).filter((row) => row.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length), [analysisNow, assets, renewalSettings.renewalAgeYears, renewalSettings.renewalMaxResidualRate, renewalSettings.renewalMinDiskGb, renewalSettings.renewalMinMemoryGb]);
  const hardwareChangeRows = useMemo<HardwareChangeRow[]>(() => {
    const observationsByAsset = new Map<number, AssetObservation[]>();
    (observationsQuery.data || []).forEach((observation) => {
      observationsByAsset.set(observation.assetId, [...(observationsByAsset.get(observation.assetId) || []), observation]);
    });
    const changes: HardwareChangeRow[] = [];
    assets.forEach((asset) => {
      const observations = (observationsByAsset.get(asset.id) || [])
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id - a.id)
        .slice(0, 2);
      if (observations.length < 2) return;
      const latest = observationComparableFields(observations[0]);
      const previous = observationComparableFields(observations[1]);
      Object.entries(latest).forEach(([field, after]) => {
        const before = previous[field as keyof typeof previous];
        if (!before || !after || before.trim().toLowerCase() === after.trim().toLowerCase()) return;
        changes.push({
          key: `${asset.uuid}:${field}`,
          asset,
          field,
          before,
          after,
          observedAt: observations[0].observedAt,
        });
      });
    });
    return changes.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN"));
  }, [assets, observationsQuery.data]);
  const visibleHardwareChanges = selectedChangeType
    ? hardwareChangeRows.filter((row) => row.field === selectedChangeType)
    : hardwareChangeRows;
  const hardwareChangeTypes = Array.from(new Set(hardwareChangeRows.map((row) => row.field))).map((value) => ({ label: value, value }));
  const selectedRenewalRows = renewalRows.filter((row) => selectedRenewalUuids.has(row.asset.uuid));
  const selectedRenewalPurchase = selectedRenewalRows.reduce((total, row) => total + Math.max(0, row.asset.purchasePrice || 0), 0);
  const selectedRenewalResidual = selectedRenewalRows.reduce((total, row) => total + Math.max(0, effectiveFinancialResidualValue(row.asset, settingsQuery.data)), 0);
  const renewalDepartmentPlanRows = useMemo(() => {
    const groups = new Map<string, { count: number; purchase: number; residual: number }>();
    selectedRenewalRows.forEach(({ asset }) => {
      const label = asset.department.trim() || "未填写";
      const current = groups.get(label) || { count: 0, purchase: 0, residual: 0 };
      groups.set(label, {
        count: current.count + 1,
        purchase: current.purchase + Math.max(0, asset.purchasePrice || 0),
        residual: current.residual + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)),
      });
    });
    return Array.from(groups, ([label, value]) => ({
      label,
      value: value.purchase,
      meta: `${value.count} 台 · 历史采购 ${formatMoney(value.purchase)} · 账面净值 ${formatMoney(value.residual)}`,
    })).sort((a, b) => b.value - a.value);
  }, [selectedRenewalRows]);
  const exportRenewalPlan = () => {
    const rows = [["资产编号", "资产名称", "部门", "状态", "候选依据", "历史采购价", "账面净值（估算）", "累计折旧（估算）"], ...selectedRenewalRows.map((row) => {
      const residual = effectiveFinancialResidualValue(row.asset, settingsQuery.data);
      return [row.asset.assetNumber, row.asset.name, row.asset.department, statusLabel(row.asset.status), row.reasons.join("、"), String(row.asset.purchasePrice || 0), String(residual), String(Math.max(0, (row.asset.purchasePrice || 0) - residual))];
    })];
    downloadCsvFile(`设备更新计划草案-${formatDateInput(new Date().toISOString())}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  };
  const exportAnalysisCsv = () => {
    let filename = `设备分析-${analysisViewKey}-${formatDateInput(new Date().toISOString())}.csv`;
    let rows: string[][];
    if (analysisViewKey === "query") {
      rows = [["使用人", "部门", "资产编号", "资产名称", "显卡", "CPU", "内存GB", "硬盘GB", "状态", "最后采集"], ...matchedHardwareQueryItems.map((item) => [item.asset.ownerName, item.asset.department, item.asset.assetNumber, item.asset.name, item.graphics, item.cpu, item.memoryGb ? String(Number(item.memoryGb.toFixed(1))) : "", item.diskGb ? String(Number(item.diskGb.toFixed(1))) : "", statusLabel(item.asset.status), item.asset.latestObservation?.observedAt || ""])];
    } else if (analysisViewKey === "inventory") {
      const category = HARDWARE_INVENTORY_OPTIONS.find((item) => item.key === hardwareInventoryKey)?.label || "硬件";
      rows = [["分类", "型号或容量", "补充信息", "部件数量", "设备数量", "设备占比"], ...visibleHardwareInventoryRows.map((row) => [category, row.label, row.detail, String(row.componentCount), String(row.assetCount), `${row.percent.toFixed(1)}%`])];
      filename = `设备分析-硬件盘点-${category}-${formatDateInput(new Date().toISOString())}.csv`;
    } else if (analysisViewKey === "collection") {
      rows = [["资产编号", "资产名称", "部门", "采集状态", "距今天数", "最后采集"], ...collectionRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, COLLECTION_BAND_META[row.band].label, row.days === null ? "" : String(row.days), row.asset.latestObservation?.observedAt || ""])];
    } else if (analysisViewKey === "quality") {
      rows = [["资产编号", "资产名称", "部门", "完整度", "缺失项目"], ...completenessRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, `${row.score}%`, row.missing.join("、")])];
    } else if (analysisViewKey === "changes") {
      rows = [["资产编号", "资产名称", "部门", "变化字段", "变化前", "变化后", "采集时间"], ...visibleHardwareChanges.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, row.field, row.before, row.after, row.observedAt])];
    } else if (analysisViewKey === "renewal") {
      rows = [["资产编号", "资产名称", "部门", "状态", "候选依据", "采购价", "账面净值（估算）"], ...renewalRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, statusLabel(row.asset.status), row.reasons.join("、"), String(row.asset.purchasePrice || 0), String(effectiveFinancialResidualValue(row.asset, settingsQuery.data))])];
    } else if (analysisViewKey === "value") {
      rows = [["资产编号", "资产名称", "类型", "部门", "采购价", "二手市场价", "账面净值（估算）"], ...allAssets.map((asset) => [asset.assetNumber, asset.name, assetTypeLabel(asset.assetType), asset.department, String(asset.purchasePrice || 0), String(asset.secondHandMarketValue || 0), String(effectiveFinancialResidualValue(asset, settingsQuery.data))])];
    } else {
      rows = [["资产编号", "资产名称", "类型", "部门", "状态", "最后采集"], ...allAssets.map((asset) => [asset.assetNumber, asset.name, assetTypeLabel(asset.assetType), asset.department, statusLabel(asset.status), asset.latestObservation?.observedAt || ""])];
      filename = `设备分析-管理摘要-${formatDateInput(new Date().toISOString())}.csv`;
    }
    downloadCsvFile(filename, rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  };

  return (
    <div className="npcink-v3-analysis-workspace">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>分析概览</Title>
          <Text type="secondary">
            只读统计当前资产与采集快照，不写回问题状态，也不在分析页修改资产。
          </Text>
        </div>
        <Button onClick={exportAnalysisCsv}>导出当前分析</Button>
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
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as AnalysisTabKey)}
        items={[
          { key: "summary", label: "概览" },
          { key: "hardware", label: "硬件分析" },
          { key: "health", label: "数据健康" },
          { key: "planning", label: "资产规划" },
        ]}
        className="npcink-v3-analysis-tabs"
      />
      {activeTab !== "summary" ? (
        <div className="npcink-v3-analysis-subnav">
          {activeTab === "hardware" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={hardwareAnalysisView}
              onChange={(event) => setHardwareAnalysisView(event.target.value)}
              options={[{ label: "型号盘点", value: "inventory" }, { label: "组合筛选", value: "query" }]}
            />
          ) : null}
          {activeTab === "health" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={dataHealthView}
              onChange={(event) => setDataHealthView(event.target.value)}
              options={[{ label: "采集状态", value: "collection" }, { label: "资料完整度", value: "quality" }, { label: "硬件变化", value: "changes" }]}
            />
          ) : null}
          {activeTab === "planning" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={assetPlanningView}
              onChange={(event) => setAssetPlanningView(event.target.value)}
              options={[{ label: "价值概览", value: "value" }, { label: "更新候选", value: "renewal" }]}
            />
          ) : null}
        </div>
      ) : null}
      {analysisViewKey === "summary" ? (
        <div className="npcink-v3-analysis-grid">
          <section className="npcink-v3-analysis-panel is-wide">
            <div className="npcink-v3-analysis-panel-head">
              <div><Title level={4}>近 30 天采集趋势</Title><Text type="secondary">按客户端采集时间统计接收快照数量。</Text></div>
              <strong>{trend.reduce((total, item) => total + item.count, 0)} 次</strong>
            </div>
            {trendsQuery.isError ? <Alert type="error" showIcon message="采集趋势加载失败" /> : (
              <div className="npcink-v3-analysis-trend" aria-label="近 30 天采集数量">
                {trend.map((item, index) => (
                  <div key={item.date} title={`${item.date}：${item.count} 次`}>
                    <i style={{ height: `${Math.max((item.count / trendMax) * 100, item.count ? 6 : 1)}%` }} />
                    {(index === 0 || index === trend.length - 1 || index % 7 === 0) ? <span>{item.date.slice(5)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="npcink-v3-analysis-panel"><Title level={4}>全部资产部门分布</Title><Text type="secondary">统计 {allAssets.length} 条未归档电脑和自定义资产。</Text><AnalysisDistribution rows={departmentRows.slice(0, 8)} onSelect={(row) => openDrillDown(`${row.label}资产`, allAssets.filter((asset) => (asset.department.trim() || "未填写") === row.label))} /></section>
          <section className="npcink-v3-analysis-panel"><Title level={4}>全部资产状态</Title><Text type="secondary">与左侧部门分布使用相同口径。</Text><AnalysisDistribution rows={statusRows} onSelect={(row) => openDrillDown(`${row.label}资产`, allAssets.filter((asset) => (STATUS_OPTIONS.find((item) => item.value === asset.status)?.label || asset.status) === row.label))} /></section>
        </div>
      ) : null}
      {analysisViewKey === "inventory" ? (
        <HardwareInventoryView
          assetsCount={assets.length}
          collectedAssets={hardwareInventoryCollectedAssets}
          componentCount={hardwareInventoryComponents}
          rows={hardwareInventoryRows}
          visibleRows={visibleHardwareInventoryRows}
          inventoryKey={hardwareInventoryKey}
          search={hardwareInventorySearch}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          onSearchChange={setHardwareInventorySearch}
          onInventoryKeyChange={(value) => {
            setHardwareInventoryKey(value);
            setHardwareInventorySearch("");
          }}
          onOpenDrillDown={openDrillDown}
        />
      ) : null}
      {analysisViewKey === "query" ? (
        <HardwareQueryView
          assetsCount={assets.length}
          query={hardwareQuery}
          matchedItems={matchedHardwareQueryItems}
          departmentOptions={hardwareDepartmentOptions}
          graphicsOptions={hardwareGraphicsOptions}
          cpuOptions={hardwareCpuOptions}
          conditions={hardwareQueryConditions}
          tags={hardwareQueryTags}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          onQueryChange={(updater) => setHardwareQuery(updater)}
          onReset={() => setHardwareQuery(createEmptyHardwareQuery())}
          onOpenDrillDown={openDrillDown}
          onOpenAsset={openAnalysisAsset}
          assetLink={analysisAssetLink}
          statusLabel={statusLabel}
          formatDate={formatDate}
        />
      ) : null}
      {analysisViewKey === "collection" ? (
        <CollectionHealthView
          collectionRows={collectionRows}
          collectionBandRows={collectionBandRows}
          departmentCoverageRows={departmentCoverageRows}
          assets={assets}
          assetLink={analysisAssetLink}
          formatDate={formatDate}
          onOpenDrillDown={openDrillDown}
        />
      ) : null}
      {analysisViewKey === "quality" ? (
        <DataQualityView
          averageCompleteness={averageCompleteness}
          completenessRows={completenessRows}
          completenessFieldRows={completenessFieldRows}
          pendingFinancialRows={pendingFinancialRows}
          platformRows={platformRows}
          issueGroupRows={issueGroupRows}
          visibleIssues={visibleIssues}
          groupOptions={groupOptions}
          typeOptions={typeOptions}
          selectedGroup={selectedGroup}
          selectedType={selectedType}
          assetsError={Boolean(assetsQuery.isError)}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          assetLink={analysisAssetLink}
          formatMoney={formatMoney}
          onOpenDrillDown={openDrillDown}
          onGroupChange={(value) => {
            setSelectedGroup(value);
            setSelectedType(undefined);
          }}
          onTypeChange={setSelectedType}
        />
      ) : null}
      {analysisViewKey === "changes" ? (
        <HardwareChangesView
          rows={visibleHardwareChanges}
          types={hardwareChangeTypes}
          selectedType={selectedChangeType}
          loading={observationsQuery.isLoading || observationsQuery.isFetching}
          error={Boolean(observationsQuery.isError)}
          assetLink={analysisAssetLink}
          formatDate={formatDate}
          onTypeChange={setSelectedChangeType}
        />
      ) : null}
      {analysisViewKey === "renewal" ? (
        <RenewalView
          rows={renewalRows}
          selectedRows={selectedRenewalRows}
          selectedPurchase={selectedRenewalPurchase}
          selectedResidual={selectedRenewalResidual}
          departmentRows={renewalDepartmentPlanRows}
          settings={renewalSettings}
          loading={settingsQuery.isLoading}
          assetLink={analysisAssetLink}
          formatMoney={formatMoney}
          statusLabel={statusLabel}
          onSelectionChange={(keys) => setSelectedRenewalUuids(new Set(keys.map(String)))}
          onClear={() => setSelectedRenewalUuids(new Set())}
          onExport={exportRenewalPlan}
        />
      ) : null}
      {analysisViewKey === "value" ? (
        <ValueOverviewView totalPurchase={totalPurchase} totalResidual={totalResidual} knownDepreciation={knownDepreciation} valuedCount={valuedAssets.length} totalCount={allAssets.length} departmentRows={departmentValueRows} formatMoney={formatMoney} />
      ) : null}
      <Modal
        title={drillDown?.title || "分析下钻"}
        open={Boolean(drillDown)}
        onCancel={() => setDrillDown(null)}
        footer={null}
        width="min(900px, calc(100vw - 40px))"
        destroyOnClose
      >
        <Table
          rowKey="uuid"
          size="middle"
          dataSource={drillDown?.assets || []}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            { title: "资产", render: (_, asset) => analysisAssetLink(asset) },
            { title: "名称", dataIndex: "name" },
            { title: "部门", dataIndex: "department", width: 140 },
            { title: "状态", dataIndex: "status", width: 100, render: statusLabel },
            { title: "最后采集", width: 180, render: (_, asset) => formatDate(asset.latestObservation?.observedAt) },
          ]}
        />
      </Modal>
      <DetailDrawer
        uuid={detailAsset?.uuid || null}
        open={Boolean(detailAsset)}
        initialAsset={detailAsset}
        departmentOptions={normalizeDepartmentList(settingsQuery.data?.departments || [])}
        readOnly
        previousAsset={previousDetailAsset}
        nextAsset={nextDetailAsset}
        navigationLabel={detailAssetIndex >= 0 ? `当前筛选结果第 ${detailAssetIndex + 1} / ${detailAssets.length} 台` : undefined}
        onNavigate={setDetailAsset}
        onClose={() => setDetailAsset(null)}
        onArchive={() => undefined}
      />
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
  const [newDepartment, setNewDepartment] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(["v3-settings"], getSettings);
  const settingsMutation = useMutation(updateSettings, {
    onSuccess: (settings) => {
      queryClient.setQueryData(["v3-settings"], settings);
      setHasUnsavedChanges(false);
      message.success("设置已保存");
    },
  });
  const cleanupMutation = useMutation(cleanupObservations, {
    onSuccess: (result) => {
      queryClient.invalidateQueries(["v3-observations"]);
      message.success(result.deleted ? `已清理 ${result.deleted} 条过期采集快照` : "没有需要清理的过期快照");
    },
  });

  const addDepartment = () => {
    const department = newDepartment.trim().slice(0, 80);
    if (!department) {
      message.warning("请输入部门名称");
      return;
    }
    const departments = normalizeDepartmentList(form.getFieldValue("departments") || []);
    if (departments.includes(department)) {
      message.info("该部门已经存在");
      setNewDepartment("");
      return;
    }
    form.setFieldValue("departments", normalizeDepartmentList([...departments, department]));
    setNewDepartment("");
  };

  useEffect(() => {
    if (settingsQuery.data) {
      form.setFieldsValue({
        ...settingsQuery.data,
        departments: normalizeDepartmentList(settingsQuery.data.departments),
      });
      setHasUnsavedChanges(false);
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
      {settingsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="设置加载失败"
          description="为避免覆盖现有配置，加载成功前不能保存设置或管理客户端令牌。"
          action={<Button onClick={() => settingsQuery.refetch()}>重试</Button>}
        />
      ) : null}
      <div className="npcink-v3-settings-panel">
        <Form
          form={form}
          className="npcink-v3-global-settings-form"
          layout="vertical"
          onValuesChange={() => setHasUnsavedChanges(true)}
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
              <Button disabled={settingsQuery.isError || settingsQuery.isLoading} onClick={() => setTokenModalOpen(true)}>管理客户端令牌</Button>
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
            <Title level={4}>采集快照保留</Title>
            <Text type="secondary">设置原始硬件快照的自动保留期。0 表示不自动删除；清理时始终保留每台资产的最新快照。</Text>
            <div className="npcink-v3-settings-grid">
              <Form.Item name="observationRetentionDays" label="保留天数" extra="保存设置后每日自动清理；建议先完成 JSON 备份。">
                <InputNumber min={0} max={3650} precision={0} addonAfter="天" />
              </Form.Item>
            </div>
            <Button
              loading={cleanupMutation.isLoading}
              disabled={settingsQuery.isError || settingsQuery.isLoading || Number(settingsQuery.data?.observationRetentionDays || 0) <= 0}
              onClick={() => Modal.confirm({
                title: "立即清理过期采集快照？",
                content: "将按当前已保存的保留天数删除历史快照，并保留每台资产的最新快照。此操作不可撤销。",
                okText: "确认清理",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => cleanupMutation.mutateAsync(),
              })}
            >立即清理</Button>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>账面净值估算</Title>
            <Text type="secondary">
              使用直线折旧法：采购价减去预计最终残值后，按月平均折旧。默认使用系统实时估算的账面净值；特殊设备可在编辑页切换为手动账面净值。
            </Text>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="depreciationPeriodMonths"
                label="折旧年限"
                extra="普通电脑通常采用 3 年或 5 年；请以公司会计政策为准。"
              >
                <InputNumber min={1} max={240} precision={0} addonAfter="个月" />
              </Form.Item>
              <Form.Item
                name="defaultResidualRate"
                label="预计残值率"
                extra="折旧期满后的预计残值占采购价的比例，常见为 3%–5%。"
              >
                <InputNumber min={0} max={100} precision={1} addonAfter="%" />
              </Form.Item>
            </div>
            <Space wrap>
              <Text type="secondary">快捷设置：</Text>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 36)}>3 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 60)}>5 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 96)}>8 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("defaultResidualRate", 3)}>残值率 3%</Button>
              <Button size="small" onClick={() => form.setFieldValue("defaultResidualRate", 5)}>残值率 5%</Button>
            </Space>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>更新候选规则</Title>
            <Text type="secondary">分析页只根据这些阈值列出候选，不会自动修改状态或归档设备。</Text>
            <div className="npcink-v3-settings-grid npcink-v3-settings-grid-four">
              <Form.Item name="renewalAgeYears" label="使用年限阈值（年）" extra="有购置日期且达到该年限时进入候选。">
                <InputNumber min={1} max={20} precision={0} addonAfter="年" />
              </Form.Item>
              <Form.Item name="renewalMinMemoryGb" label="最低内存（GB）" extra="已采集内存低于该容量时进入候选。">
                <InputNumber min={1} max={512} precision={0} addonAfter="GB" />
              </Form.Item>
              <Form.Item name="renewalMinDiskGb" label="最低硬盘（GB）" extra="已采集硬盘容量低于该值时进入候选。">
                <InputNumber min={1} max={8192} precision={0} addonAfter="GB" />
              </Form.Item>
              <Form.Item name="renewalMaxResidualRate" label="低账面净值率阈值（%）" extra="采购价和当前有效账面净值均存在时参与判断。">
                <InputNumber min={0} max={100} precision={0} addonAfter="%" />
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
                  mode="multiple"
                  showSearch
                  options={departmentSelectOptions(form.getFieldValue("departments") || [])}
                  tagRender={departmentTagRender}
                  onChange={(value) => form.setFieldValue("departments", normalizeDepartmentList(value))}
                  placeholder="已维护的部门"
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
              <div className="npcink-v3-settings-wide npcink-v3-department-add-row">
                <Input
                  value={newDepartment}
                  maxLength={80}
                  placeholder="输入新部门名称，例如：财务部"
                  onChange={(event) => setNewDepartment(event.target.value)}
                  onPressEnter={addDepartment}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={addDepartment}>
                  添加部门
                </Button>
              </div>
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
            {hasUnsavedChanges ? <Text type="warning">有未保存的更改</Text> : null}
            <Button type="primary" htmlType="submit" disabled={settingsQuery.isError || settingsQuery.isLoading} loading={settingsMutation.isLoading}>
              {hasUnsavedChanges ? "保存设置（含部门变更）" : "保存设置"}
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
  const graphicsLabel = cardGraphicsLabel(extracted.graphics, extracted.cpu);
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
              <dd>{assetUpdateDateText(asset)}</dd>
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
                <dt>类型：</dt>
                <dd>{computerDeviceType(asset.category)}</dd>
              </div>
              <div>
                <dt>部门：</dt>
                <dd>{highlightText(asset.department, searchKeyword)}</dd>
              </div>
              <div>
                <dt>更新：</dt>
                <dd>{assetUpdateDateText(asset)}</dd>
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
  const assetScope = initialScope;
  const [assetType, setAssetType] = useState<AssetType | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [purchasePlatform, setPurchasePlatform] = useState<string | undefined>();
  const [financialDataStatus, setFinancialDataStatus] = useState<FinancialDataStatus | undefined>();
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
      category: assetScope !== "all" ? category : undefined,
      purchasePlatform: assetScope === "other" ? purchasePlatform : undefined,
      financialDataStatus: assetScope === "other" ? undefined : financialDataStatus,
      sortBy: "latestObserved" as const,
    }),
    [assetScope, assetType, category, financialDataStatus, page, pageSize, purchasePlatform, search, status]
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
  }, [assetScope, assetType, category, financialDataStatus, page, pageSize, purchasePlatform, search, status]);

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
  const workspaceSavedFilters = savedFilters.filter((filter) => filter.assetScope === initialScope);
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
  const bulkCategoryMode = selectedAssets.length > 0 && selectedAssets.every(isComputerAsset)
    ? "computer"
    : selectedAssets.length > 0 && selectedAssets.every((asset) => !isComputerAsset(asset))
      ? "custom"
      : "mixed";
  const selectedAsset = selectedUuid ? assets.find((asset) => asset.uuid === selectedUuid) || null : null;

  const applySavedFilter = (id: string) => {
    const filter = savedFilters.find((item) => item.id === id);
    if (!filter || filter.assetScope !== initialScope) {
      message.error("这个筛选属于其他资产工作区，无法在当前页面应用");
      return;
    }
    setAssetType(filter.assetType);
    setStatus(filter.status);
    setCategory(filter.category);
    setPurchasePlatform(filter.purchasePlatform);
    setFinancialDataStatus(filter.financialDataStatus);
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
        assetScope: initialScope,
        assetType,
        status,
        search,
        category,
        purchasePlatform,
        financialDataStatus,
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
      title: "资产类型",
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
      title: assetScope === "computer" ? "类型" : assetScope === "other" ? "分类" : "类型 / 分类",
      dataIndex: "category",
      width: 130,
      render: (value: string, asset) => fieldText(isComputerAsset(asset) ? computerDeviceType(value) : value),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (_value, asset) => assetUpdateDateText(asset),
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
      content: (
        <div>
          <p>{asset.assetNumber || asset.uuid} 将退出日常资产管理。</p>
          <p>归档后不参与列表、统计、分析和资产表格导出；历史数据与资产编号仍会保留。</p>
          <p><strong>归档后可通过“已归档”筛选找到资产，并在详情设置中把状态恢复为在用。</strong></p>
        </div>
      ),
      okText: "确认归档",
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
      content: (
        <div>
          <p>已选 {selectedCount} 条资产，将统一退出日常资产管理。</p>
          <p>归档后不参与列表、统计、分析和资产表格导出；历史数据与资产编号仍会保留。</p>
          <p><strong>归档后可通过“已归档”筛选找到资产，并在详情设置中恢复状态。</strong></p>
        </div>
      ),
      okText: "确认归档",
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
          ) : assetScope === "computer" ? (
            <Select
              allowClear
              placeholder="类型"
              options={COMPUTER_DEVICE_TYPE_OPTIONS}
              value={category}
              onChange={(value) => {
                setPage(1);
                setCategory(value);
              }}
              className="npcink-v3-filter"
            />
          ) : (
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
          )}
          {assetScope !== "other" ? (
            <Select
              allowClear
              placeholder="财务资料"
              options={FINANCIAL_DATA_STATUS_OPTIONS}
              value={financialDataStatus}
              onChange={(value) => {
                setPage(1);
                setFinancialDataStatus(value);
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
                ...workspaceSavedFilters.map((filter) => ({
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

      {assetsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={`${activeScopeLabel}加载失败`}
          description="当前页面不能判断是否真的没有资产，也不会开放批量操作。"
          action={<Button onClick={() => assetsQuery.refetch()}>重试</Button>}
        />
      ) : null}

      {!assetsQuery.isError && viewMode === "card" ? (
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
      ) : !assetsQuery.isError ? (
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
          scroll={{ x: 1110 }}
          pagination={{
            current: page,
            pageSize,
            total: pagination?.totalItems || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条资产`,
          }}
          locale={{ emptyText: <Empty description="暂无资产" /> }}
        />
      ) : null}

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
        categoryMode={bulkCategoryMode}
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

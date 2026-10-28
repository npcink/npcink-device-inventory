import type { Asset, AssetInput, AssetListParams, AssetType, JsonRecord } from "@/type/v3";

export const ASSET_TYPES: Array<{ label: string; value: AssetType }> = [
  { label: "电脑", value: "computer" },
  { label: "自定义", value: "custom" },
];

export const DEFAULT_CUSTOM_CATEGORIES = ["显卡", "手机", "机房设备", "网络设备", "办公设备"];

export const DEFAULT_COMPUTER_DEVICE_TYPE = "台式电脑";

export const COMPUTER_DEVICE_TYPE_OPTIONS = ["笔记本", DEFAULT_COMPUTER_DEVICE_TYPE, "苹果电脑", "一体机"].map((value) => ({
  label: value,
  value,
}));

export const CUSTOM_PURCHASE_PLATFORM_OPTIONS = [
  { label: "京东", value: "京东|JingDong" },
  { label: "淘宝", value: "淘宝|TaoBao" },
  { label: "闲鱼", value: "闲鱼" },
  { label: "微信", value: "微信" },
  { label: "其他", value: "About" },
];

export const STATUS_OPTIONS = [
  { label: "在用", value: "active" },
  { label: "闲置", value: "inactive" },
  { label: "维护", value: "maintenance" },
  { label: "报废", value: "retired" },
  { label: "已归档", value: "deleted" },
];

export const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((item) => item.value !== "deleted");

export const EVENT_TYPE_OPTIONS = [
  { label: "创建", value: "created" },
  { label: "更新", value: "updated" },
  { label: "批量修改", value: "bulk_updated" },
  { label: "字段变更", value: "field_changed" },
  { label: "采集接收", value: "observation_received" },
  { label: "归档", value: "deleted" },
];

export const MANUAL_RECORD_OPTIONS = [
  { label: "备注", value: "note" },
  { label: "维修", value: "maintenance" },
  { label: "借用", value: "borrowed" },
  { label: "归还", value: "returned" },
  { label: "转移", value: "transferred" },
];

export const ASSET_SCOPE_OPTIONS = [
  { label: "电脑资产", value: "computer" },
  { label: "其他资产", value: "other" },
  { label: "全部资产", value: "all" },
] as const;

export type AssetScope = (typeof ASSET_SCOPE_OPTIONS)[number]["value"];

export type FinancialDataStatus = NonNullable<AssetListParams["financialDataStatus"]>;

export const FINANCIAL_DATA_STATUS_OPTIONS: Array<{ label: string; value: FinancialDataStatus }> = [
  { label: "缺采购价", value: "missing_purchase_price" },
  { label: "缺二手市场价", value: "missing_second_hand_market_value" },
  { label: "两项都缺", value: "missing_both" },
  { label: "财务资料完整", value: "complete" },
];

export interface SavedAssetFilter {
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

export const ASSET_IMPORT_FIELDS = [
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

export type AssetImportFieldKey = (typeof ASSET_IMPORT_FIELDS)[number]["value"];

export type AssetImportStrategy = "create-only" | "update-by-number" | "upsert-by-number";

export type AssetImportSection = "basic" | "finance" | "hardware";

export interface AssetImportPreviewRow {
  key: string;
  rowNumber: number;
  input: AssetInput;
  purchaseDate?: string;
  manualHardware: JsonRecord;
  errors: string[];
  existing?: Asset;
  action: "create" | "update" | "skip" | "invalid";
}

export type AssetExportFieldKey =
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

export type AssetExportScope = "current-filter" | "selected" | "computer" | "custom" | "all";

export type AssetExportFormat = "xlsx" | "csv";

export type AssetExportColorMode = "row" | "status-cell";

export type AssetExportStatusColors = Record<string, string>;

export const DEFAULT_ASSET_IMPORT_SECTIONS: AssetImportSection[] = ["basic", "finance", "hardware"];

export const SAVED_FILTER_STORAGE_KEY = "npcink-device-inventory.savedFilters";

export const WORKSPACE_TAB_STORAGE_KEY = "npcink-device-inventory.workspaceTab";

export const ASSET_LAYOUT_MODE_STORAGE_KEY = "npcink-device-inventory.assetLayoutMode";

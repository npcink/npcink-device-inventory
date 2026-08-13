import type { Asset } from "@/type/v3";

export type AnalysisTabKey = "summary" | "hardware" | "health" | "planning";
export type HardwareAnalysisView = "inventory" | "query";
export type DataHealthView = "collection" | "quality" | "changes";
export type AssetPlanningView = "value" | "renewal";
export type AnalysisViewKey = "summary" | HardwareAnalysisView | DataHealthView | AssetPlanningView;
export type HardwareInventoryKey = "cpu" | "disk" | "memory" | "baseboard";
export type HardwareTextMatchMode = "contains" | "exact";

export interface AssetCompletenessRow {
  asset: Asset;
  score: number;
  missing: string[];
}

export interface RenewalCandidateRow {
  asset: Asset;
  reasons: string[];
}

export interface HardwareChangeRow {
  key: string;
  asset: Asset;
  field: string;
  before: string;
  after: string;
  observedAt: string;
}

export interface HardwareQueryState {
  departments: string[];
  statuses: string[];
  ownerMode?: "assigned" | "unassigned";
  ownerKeyword: string;
  graphicsTerms: string[];
  graphicsMode: HardwareTextMatchMode;
  cpuTerms: string[];
  cpuMode: HardwareTextMatchMode;
  minMemoryGb?: number;
  minDiskGb?: number;
}

export interface HardwareQueryItem {
  asset: Asset;
  cpu: string;
  graphics: string;
  memoryGb: number;
  diskGb: number;
}

export interface HardwareInventoryRow {
  key: string;
  label: string;
  detail: string;
  componentCount: number;
  assetCount: number;
  percent: number;
  assets: Asset[];
}

export const COLLECTION_BAND_META = {
  fresh: { label: "7 天内", color: "green" },
  aging: { label: "8–30 天", color: "blue" },
  stale_31_60: { label: "31–60 天", color: "gold" },
  stale_61_90: { label: "61–90 天", color: "orange" },
  stale_90_plus: { label: "90 天以上", color: "red" },
  missing: { label: "从未采集", color: "default" },
} as const;

export const HARDWARE_INVENTORY_OPTIONS: Array<{ key: HardwareInventoryKey; label: string }> = [
  { key: "cpu", label: "CPU" },
  { key: "disk", label: "硬盘" },
  { key: "memory", label: "内存" },
  { key: "baseboard", label: "主板" },
];

export const EMPTY_HARDWARE_QUERY: HardwareQueryState = {
  departments: [],
  statuses: [],
  ownerKeyword: "",
  graphicsTerms: [],
  graphicsMode: "contains",
  cpuTerms: [],
  cpuMode: "contains",
};

export const createEmptyHardwareQuery = (): HardwareQueryState => ({
  ...EMPTY_HARDWARE_QUERY,
  departments: [],
  statuses: [],
  graphicsTerms: [],
  cpuTerms: [],
});

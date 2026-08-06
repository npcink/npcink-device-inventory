export type JsonRecord = Record<string, unknown>;

export type AssetStatus = "active" | "inactive" | "maintenance" | "retired" | "deleted" | string;
export type AssetType = "computer" | "custom";

export interface Asset {
  id: number;
  uuid: string;
  assetType: AssetType;
  assetNumber: string;
  name: string;
  ownerName: string;
  department: string;
  status: AssetStatus;
  category: string;
  purchasePrice: number;
  secondHandMarketValue: number;
  financialResidualValue: number;
  /** @deprecated Backward-compatible alias of secondHandMarketValue. */
  residualValue: number;
  metadata: JsonRecord;
  latestObservation?: {
    summary: JsonRecord;
    hardware: JsonRecord;
    observedAt: string;
    source: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AssetInput {
  assetType?: AssetType;
  assetNumber?: string;
  name?: string;
  ownerName?: string;
  department?: string;
  status?: AssetStatus;
  category?: string;
  purchasePrice?: number;
  secondHandMarketValue?: number;
  financialResidualValue?: number;
  /** @deprecated Use secondHandMarketValue. */
  residualValue?: number;
  metadata?: JsonRecord;
}

export interface BatchAssetResult {
  operation: "archive" | "update";
  updated: number;
  items: Asset[];
}

export interface BatchAssetContext {
  source?: string;
  message?: string;
}

export interface AssetEventInput {
  eventType?: string;
  message: string;
  payload?: JsonRecord;
}

export interface AssetReference {
  uuid: string;
  assetNumber: string;
  name: string;
  assetType: AssetType;
  status: string;
  department: string;
  ownerName: string;
}

export interface AssetIdentity {
  id: number;
  assetId: number;
  identityType: string;
  identityValue: string;
  confidence: number;
  isPrimary: boolean;
  source: string;
  createdAt: string;
}

export interface AssetObservation {
  id: number;
  assetId: number;
  source: string;
  schemaVersion: number;
  observedAt: string;
  receivedAt: string;
  summary: JsonRecord;
  hardware: JsonRecord;
  raw: JsonRecord;
  asset?: AssetReference;
}

export interface AssetEvent {
  id: number;
  assetId: number | null;
  eventSource: string;
  eventType: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  message: string;
  actorUserId: number | null;
  actorName: string;
  payload: JsonRecord;
  createdAt: string;
  asset?: AssetReference;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

export interface CollectionTrends {
  days: number;
  startDate: string;
  endDate: string;
  collection: Array<{ date: string; count: number }>;
}

export interface AssetListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  assetType?: AssetType;
  assetScope?: "computer" | "other" | "all";
  status?: string;
  department?: string;
  category?: string;
  purchasePlatform?: string;
  financialDataStatus?: "missing_purchase_price" | "missing_second_hand_market_value" | "missing_both" | "complete";
  sortBy?: "latestUpload" | "latestObserved" | "updated";
  includeDeleted?: boolean;
}

export interface EventListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  eventMode?: "manual" | "auto";
  eventSource?: string;
  eventType?: string;
}

export interface ObservationListParams {
  page?: number;
  pageSize?: number;
  source?: string;
  search?: string;
}

export interface ClientToken {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
}

export interface CreatedClientToken extends ClientToken {
  secret: string;
}

export interface InventorySettings {
  clientUploadBaseUrl: string;
  observationRetentionDays: number;
  assetNumberPrefix: string;
  depreciationPeriodMonths: number;
  defaultResidualRate: number;
  renewalAgeYears: number;
  renewalMinMemoryGb: number;
  renewalMinDiskGb: number;
  renewalMaxResidualRate: number;
  countAvailableAssetsOnly: boolean;
  departments: string[];
  deleteDataOnUninstall: boolean;
  clientTokens: ClientToken[];
}

export interface BackupRestoreSummary {
  schema: string;
  exportedAt: string;
  available: {
    settings: number;
    assets: number;
    identities: number;
    events: number;
    observations: number;
  };
  planned: {
    settings: number;
    assetsCreated: number;
    assetsUpdated: number;
    identitiesCreated: number;
    identitiesExisting: number;
    observationsCreated: number;
    observationsExisting: number;
    eventsCreated: number;
    eventsExisting: number;
  };
  imported: {
    settings: number;
    assetsCreated: number;
    assetsUpdated: number;
    identitiesCreated: number;
    observationsCreated: number;
    eventsCreated: number;
  };
  skipped: {
    assets: number;
    identities: number;
    observations: number;
    events: number;
  };
  conflicts: string[];
  warnings: string[];
}

export interface BackupRestoreResult {
  dryRun: boolean;
  summary: BackupRestoreSummary;
}

export type BackupExportSection = "settings" | "assets" | "identities" | "events" | "observations";

export interface BackupExportResult {
  backup: JsonRecord & {
    schema: string;
    exportedAt: string;
    sections: BackupExportSection[];
  };
  meta: {
    bytes: number;
    counts: Partial<Record<BackupExportSection, number>>;
    limits: {
      bytes: number;
      rowsPerSection: number;
    };
  };
}

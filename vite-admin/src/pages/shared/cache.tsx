import type { Asset, AssetListParams, PaginatedResult } from "@/type/v3";
import { InitialAssets } from "@/utils/index";

const ASSET_LIST_CACHE_PREFIX = "npcinkDeviceInventoryAssetList:";

export const normalizedAssetListParams = (params: AssetListParams) => ({
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

export const clearObsoleteAssetListCache = () => {
  try {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(ASSET_LIST_CACHE_PREFIX));
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage may be unavailable; REST and in-memory queries do not depend on it.
  }
};

export const initialAssetsForParams = (params: AssetListParams): PaginatedResult<Asset> | undefined => {
  if (!InitialAssets?.params || !InitialAssets.result) {
    return undefined;
  }
  const initialParams = normalizedAssetListParams(InitialAssets.params as AssetListParams);
  const currentParams = normalizedAssetListParams(params);
  return JSON.stringify(initialParams) === JSON.stringify(currentParams)
    ? (InitialAssets.result as PaginatedResult<Asset>)
    : undefined;
};

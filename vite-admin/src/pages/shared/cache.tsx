import type { Asset, AssetListParams, PaginatedResult } from "@/type/v3";
import { InitialAssets } from "@/utils/index";

export const ASSET_LIST_CACHE_PREFIX = "npcinkDeviceInventoryAssetList:";

export const ASSET_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

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

export const assetListCacheKey = (params: AssetListParams) =>
  `${ASSET_LIST_CACHE_PREFIX}${JSON.stringify(normalizedAssetListParams(params))}`;

export const readCachedAssetList = (params: AssetListParams): PaginatedResult<Asset> | undefined => {
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

export const writeCachedAssetList = (params: AssetListParams, result: PaginatedResult<Asset>) => {
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

type InitialAssetsPayload = {
  params?: Record<string, unknown>;
  result?: unknown;
  cachedAt?: string;
};

type DataLocal = {
  site?: string;
  rest_url?: string;
  rest_nonce?: string;
  ajax_url?: string;
  initial_assets?: InitialAssetsPayload | null;
};

const getLocalizedData = (): DataLocal => {
  const value = (
    window as Window & { npcinkDeviceInventoryData?: DataLocal }
  ).npcinkDeviceInventoryData;
  return value && typeof value === "object" ? value : {};
};

const localizedData = getLocalizedData();

export const Site = localizedData.site || "";
export const RestUrl = localizedData.rest_url || (Site ? `${Site}/wp-json/npcink-device-inventory/v1` : "/wp-json/npcink-device-inventory/v1");
export const RestNonce = localizedData.rest_nonce || "";
export const AjaxUrl = localizedData.ajax_url || "";
export const InitialAssets = localizedData.initial_assets || null;

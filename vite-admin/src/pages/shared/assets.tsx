import { getAssets } from "@/services/v3";
import type { Asset, AssetInput, AssetListParams } from "@/type/v3";
import { firstText, getRecord, inferredGraphicsForFallbackDriver } from "@/utils/hardwareAudit";
import { assetPurchaseRecord, isComputerAsset } from "@/pages/shared/finance";
import { assetTypeLabel, fieldText, statusLabel } from "@/pages/shared/presentation";

export const MAX_FULL_HARDWARE_ASSETS = 500;
export const FULL_HARDWARE_PAGE_SIZE = 20;

export class AssetBatchLimitError extends Error {
  constructor(limit: number) {
    super(`当前范围超过 ${limit} 条资产，未生成不完整的结果。`);
  }
}

export const fetchAllAssets = async (params: AssetListParams = {}, { signal, maxAssets }: { signal?: AbortSignal; maxAssets?: number } = {}) => {
  const pageSize = params.includeHardware ? FULL_HARDWARE_PAGE_SIZE : 100;
  const limit = params.includeHardware ? Math.min(maxAssets ?? MAX_FULL_HARDWARE_ASSETS, MAX_FULL_HARDWARE_ASSETS) : maxAssets;
  const validatePage = (result: Awaited<ReturnType<typeof getAssets>>) => {
    const { totalItems, totalPages } = result?.pagination ?? {};
    if (typeof totalItems !== "number" || !Number.isSafeInteger(totalItems) || totalItems < 0 ||
        totalPages !== Math.ceil(totalItems / pageSize) || !Array.isArray(result?.data) || result.data.length > pageSize) {
      throw new Error("资产列表分页响应无效，未生成不完整的结果。");
    }
    if (limit !== undefined && (totalItems > limit || totalPages > Math.ceil(limit / pageSize))) {
      throw new AssetBatchLimitError(limit);
    }
  };
  const first = await getAssets({ ...params, page: 1, pageSize }, signal);
  validatePage(first);
  const assets = [...first.data];
  const totalPages = first.pagination.totalPages;
  if (limit !== undefined && assets.length > limit) throw new AssetBatchLimitError(limit);
  for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
    const next = await getAssets({ ...params, page: nextPage, pageSize }, signal);
    validatePage(next);
    assets.push(...next.data);
    if (limit !== undefined && assets.length > limit) {
      throw new AssetBatchLimitError(limit);
    }
  }
  return assets;
};

export const hardwareModelLabel = (value: unknown, fallback: string) => {
  const text = fieldText(value).replace(/\s+/g, " ").trim();
  if (!text || text === "-") {
    return fallback;
  }
  return text;
};

export const cardBaseboardLabel = (value: unknown) => {
  const text = hardwareModelLabel(value, "-").replace(/\s*\([^)]*\)\s*$/g, "").trim();
  if (!text || text === "-") {
    return "-";
  }
  const tokens = text.split(" ");
  const chipsetIndex = tokens.findIndex((token) => /^(?:H|B|Z|X|A|Q|W)\d{3}[A-Z0-9-]*/i.test(token));
  return chipsetIndex >= 0 ? tokens.slice(chipsetIndex).join(" ") : text;
};

export const cardCpuLabel = (value: unknown) => {
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

export const cardGraphicsLabel = (value: unknown, cpu?: unknown) => {
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

export const plainMoneyText = (value: unknown) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) {
    return "-";
  }
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number)} 元`;
};

export const customAssetInfo = (asset: Asset) => {
  const order = assetPurchaseRecord(asset);
  const quantity = firstText(order.numbers, order.quantity, order.count);
  return {
    title: firstText(asset.name, asset.assetNumber, "未命名资产"),
    usage: firstText(asset.ownerName),
    number: firstText(asset.assetNumber),
    category: firstText(asset.category, assetTypeLabel(asset.assetType)),
    purpose: firstText(getRecord(asset.metadata).purpose, order.purpose),
    status: statusLabel(asset.status),
    purchaser: firstText(order.purchaser),
    quantity,
    platform: firstText(order.platform),
    orderNo: firstText(order.order),
    orderTime: firstText(order.order_time),
    payMethod: firstText(order.pay_method),
    shopName: firstText(order.shop_name),
    link: firstText(order.link),
    priceText: plainMoneyText(asset.purchasePrice),
    quantityText: quantity || "-",
  };
};

export const normalizeAssetStatus = (value: string) => {
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

export type BulkEditableField = "department" | "ownerName" | "status" | "category";

export const BULK_EDIT_FIELDS: Array<{ key: BulkEditableField; label: string }> = [
  { key: "department", label: "部门" },
  { key: "ownerName", label: "使用人" },
  { key: "status", label: "状态" },
  { key: "category", label: "分类" },
];

export type AssetLayoutMode = "compact" | "spacious";

export const displayBulkValue = (field: BulkEditableField, value: unknown) => {
  if (field === "status") {
    return statusLabel(String(value || ""));
  }
  return fieldText(value);
};

export const bulkUpdateChanges = (asset: Asset, input: AssetInput) =>
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

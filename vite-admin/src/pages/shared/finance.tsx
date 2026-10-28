import type { Asset, InventorySettings, JsonRecord } from "@/type/v3";
import { firstText, getRecord } from "@/utils/hardwareAudit";
import { formatDate, formatDateOnly } from "@/pages/shared/presentation";

export const assetPurchaseRecord = (asset: Asset | null): JsonRecord => {
  const purchase = getRecord(getRecord(asset?.metadata).purchase);
  return Object.keys(purchase).length ? purchase : {};
};

export const isComputerAsset = (asset?: Asset | null) =>
  asset?.assetType === "computer";

export const assetPurchaseDateText = (asset: Asset) => {
  const purchase = getRecord(getRecord(asset.metadata).purchase);
  return firstText(purchase.order_time, asset.createdAt);
};

export const calculateFinancialResidualValue = (
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

export type FinancialResidualMode = "auto" | "manual";

export const financialResidualMode = (asset?: Asset | null): FinancialResidualMode => {
  const finance = getRecord(getRecord(asset?.metadata).finance);
  const configuredMode = String(finance.financial_residual_mode || "");
  if (configuredMode === "auto" || configuredMode === "manual") {
    return configuredMode;
  }
  // Preserve explicitly recorded historical values; assets without one enter the new automatic mode.
  return Number(asset?.financialResidualValue || 0) > 0 ? "manual" : "auto";
};

export const calculatedFinancialResidualForAsset = (asset: Asset, settings?: InventorySettings) => {
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

export const effectiveFinancialResidualValue = (asset: Asset, settings?: InventorySettings) => {
  if (asset.status === "retired") {
    return 0;
  }
  if (financialResidualMode(asset) === "manual") {
    return Number(asset.financialResidualValue || 0);
  }
  return calculatedFinancialResidualForAsset(asset, settings) ?? Number(asset.financialResidualValue || 0);
};

export const assetUpdateTimeText = (asset: Asset) =>
  formatDate(asset.latestObservation?.observedAt || asset.updatedAt);

export const assetUpdateDateText = (asset: Asset) =>
  formatDateOnly(asset.latestObservation?.observedAt || asset.updatedAt);

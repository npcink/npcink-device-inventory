import type { Asset, AssetInput, InventorySettings } from "@/type/v3";
import { firstText, getRecord } from "@/utils/hardwareAudit";
import {
  calculateFinancialResidualValue,
  financialResidualMode,
  type FinancialResidualMode,
} from "@/pages/shared/finance";

export type AssetFormValues = Omit<AssetInput, "metadata"> & {
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

export const assetFormValuesToInput = (
  values: AssetFormValues,
  asset: Asset | null,
  settings?: InventorySettings
): AssetInput => {
  const metadata = getRecord(asset?.metadata);
  const existingPurchase = getRecord(metadata.purchase);
  const purchase = { ...existingPurchase };
  // Absent fields were not edited; present empty values intentionally clear them.
  for (const [field, key] of [
    ["purchaser", "purchaser"], ["shopName", "shop_name"],
    ["link", "link"], ["order", "order"], ["orderTime", "order_time"],
    ["platform", "platform"], ["payMethod", "pay_method"],
  ] as const) {
    if (field in values) purchase[key] = values[field] || "";
  }
  if ("numbers" in values) purchase.numbers = Number(values.numbers || 0);
  const purchasePrice = "purchasePrice" in values ? Number(values.purchasePrice || 0) : asset?.purchasePrice || 0;
  const mode = values.financialResidualMode || financialResidualMode(asset);
  const purchaseDate = firstText(purchase.order_time);
  const estimate = settings ? calculateFinancialResidualValue(
    purchasePrice, purchaseDate, settings.depreciationPeriodMonths, settings.defaultResidualRate
  ) : null;
  const automaticInputsUnchanged = financialResidualMode(asset) === "auto" &&
    purchasePrice === (asset?.purchasePrice || 0) && purchaseDate === firstText(existingPurchase.order_time);
  const financialResidualValue = mode === "manual"
    ? ("financialResidualValue" in values ? Number(values.financialResidualValue || 0) : asset?.financialResidualValue || 0)
    : estimate ?? (automaticInputsUnchanged ? asset?.financialResidualValue || 0 : 0);

  return {
    assetType: values.assetType,
    assetNumber: values.assetNumber,
    name: values.name,
    ownerName: values.ownerName,
    department: values.department,
    status: values.status,
    category: values.category,
    purchasePrice,
    secondHandMarketValue: "secondHandMarketValue" in values
      ? Number(values.secondHandMarketValue || 0) : asset?.secondHandMarketValue || 0,
    financialResidualValue: (values.status ?? asset?.status) === "retired" ? 0 : financialResidualValue,
    metadata: {
      ...metadata,
      ...("purpose" in values ? { purpose: values.purpose || "" } : {}),
      purchase,
      finance: { ...getRecord(metadata.finance), financial_residual_mode: mode },
    },
  };
};

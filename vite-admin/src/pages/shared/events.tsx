import type { AssetEvent, AssetReference } from "@/type/v3";
import { getArray, getRecord } from "@/utils/hardwareAudit";
import { normalizeAssetStatus } from "@/pages/shared/assets";
import { EVENT_TYPE_OPTIONS, MANUAL_RECORD_OPTIONS } from "@/pages/shared/options";
import { fieldText, formatDate, optionLabel, statusLabel } from "@/pages/shared/presentation";

export interface AutoChangeRow {
  key: string;
  option: string;
  oldValue: string;
  newValue: string;
  time: string;
}

export const AUTO_RECORD_FIELDS: Record<string, string> = {
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
  secondHandMarketValue: "二手市场价",
  financialResidualValue: "账面净值（估算）",
  residual_value: "二手市场价",
  financial_residual_value: "账面净值（估算）",
};

export const normalizeAutoRecordField = (fieldName: string) => {
  const normalized = String(fieldName || "").split(".").pop() || "";
  return AUTO_RECORD_FIELDS[normalized] || "";
};

export const formatAutoRecordValue = (option: string, value: unknown) => {
  const text = fieldText(value);
  if (text === "-") {
    return "-";
  }
  if (option === "设备状态") {
    return statusLabel(normalizeAssetStatus(text));
  }
  return text;
};

export const isAutoChangeRow = (row: AutoChangeRow | null): row is AutoChangeRow => Boolean(row);

export const automaticChangeRows = (events: AssetEvent[], search: string): AutoChangeRow[] => {
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

export const manualEventTypeLabel = (eventType: string) =>
  MANUAL_RECORD_OPTIONS.find((option) => option.value === eventType)?.label || "手动记录";

export const manualRecordOperator = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.operatorName || event.actorName);
};

export const manualRecordItem = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.changeItem || payload.targetDepartment || manualEventTypeLabel(event.eventType));
};

export const changeActorName = (event: AssetEvent) => {
  const payload = getRecord(event.payload);
  return fieldText(payload.operatorName || event.actorName || "系统");
};

export const changeTypeLabel = (event: AssetEvent) => {
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

export const changeContentText = (event: AssetEvent) => {
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

export const changeAssetLabelParts = (asset: AssetReference | undefined) => {
  if (!asset) {
    return { name: "-", suffix: "" };
  }
  const name = fieldText(asset.name);
  const suffix = [asset.department, asset.assetNumber].filter((item) => fieldText(item) !== "-").join(" _ ");
  return { name: name || "-", suffix };
};

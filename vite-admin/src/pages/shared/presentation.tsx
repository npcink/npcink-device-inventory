import type { JsonRecord } from "@/type/v3";
import { formatBytes } from "@/utils/hardwareAudit";
import { AppleFilled, DesktopOutlined, WindowsFilled } from "@ant-design/icons";
import { type ReactNode } from "react";
import { ASSET_TYPES, DEFAULT_COMPUTER_DEVICE_TYPE, STATUS_OPTIONS } from "@/pages/shared/options";

export const statusColor: Record<string, string> = {
  active: "green",
  inactive: "default",
  maintenance: "orange",
  retired: "blue",
  deleted: "red",
};

export const statusLabel = (value: string) =>
  STATUS_OPTIONS.find((item) => item.value === value)?.label || value || "-";

export const assetTypeLabel = (value: string) =>
  ASSET_TYPES.find((item) => item.value === value)?.label || value || "-";

export const optionLabel = (options: { label: string; value: string }[], value: string) =>
  options.find((item) => item.value === value)?.label || value || "-";

export const formatDate = (value?: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
};

export const formatDateOnly = (value?: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN");
};

export const computerDeviceType = (value?: string) => {
  const normalized = String(value || "").trim();
  return !normalized || normalized === "computer" || normalized === "台式机"
    ? DEFAULT_COMPUTER_DEVICE_TYPE
    : normalized;
};

export const parseDateValue = (value?: string) => {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`)
    : new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateInput = (value?: string) => {
  const date = parseDateValue(value);
  if (!date) {
    return value || "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

export const formatMemoryDiskText = (summary: JsonRecord, manualHardware?: JsonRecord) => {
  const memory = formatBytes(summary.memory_bytes);
  const disk = formatBytes(summary.disk_bytes);
  const manualMemory = fieldText(manualHardware?.memory);
  const manualDisk = fieldText(manualHardware?.disk);
  return `${memory !== "-" ? memory : manualMemory} / ${disk !== "-" ? disk : manualDisk}`;
};

export const cpuVendorLabel = (cpu: unknown) => {
  const text = String(cpu || "");
  if (/amd|ryzen|threadripper/i.test(text)) {
    return "AMD";
  }
  if (/intel|core|celeron|pentium|xeon/i.test(text)) {
    return "Intel";
  }
  if (/apple|m[1-9]\b/i.test(text)) {
    return "Apple";
  }
  return text;
};

export const formatHardwareHeroText = (
  cpu: unknown,
  summary: JsonRecord,
  manualHardware: JsonRecord,
  fallback: string
) => {
  const memoryDisk = formatMemoryDiskText(summary, manualHardware);
  const vendor = cpuVendorLabel(cpu);
  if (vendor && memoryDisk !== "- / -") {
    return `${vendor} / ${memoryDisk}`;
  }
  if (memoryDisk !== "- / -") {
    return memoryDisk;
  }
  return vendor || fallback;
};

export type PlatformKind = "macos" | "windows" | "device";

export interface PlatformVisual {
  kind: PlatformKind;
  label: string;
}

export const resolvePlatformVisual = (...values: unknown[]): PlatformVisual => {
  const text = values
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase();
  if (/macos|mac\s*os|darwin|\bmac\b|macbook|imac|mac\s*mini|mac\s*studio|apple\s*m\d|\bm\d\s*(pro|max|ultra)?\b/i.test(text)) {
    return { kind: "macos", label: "macOS" };
  }
  if (/windows|win32|win64|\bwin\b/i.test(text)) {
    return { kind: "windows", label: "Windows" };
  }
  return { kind: "device", label: "Device" };
};

export const platformIcon = (kind: PlatformKind) => {
  if (kind === "macos") {
    return <AppleFilled />;
  }
  if (kind === "windows") {
    return <WindowsFilled />;
  }
  return <DesktopOutlined />;
};

export const PlatformMark = ({ visual, variant }: { visual: PlatformVisual; variant: "card" | "hero" }) => (
  <div className={`npcink-v3-platform-mark is-${variant} is-${visual.kind}`} aria-hidden="true">
    {platformIcon(visual.kind)}
  </div>
);

export const searchHighlightKeyword = (keyword?: string) => (keyword || "").trim();

export const shouldHighlightText = (text: string, keyword: string, exactShortMatch = false) => {
  if (!keyword || text === "-") {
    return false;
  }
  if (keyword.length >= 2) {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
  return exactShortMatch && text.toLowerCase() === keyword.toLowerCase();
};

export const highlightText = (value: unknown, keyword?: string, exactShortMatch = false): ReactNode => {
  const text = fieldText(value);
  const normalizedKeyword = searchHighlightKeyword(keyword);
  if (!shouldHighlightText(text, normalizedKeyword, exactShortMatch)) {
    return text;
  }
  const index = text.toLowerCase().indexOf(normalizedKeyword.toLowerCase());
  if (index < 0) {
    return text;
  }
  const before = text.slice(0, index);
  const match = text.slice(index, index + normalizedKeyword.length);
  const after = text.slice(index + normalizedKeyword.length);
  return (
    <>
      {before}
      <mark className="npcink-v3-search-highlight">{match}</mark>
      {after}
    </>
  );
};

export const compactJson = (value: JsonRecord) => {
  const entries = Object.entries(value || {});
  if (entries.length === 0) {
    return "-";
  }
  return entries
    .slice(0, 6)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join("；");
};

export const fieldText = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

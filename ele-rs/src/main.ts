import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import "./style.css";

type AgentConfig = {
  site: string;
  name: string;
  token: string;
  preset_label?: string;
};

type ImportedUploadConfig = {
  siteUrl?: unknown;
  uploadEndpoint?: unknown;
  tokenId?: unknown;
  tokenSecret?: unknown;
  tokenValue?: unknown;
  tokenName?: unknown;
};

type DeviceSnapshot = {
  data: Record<string, unknown>;
  device_identity_type: string;
  device_identity: string;
};

type DiagnosticsPackage = {
  directory_path: string;
  zip_path: string;
};

type HardwareFeedbackExport = {
  directory_path: string;
  file_path: string;
};

type DiagnosticsProgress = {
  current?: number;
  total?: number;
  stage?: string;
  detail?: string;
};

type SubmitDeviceAsset = {
  assetNumber?: string;
  name?: string;
};

type SubmitDeviceResponse = {
  mode?: string;
  asset?: SubmitDeviceAsset;
};

type TabId = "settings" | "diagnostics" | "details";

type DesktopDownload = {
  label?: string;
  url?: string;
  size?: number;
  sha256?: string;
};

type DesktopUpdateManifest = {
  schema?: string;
  version?: string;
  notes?: string;
  pubDate?: string;
  releaseUrl?: string;
  downloads?: {
    macosAarch64?: DesktopDownload;
    windowsX64?: DesktopDownload;
  };
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("missing #app");
}

app.innerHTML = `
  <main class="app-shell">
    <section class="card">
      <header class="app-head">
        <div class="brand-line" data-tauri-drag-region>
          <span class="brand-mark" data-tauri-drag-region></span>
          <strong data-tauri-drag-region>设备信息上传</strong>
        </div>
        <nav class="tabs" role="tablist" aria-label="页面">
          <button class="tab active" id="settingsTab" data-tab="settings" type="button" role="tab" aria-selected="true" aria-controls="settingsPage">设置</button>
          <button class="tab" id="diagnosticsTab" data-tab="diagnostics" type="button" role="tab" aria-selected="false" aria-controls="diagnosticsPage">排障</button>
          <button class="tab" id="detailsTab" data-tab="details" type="button" role="tab" aria-selected="false" aria-controls="detailsPage">技术详情</button>
        </nav>
        <div class="head-actions">
          <span class="head-drag-fill" data-tauri-drag-region aria-hidden="true"></span>
          <button class="help-button" id="helpButton" type="button">帮助</button>
        </div>
      </header>

      <section class="tab-page active" id="settingsPage" role="tabpanel" aria-labelledby="settingsTab">
        <div class="settings-page-layout">
          <div class="settings-layout">
            <div class="settings-left-panel">
              <form class="upload-form" id="configForm">
                <label class="field">
                  <span class="field-head">
                    <span class="field-label">使用人（可选）</span>
                    <span class="config-state-inline">
                      <span>上传配置</span>
                      <strong id="configStateText">未配置</strong>
                    </span>
                  </span>
                  <input id="name" name="name" placeholder="例如：张三；不要填写部门、工位或设备用途" />
                </label>

                <div class="config-toolbar" id="configImportToolbar">
                  <div class="config-actions">
                    <button class="button config-button config-button-dark" id="importConfigButton" type="button">导入配置</button>
                    <button class="button config-button config-button-light" id="manualConfigButton" type="button" aria-controls="manualConfigDialog">手动填写</button>
                    <button class="button config-button config-button-light" id="verifyConfigButton" type="button">验证连接</button>
                    <button class="button config-button config-button-light" id="clearConfigButton" type="button">清除配置</button>
                  </div>
                </div>

                <button class="button primary submit-button" id="submitButton" type="button" hidden>提交</button>
                <div class="submit-meta" id="submitMeta" hidden></div>
                <div class="message" id="toast" role="status" aria-live="polite"></div>
              </form>

              <section class="software-note" aria-label="软件说明">
                <strong>这是设备资产信息上传工具</strong>
                <p>仅采集电脑硬件、系统版本和客户端日志，用于资产登记、上传和故障排查。</p>
                <p>不会读取聊天内容、屏幕画面、浏览器内容、个人文件内容，也不会录音录像。</p>
              </section>
            </div>

            <div class="side-column">
              <aside class="device-summary" aria-label="本机信息摘要">
                <div class="settings-summary-head">
                  <div class="summary-title">
                    <span>本机信息</span>
                    <span class="collect-state" id="collectState">
                      <span class="collect-spinner" aria-hidden="true"></span>
                      <span id="collectStateText">准备采集</span>
                    </span>
                  </div>
                  <button class="summary-refresh" id="collectButton" type="button">重新采集</button>
                </div>
                <div class="settings-summary-list" id="settingsSummaryList"></div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section class="tab-page" id="diagnosticsPage" role="tabpanel" aria-labelledby="diagnosticsTab" hidden>
        <div class="diagnostics-layout">
          <section class="diagnostics-panel">
            <span class="panel-kicker">本地反馈与排障</span>
            <h2>导出设备信息</h2>
            <p>硬件显示或设备识别异常时，先导出完整硬件 JSON；上传失败时再生成上传排障包。</p>
            <div class="diagnostics-actions">
              <button class="button primary diagnostics-button" id="exportHardwareButton" type="button">导出硬件信息</button>
              <button class="button secondary diagnostics-button" id="generateDiagnosticsButton" type="button">生成上传排障包</button>
              <button class="button secondary diagnostics-button" id="openDiagnosticsFolderButton" type="button" hidden>打开文件夹</button>
              <button class="button secondary diagnostics-button" id="copyDiagnosticsPathButton" type="button" hidden>复制文件位置</button>
            </div>
            <div class="diagnostics-result" id="diagnosticsResult" role="status" aria-live="polite"></div>
          </section>
          <section class="diagnostics-panel">
            <span class="panel-kicker">设备识别</span>
            <h2>身份自检</h2>
            <p>重新检查 UUID、主板序列号和永久网卡地址，查看能否识别这台设备。</p>
            <button class="button secondary" id="checkIdentityButton" type="button">检查设备身份</button>
            <div class="diagnostics-result" id="identityCheckResult" role="status" aria-live="polite"></div>
          </section>
          <section class="diagnostics-note">
            <strong>隐私提示</strong>
            <p>硬件 JSON 不包含站点地址、上传配置或授权码，但会保留主机名、硬件序列号、UUID、IP 和 MAC，便于排查设备识别问题。</p>
            <p>上传排障包会收集硬件采集结果、身份检查、配置摘要和客户端日志，只保存在本机，不会自动上传。</p>
            <p>文件不会自动上传，发送前请确认接收方。</p>
          </section>
        </div>
      </section>

      <section class="tab-page" id="detailsPage" role="tabpanel" aria-labelledby="detailsTab" hidden>
        <div class="detail-layout">
          <div class="detail-menu" id="detailMenu"></div>
          <div class="detail-panel">
            <div class="detail-content" id="detailContent"></div>
          </div>
        </div>
      </section>
    </section>
    <dialog class="config-dialog" id="configImportDialog" aria-labelledby="configImportTitle">
      <div class="config-dialog-box">
        <h2 id="configImportTitle">导入上传配置</h2>
        <textarea id="configJson" spellcheck="false" placeholder='粘贴后台复制的 JSON，例如 {"uploadEndpoint":"...","tokenValue":"..."}'></textarea>
        <div class="dialog-message" id="importDialogMessage"></div>
        <div class="dialog-actions">
          <button class="button secondary compact" id="cancelImportButton" type="button">取消</button>
          <button class="button primary compact" id="confirmImportButton" type="button">导入</button>
        </div>
      </div>
    </dialog>
    <dialog class="config-dialog manual-config-dialog" id="manualConfigDialog" aria-labelledby="manualConfigTitle">
      <div class="config-dialog-box">
        <h2 id="manualConfigTitle">手动填写上传配置</h2>
        <label class="dialog-field">
          <span>完整授权码</span>
          <input id="token" name="token" type="password" placeholder="后台生成的上传授权码" />
        </label>
        <label class="dialog-field">
          <span>站点地址</span>
          <input id="site" name="site" placeholder="https://example.com 或 https://example.com/wp-json/npcink-device-inventory/v1" />
        </label>
        <p class="dialog-note">默认提交设备采集接口，并使用完整授权码 HMAC 签名。</p>
        <div class="dialog-message" id="manualDialogMessage"></div>
        <div class="dialog-actions">
          <button class="button secondary compact" id="cancelManualConfigButton" type="button">取消</button>
          <button class="button primary compact" id="saveManualConfigButton" type="button">保存</button>
        </div>
      </div>
    </dialog>
    <dialog class="config-dialog help-dialog" id="helpDialog" aria-labelledby="helpDialogTitle">
      <div class="config-dialog-box">
        <h2 id="helpDialogTitle">帮助</h2>
        <p class="dialog-copy">首次使用：导入管理员提供的配置，点击“验证连接”，确认连接正常后再上传。</p>
        <p class="dialog-note">授权失败请重新获取配置；网络失败请检查 HTTPS 地址和系统时间；仍无法解决时，在“排障”页生成排障包交给管理员。关闭窗口会退出软件。</p>
        <div class="dialog-actions">
          <button class="button primary compact" id="closeHelpButton" type="button">知道了</button>
        </div>
      </div>
    </dialog>
    <dialog class="config-dialog result-dialog" id="submitResultDialog" aria-labelledby="submitResultTitle">
      <div class="config-dialog-box">
        <h2 id="submitResultTitle">上传结果</h2>
        <p class="dialog-copy" id="submitResultMessage"></p>
        <div class="dialog-actions">
          <button class="button primary compact" id="closeSubmitResultButton" type="button">知道了</button>
        </div>
      </div>
    </dialog>
  </main>
`;

const siteInput = document.querySelector<HTMLInputElement>("#site")!;
const nameInput = document.querySelector<HTMLInputElement>("#name")!;
const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const configStateText = document.querySelector<HTMLElement>("#configStateText")!;
const configImportToolbar = document.querySelector<HTMLElement>("#configImportToolbar")!;
const manualConfigButton = document.querySelector<HTMLButtonElement>("#manualConfigButton")!;
const verifyConfigButton = document.querySelector<HTMLButtonElement>("#verifyConfigButton")!;
const clearConfigButton = document.querySelector<HTMLButtonElement>("#clearConfigButton")!;
const configForm = document.querySelector<HTMLFormElement>("#configForm")!;
const collectButton = document.querySelector<HTMLButtonElement>("#collectButton")!;
const submitButton = document.querySelector<HTMLButtonElement>("#submitButton")!;
const defaultSubmitButtonText = submitButton.textContent ?? "提交";
const importConfigButton = document.querySelector<HTMLButtonElement>("#importConfigButton")!;
const configImportDialog = document.querySelector<HTMLDialogElement>("#configImportDialog")!;
const configJsonInput = document.querySelector<HTMLTextAreaElement>("#configJson")!;
const importDialogMessage = document.querySelector<HTMLElement>("#importDialogMessage")!;
const cancelImportButton = document.querySelector<HTMLButtonElement>("#cancelImportButton")!;
const confirmImportButton = document.querySelector<HTMLButtonElement>("#confirmImportButton")!;
const manualConfigDialog = document.querySelector<HTMLDialogElement>("#manualConfigDialog")!;
const manualDialogMessage = document.querySelector<HTMLElement>("#manualDialogMessage")!;
const cancelManualConfigButton = document.querySelector<HTMLButtonElement>("#cancelManualConfigButton")!;
const saveManualConfigButton = document.querySelector<HTMLButtonElement>("#saveManualConfigButton")!;
const helpDialog = document.querySelector<HTMLDialogElement>("#helpDialog")!;
const closeHelpButton = document.querySelector<HTMLButtonElement>("#closeHelpButton")!;
const helpButton = document.querySelector<HTMLButtonElement>("#helpButton")!;
const submitResultDialog = document.querySelector<HTMLDialogElement>("#submitResultDialog")!;
const submitResultTitle = document.querySelector<HTMLElement>("#submitResultTitle")!;
const submitResultMessage = document.querySelector<HTMLElement>("#submitResultMessage")!;
const closeSubmitResultButton = document.querySelector<HTMLButtonElement>("#closeSubmitResultButton")!;
const collectState = document.querySelector<HTMLElement>("#collectState")!;
const collectStateText = document.querySelector<HTMLElement>("#collectStateText")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const settingsSummaryList = document.querySelector<HTMLElement>("#settingsSummaryList")!;
const exportHardwareButton = document.querySelector<HTMLButtonElement>("#exportHardwareButton")!;
const generateDiagnosticsButton = document.querySelector<HTMLButtonElement>("#generateDiagnosticsButton")!;
const openDiagnosticsFolderButton = document.querySelector<HTMLButtonElement>("#openDiagnosticsFolderButton")!;
const copyDiagnosticsPathButton = document.querySelector<HTMLButtonElement>("#copyDiagnosticsPathButton")!;
const diagnosticsResult = document.querySelector<HTMLElement>("#diagnosticsResult")!;
const checkIdentityButton = document.querySelector<HTMLButtonElement>("#checkIdentityButton")!;
const identityCheckResult = document.querySelector<HTMLElement>("#identityCheckResult")!;
let isCheckingIdentity = false;

const detailMenu = document.querySelector<HTMLElement>("#detailMenu")!;
const detailContent = document.querySelector<HTMLElement>("#detailContent")!;
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
const pages = Array.from(document.querySelectorAll<HTMLElement>(".tab-page"));

let snapshot: DeviceSnapshot | null = null;
let activeDetail = "cpu";
let activeConfig: AgentConfig = { site: "", name: "", token: "" };
let manualConfigDraft: { site: string; token: string; presetLabel: string } | null = null;
let isCollecting = false;
let isSubmitting = false;
let isExportingHardware = false;
let isGeneratingDiagnostics = false;
let isCheckingUpdate = false;
let isInstallingUpdate = false;
let lastSubmittedAt: Date | null = null;
let lastSubmittedConfigLabel = "";
let diagnosticsDirectoryPath = "";
let diagnosticsOutputPath = "";
let currentAppVersion = "";
let latestDesktopManifest: DesktopUpdateManifest | null = null;
let pendingAutoUpdate: Update | null = null;
let downloadUpdateUrl = "";
let verifiedConfigKey = "";

const DESKTOP_UPDATE_MANIFEST_URL =
  "https://github.com/npcink/npcink-device-inventory/releases/latest/download/latest-desktop.json";
const MENU_CHECK_UPDATE_EVENT = "desktop-check-update";

const detailItems = [
  { key: "cpu", title: "处理器", desc: "CPU 信息" },
  { key: "memory", title: "内存", desc: "内存条与容量" },
  { key: "battery", title: "电池", desc: "电池健康与循环次数" },
  { key: "diskLayout", title: "硬盘", desc: "磁盘与分区" },
  { key: "graphics", title: "显卡/显示器", desc: "显示设备" },
  { key: "baseboard", title: "主板", desc: "主板信息" },
  { key: "bios", title: "BIOS", desc: "固件信息" },
  { key: "os", title: "系统", desc: "操作系统" },
  { key: "net", title: "网卡", desc: "网络信息" },
  { key: "uuid", title: "标识信息", desc: "调试与匹配字段" },
];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const listItems = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : Object.keys(asRecord(value)).length ? [value] : [];

const readPath = (source: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      return current[Number(key)];
    }
    return asRecord(current)[key];
  }, source);

const firstText = (source: unknown, paths: string[], fallback = "未采集") => {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback;
};

const formatBytes = (value: unknown) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "未采集";
  }
  const gb = value / 1024 / 1024 / 1024;
  return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
};

const finiteNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const sumSizes = (items: unknown) =>
  asArray(items).reduce<number>((sum, item) => {
    const size = asRecord(item).size;
    return sum + (typeof size === "number" ? size : 0);
  }, 0);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const displayValue = (value: unknown, fallback = "未采集") => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return String(value);
};

const isMissingValue = (value: unknown) =>
  value === null || value === undefined || value === "" || value === "未采集";

const firstPresent = (source: unknown, keys: string[]) => {
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (!isMissingValue(displayValue(value, ""))) {
      return value;
    }
  }
  return "";
};

const formatDateValue = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }
  const match = value.match(/^\/Date\((\d+)\)\/$/);
  if (!match) {
    return value;
  }
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleDateString("zh-CN");
};

const row = (label: string, value: unknown, unit = "") => {
  const display = displayValue(value);
  if (isMissingValue(display)) {
    return "";
  }
  return `
    <div class="info-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(display)}${unit}</strong>
    </div>
  `;
};

const uniqueTexts = (items: unknown[]) =>
  Array.from(
    new Set(
      items
        .map((item) => displayValue(item, "").trim())
        .filter((item) => item && item !== "00:00:00:00:00:00"),
    ),
  );

const joinUnique = (values: unknown[]) => uniqueTexts(values).join(" ");

const systemLabel = (distro: unknown, release: unknown) => {
  const distroText = displayValue(distro, "");
  const releaseText = displayValue(release, "");
  if (!distroText) {
    return releaseText || "未采集";
  }
  if (releaseText && distroText.toLowerCase().includes(releaseText.toLowerCase())) {
    return distroText;
  }
  return joinUnique([distroText, releaseText]) || "未采集";
};

const baseboardLabel = (data: Record<string, unknown>) => {
  const baseboard = asRecord(data.baseboard);
  return joinUnique([
    firstPresent(baseboard, ["manufacturer", "Manufacturer"]),
    firstPresent(baseboard, ["product", "Product"]),
    firstPresent(baseboard, ["model", "Model"]),
  ]) || "未采集";
};

const biosLabel = (data: Record<string, unknown>) => {
  const bios = asRecord(data.bios);
  return joinUnique([
    firstPresent(bios, ["vendor", "Manufacturer"]),
    firstPresent(bios, ["version", "SMBIOSBIOSVersion", "Version", "Name"]),
  ]) || "未采集";
};

const modelWithVendor = (vendor: unknown, model: unknown) => {
  const vendorText = displayValue(vendor, "").trim();
  const modelText = displayValue(model, "").trim();
  if (!modelText) {
    return vendorText;
  }
  if (vendorText && modelText.toLowerCase().startsWith(vendorText.toLowerCase())) {
    return modelText;
  }
  return joinUnique([vendorText, modelText]);
};

const graphicsLabel = (data: Record<string, unknown>) => {
  const controllers = listItems(asRecord(data.graphics).controllers);
  return uniqueTexts(controllers.map((item) => {
    const controller = asRecord(item);
    return modelWithVendor(
      firstPresent(controller, ["vendor", "Vendor"]),
      firstPresent(controller, ["model", "Name"]),
    );
  })).join("\n") || "未采集";
};

const displayLabel = (data: Record<string, unknown>) => {
  const displays = listItems(asRecord(data.graphics).displays);
  return displays.map((item) => {
    const display = asRecord(item);
    const model = displayValue(display.model || display.name, "");
    const resolution = displayValue(
      display.resolution ||
        (display.currentResX && display.currentResY ? `${display.currentResX} x ${display.currentResY}` : "") ||
        (display.resolutionX && display.resolutionY ? `${display.resolutionX} x ${display.resolutionY}` : ""),
      "",
    );
    return joinUnique([model, resolution]);
  }).filter(Boolean).join("\n") || "未采集";
};

const listRow = (label: string, values: unknown[]) => {
  const items = uniqueTexts(values);
  if (!items.length) {
    return "";
  }
  return `
    <div class="info-row list-row">
      <span>${escapeHtml(label)}</span>
      <ul class="value-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
};

const section = (title: string, rows: string[]) => {
  const visibleRows = rows.filter(Boolean);
  if (!visibleRows.length) {
    return emptyDetail();
  }
  return `
    <section class="info-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="info-list">${visibleRows.join("")}</div>
    </section>
  `;
};

const emptyDetail = () => `
  <div class="empty-detail">
    <strong>这部分暂无可读信息</strong>
    <span>不同系统开放的硬件字段不完全一致，已采集到的数据会继续用于上传。</span>
  </div>
`;

const listSections = (
  titlePrefix: string,
  items: unknown,
  render: (item: Record<string, unknown>, index: number) => string[],
) => {
  const list = listItems(items);
  if (!list.length) {
    return emptyDetail();
  }
  return list
    .map((item, index) => section(`${titlePrefix} ${index + 1}`, render(asRecord(item), index)))
    .join("");
};

const isTruthy = (value: unknown) => value === true || value === "true" || value === 1;

const primaryNetwork = (items: unknown) => {
  const networks = asArray(items).map(asRecord);
  return (
    networks.find((item) => isTruthy(item.default)) ??
    networks.find((item) => !isTruthy(item.virtual) && !isTruthy(item.internal) && item.mac) ??
    networks[0] ??
    {}
  );
};

const renderHumanDetail = (key: string, data: Record<string, unknown>) => {
  switch (key) {
    case "cpu": {
      const cpu = asRecord(data.cpu);
      return section("处理器信息", [
        row("型号", [cpu.manufacturer, cpu.brand].filter(Boolean).join(" ")),
        row("核心数", cpu.cores),
        row("物理核心", cpu.physicalCores),
        row("处理器数量", cpu.processors),
        row("当前频率（系统报告）", cpu.currentFrequency, " MHz"),
        row("基准频率", cpu.baseFrequency, " MHz"),
        row("最大频率（系统报告）", cpu.maxFrequency, " MHz"),
        row("厂商", cpu.vendor),
      ]);
    }
    case "memory": {
      const memory = asArray(data.memory).length ? data.memory : data.memLayout;
      const mem = asRecord(data.mem);
      if (!asArray(memory).length && Object.keys(mem).length) {
        return section("内存信息", [
          row("总内存", formatBytes(mem.total)),
          row("可用内存", formatBytes(mem.available || mem.free)),
          row("已用内存", formatBytes(mem.used)),
          row("交换空间", formatBytes(mem.swapTotal)),
          row("已用交换空间", formatBytes(mem.swapUsed)),
        ]);
      }
      return listSections("内存", memory, (item) => [
        row("容量", formatBytes(item.size)),
        row("类型", item.type),
        row("频率", item.clockSpeed || item.speed, item.clockSpeed || item.speed ? " MHz" : ""),
        row("厂商", item.manufacturer),
        row("插槽", item.bank || item.slot),
        row("序列号", item.serialNum || item.serial),
      ]);
    }
    case "battery":
      return listSections("电池", data.battery, (item) => [
        row("名称", item.name),
        row("制造商", item.manufacturer),
        row("序列号", item.serial),
        row("健康度", item.healthPercent, finiteNumber(item.healthPercent) !== null ? "%" : ""),
        row("当前电量", item.chargePercent, finiteNumber(item.chargePercent) !== null ? "%" : ""),
        row("循环次数", item.cycleCount),
        row("状态", item.condition || item.status),
      ]);
    case "diskLayout":
      return listSections("硬盘", data.diskLayout, (item) => [
        row("名称", item.name || item.model || item.device),
        row("类型", item.type),
        row("接口", item.interfaceType),
        row("容量", formatBytes(item.size)),
        row("序列号", item.serialNum || item.serial),
        row("文件系统", item.fsType),
        row("挂载位置", item.mount),
      ]);
    case "graphics": {
      const graphics = asRecord(data.graphics);
      const hasControllers = listItems(graphics.controllers).length > 0;
      const hasDisplays = listItems(graphics.displays).length > 0;
      const controllers = hasControllers ? listSections("显卡", graphics.controllers, (item) => [
        row("型号", modelWithVendor(firstPresent(item, ["vendor", "Vendor"]), firstPresent(item, ["model", "Name"]))),
        row("显存", formatBytes(item.vram)),
        row("显存来源", item.vramSource),
        row("旧接口显存（待核实）", item.vramReportedBytes == null ? "" : `${item.vramReportedBytes} 字节（32 位值，可能截断）`),
        row("可共享系统内存（非独立显存）", formatBytes(item.sharedSystemMemoryBytes)),
        row("视频处理器", firstPresent(item, ["videoProcessor", "VideoProcessor"])),
        row("驱动版本", firstPresent(item, ["driverVersion", "DriverVersion"])),
        row("总线", firstPresent(item, ["bus", "Bus"])),
      ]) : "";
      const displays = hasDisplays ? listSections("显示器", graphics.displays, (item) => [
        row("型号", item.model),
        row(
          "分辨率",
          item.resolution ||
            (item.currentResX && item.currentResY ? `${item.currentResX} x ${item.currentResY}` : "") ||
            (item.resolutionX && item.resolutionY ? `${item.resolutionX} x ${item.resolutionY}` : ""),
        ),
        row("刷新率", item.currentRefreshRate, item.currentRefreshRate ? " Hz" : ""),
        row("厂商", item.vendor),
        row("序列号", item.serial),
        row("Retina", item.retina),
        row("尺寸", item.sizeX && item.sizeY ? `${item.sizeX} x ${item.sizeY}` : ""),
        row("类型", item.type),
        row("生产年份", item.yearOfManufacture ?? item.productionYear),
      ]) : "";
      return controllers + displays || emptyDetail();
    }
    case "baseboard": {
      const baseboard = asRecord(data.baseboard);
      return section("主板信息", [
        row("厂商", firstPresent(baseboard, ["manufacturer", "Manufacturer"])),
        row("型号", firstPresent(baseboard, ["product", "Product", "model", "Model"])),
        row("硬件标识", firstPresent(baseboard, ["model", "Model"])),
        row("芯片", firstPresent(baseboard, ["chip", "Chip"])),
        row("版本", firstPresent(baseboard, ["version", "Version"])),
        row("序列号", firstPresent(baseboard, ["serial", "SerialNumber"])),
        row("最大内存", formatBytes(firstPresent(baseboard, ["memMax", "MemMax"]))),
        row("内存插槽", firstPresent(baseboard, ["memSlots", "MemSlots"])),
      ]);
    }
    case "bios": {
      const bios = asRecord(data.bios);
      return section("BIOS 信息", [
        row("厂商", firstPresent(bios, ["vendor", "Manufacturer"])),
        row("版本", firstPresent(bios, ["version", "SMBIOSBIOSVersion", "Version", "Name"])),
        row("序列号", firstPresent(bios, ["serial", "SerialNumber"])),
        row("发布日期", formatDateValue(firstPresent(bios, ["releaseDate", "ReleaseDate"]))),
        row("修订版本", firstPresent(bios, ["revision", "Revision"])),
      ]);
    }
    case "os": {
      const os = asRecord(data.os);
      return section("系统信息", [
        row("系统", [os.distro, os.release].filter(Boolean).join(" ")),
        row("构建号", os.build),
        row("架构", os.arch),
        row("主机名", os.hostname),
        row("平台", os.platform),
        row("内核", os.kernel),
      ]);
    }
    case "net":
      return listSections("网卡", data.net, (item) => [
        row("名称", item.ifaceName || item.iface),
        row("MAC 地址", item.mac),
        row("IPv4", item.ip4),
        row("IPv6", item.ip6),
        row("速度", item.speed, item.speed ? " Mbps" : ""),
        row("类型", item.type),
      ]);
    case "uuid": {
      const uuid = asRecord(data.uuid);
      const macs = uniqueTexts(asArray(uuid.macs));
      return section("唯一标识", [
        row("硬件 UUID", uuid.hardware),
		row("设备身份", snapshot?.device_identity),
		row("身份类型", snapshot?.device_identity_type),
        row("主 MAC 地址", macs[0]),
        listRow("其他 MAC 地址", macs.slice(1)),
      ]);
    }
    default:
      return emptyDetail();
  }
};

const setToast = (message: string, kind: "ok" | "error" | "" = "") => {
  toast.textContent = message;
  toast.className = `message ${kind}`;
};

const errorMessage = (error: unknown) => {
  const readable = (message: string) => {
    if (message.includes("invoke") || message.includes("__TAURI__")) {
      return "本机服务未连接，请在桌面软件窗口中操作；浏览器预览只能查看界面。";
    }
    return message;
  };

  if (error instanceof Error) {
    return readable(error.message);
  }
  if (error && typeof error === "object") {
    const record = asRecord(error);
    const message = stringValue(record.message) || stringValue(record.error);
    if (message) {
      return readable(message);
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "发生未知错误。";
    }
  }
  const message = String(error);
  return readable(message);
};

const logAppEvent = (level: "debug" | "info" | "warn" | "error", event: string, message = "") => {
  void invoke("append_app_log", {
    input: {
      level,
      event,
      message,
    },
  }).catch(() => undefined);
};

const stringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const submitResponsePayload = (value: unknown): SubmitDeviceResponse => {
  const record = asRecord(value);
  const data = asRecord(record.data);
  const payload = Object.keys(data).length ? data : record;
  const asset = asRecord(payload.asset);
  return {
    mode: stringValue(payload.mode),
    asset: {
      assetNumber: stringValue(asset.assetNumber),
      name: stringValue(asset.name),
    },
  };
};

const formatSubmitResultMessage = (response: unknown) => {
  const payload = submitResponsePayload(response);
  const asset = payload.asset ?? {};
  const modeText =
    payload.mode === "created"
      ? "已创建新资产，请管理员确认资产信息"
      : payload.mode === "matched"
        ? "已关联到现有资产"
        : payload.mode === "duplicate"
          ? "这次采集已成功上传，无需重复保存"
        : "设备信息已提交。";
  const rows = [
    ["编号", stringValue(asset.assetNumber)],
    ["设备", stringValue(asset.name)],
  ].filter(([, value]) => value);

  if (!rows.length) {
    return modeText;
  }

  return [modeText, "", ...rows.map(([label, value]) => `${label}：${value}`)].join("\n");
};

const importedConfigPayload = (value: unknown): ImportedUploadConfig => {
  const record = asRecord(value);
  const data = asRecord(record.data);
  return Object.keys(data).length ? data : record;
};

const parseImportedConfig = (raw: string): AgentConfig => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON 格式不正确。");
  }

  const payload = importedConfigPayload(parsed);
  const site = stringValue(payload.uploadEndpoint) || stringValue(payload.siteUrl);
  const tokenValue = stringValue(payload.tokenValue);
  const tokenId = stringValue(payload.tokenId);
  const tokenSecret = stringValue(payload.tokenSecret);
  const token = tokenValue || (tokenId && tokenSecret ? `mda_${tokenId}_${tokenSecret}` : "");

  if (!site) {
    throw new Error("上传配置缺少 uploadEndpoint 或 siteUrl。");
  }
  if (!token) {
    throw new Error("上传配置缺少 tokenValue，或缺少 tokenId/tokenSecret。");
  }

  return {
    site,
    name: nameInput.value.trim(),
    token,
    preset_label: stringValue(payload.tokenName) || tokenId,
  };
};

const getConfig = (): AgentConfig => ({
  site: siteInput.value.trim(),
  name: nameInput.value.trim(),
  token: tokenInput.value,
  preset_label: activeConfig.preset_label || "",
});

const hasUploadConfig = (config: AgentConfig = getConfig()) =>
  Boolean(config.site && config.token);

const updateInteractiveState = () => {
  const diagnosticsBusy = isExportingHardware || isGeneratingDiagnostics || isCheckingIdentity;
  nameInput.disabled = isSubmitting;
  siteInput.disabled = isSubmitting;
  tokenInput.disabled = isSubmitting;
  collectButton.disabled = isCollecting || isSubmitting || diagnosticsBusy;
  submitButton.disabled = isCollecting || isSubmitting || diagnosticsBusy;
  importConfigButton.disabled = isSubmitting;
  manualConfigButton.disabled = isSubmitting;
  verifyConfigButton.disabled = isSubmitting || !hasUploadConfig();
  clearConfigButton.disabled = isSubmitting || !hasUploadConfig(activeConfig);
  saveManualConfigButton.disabled = isSubmitting;
  checkIdentityButton.disabled = diagnosticsBusy || isCollecting || isSubmitting;
  exportHardwareButton.disabled = diagnosticsBusy || isCollecting || isSubmitting;
  generateDiagnosticsButton.disabled = diagnosticsBusy || isCollecting || isSubmitting;
  openDiagnosticsFolderButton.disabled = diagnosticsBusy;
  copyDiagnosticsPathButton.disabled = diagnosticsBusy;
};

const setCollecting = (collecting: boolean) => {
  isCollecting = collecting;
  collectState.classList.toggle("is-collecting", collecting);
  settingsSummaryList.classList.toggle("is-collecting", collecting);
  collectButton.textContent = collecting ? "采集中..." : "重新采集";
  updateInteractiveState();
};

const setSubmitting = (submitting: boolean) => {
  isSubmitting = submitting;
  submitButton.textContent = submitting ? "提交中..." : defaultSubmitButtonText;
  updateInteractiveState();
};

const setGeneratingDiagnostics = (generating: boolean) => {
  isGeneratingDiagnostics = generating;
  generateDiagnosticsButton.textContent = generating ? "生成中..." : "生成上传排障包";
  updateInteractiveState();
};

const setExportingHardware = (exporting: boolean) => {
  isExportingHardware = exporting;
  exportHardwareButton.textContent = exporting ? "导出中..." : "导出硬件信息";
  updateInteractiveState();
};

const setCheckingUpdate = (checking: boolean) => {
  isCheckingUpdate = checking;
  updateInteractiveState();
};

const setInstallingUpdate = (installing: boolean) => {
  isInstallingUpdate = installing;
  updateInteractiveState();
};

const showModalSafely = (dialog: HTMLDialogElement) => {
  if (!dialog.open) {
    dialog.showModal();
  }
};

const closeDialogSafely = (dialog: HTMLDialogElement) => {
  if (dialog.open) {
    dialog.close();
  }
};

const formatClock = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const configLabel = (config: AgentConfig = getConfig()) => {
  if (config.preset_label) {
    return config.preset_label;
  }
  if (config.site && config.token) {
    return "手动配置";
  }
  return "";
};

const compareVersions = (left = "", right = "") => {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

const preferredDesktopDownload = (manifest: DesktopUpdateManifest | null) => {
  const downloads = manifest?.downloads ?? {};
  const isMac = /Macintosh|Mac OS|MacIntel/i.test(navigator.userAgent);
  const isWindows = /Windows/i.test(navigator.userAgent);
  if (isMac) {
    return downloads.macosAarch64 ?? null;
  }
  if (isWindows) {
    return downloads.windowsX64 ?? null;
  }
  return downloads.macosAarch64 ?? downloads.windowsX64 ?? null;
};

const updateNote = (value?: string) => (value || "").trim().split(/\r?\n/).filter(Boolean)[0] || "";

const notifyUpdate = (message: string, kind: "ok" | "error" | "" = "") => {
  setToast(message, kind);
  logAppEvent(kind === "error" ? "warn" : "info", "update.status", message);
};

const resetSubmittedState = () => {
  lastSubmittedAt = null;
  lastSubmittedConfigLabel = "";
  renderSubmitMeta();
};

const markManualConfigEdited = () => {
  activeConfig = {
    ...activeConfig,
    preset_label: "",
  };
  resetSubmittedState();
  renderConfigStatus();
};

const openManualConfigDialog = () => {
  manualConfigDraft = {
    site: siteInput.value,
    token: tokenInput.value,
    presetLabel: activeConfig.preset_label || "",
  };
  manualDialogMessage.textContent = "";
  setToast("");
  showModalSafely(manualConfigDialog);
  (tokenInput.value ? siteInput : tokenInput).focus();
};

const closeManualConfigDialog = (options: { restore?: boolean } = {}) => {
  if (options.restore && manualConfigDraft) {
    siteInput.value = manualConfigDraft.site;
    tokenInput.value = manualConfigDraft.token;
    activeConfig = {
      ...activeConfig,
      preset_label: manualConfigDraft.presetLabel,
    };
    renderConfigStatus();
    renderAll();
  }
  manualConfigDraft = null;
  manualDialogMessage.textContent = "";
  closeDialogSafely(manualConfigDialog);
};

const showSubmitResult = (kind: "success" | "error", title: string, message: string) => {
  submitResultDialog.classList.toggle("result-dialog-success", kind === "success");
  submitResultDialog.classList.toggle("result-dialog-error", kind === "error");
  submitResultTitle.textContent = title;
  submitResultMessage.textContent = message;
  showModalSafely(submitResultDialog);
};

const switchTab = (tab: TabId) => {
  tabs.forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  pages.forEach((page) => {
    const selected = page.id === `${tab}Page`;
    page.classList.toggle("active", selected);
    page.hidden = !selected;
  });
};

const settingsSummaryRows = () => {
  const data = snapshot?.data ?? {};
  const cpu = asRecord(data.cpu);
  const os = asRecord(data.os);
  const firstNet = primaryNetwork(data.net);
  const memoryType = firstText(data, ["memory.0.type", "memLayout.0.type"], "");
  const memorySize = formatBytes(sumSizes(data.memory) || sumSizes(data.memLayout) || asRecord(data.mem).total);
  const ip = displayValue(firstNet.ip4 || firstNet.ip6);
  const iface = displayValue(firstNet.ifaceName || firstNet.iface, "");

  return [
    { label: "主板型号", value: baseboardLabel(data) },
    { label: "操作系统", value: systemLabel(os.distro, os.release) },
    { label: "处理器", value: joinUnique([cpu.manufacturer, cpu.brand]) || "未采集" },
    { label: "内存", value: [memoryType, memorySize].filter(Boolean).join(" ") },
    { label: "显卡", value: graphicsLabel(data) },
    { label: "硬盘", value: formatBytes(sumSizes(data.diskLayout)) },
    { label: "电脑名称", value: firstText(data, ["os.hostname", "system.model"], "未采集") },
    { label: "BIOS", value: biosLabel(data) },
    { label: "当前 IP", value: iface ? `${ip} (${iface})` : ip },
    { label: "显示器", value: displayLabel(data) },
  ];
};

const renderConfigStatus = (config: AgentConfig = getConfig()) => {
  const canSubmit = hasUploadConfig(config);
  submitButton.hidden = !canSubmit;

  if (config.site && config.token) {
    const label = config.preset_label ? `已导入：${config.preset_label}` : "已保存";
    configStateText.textContent = verifiedConfigKey === `${config.site}\n${config.token}` ? "连接正常" : `${label}，待验证`;
    return;
  }
  configStateText.textContent = "未配置";
};

const renderSettingsSummary = () => {
  settingsSummaryList.innerHTML = settingsSummaryRows()
    .map(
      (item) => `
        <div class="settings-summary-row">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `,
    )
    .join("");
};

const hasBatteryData = (value: unknown) => listItems(value).some((item) =>
  ["name", "manufacturer", "serial", "healthPercent", "chargePercent", "cycleCount", "condition", "status"].some((key) => {
    const field = asRecord(item)[key];
    return typeof field === "number" ? Number.isFinite(field) : typeof field === "string" && field.trim() !== "";
  })
);

const renderDetail = () => {
  const data = snapshot?.data ?? {};
  const visibleItems = detailItems.filter((item) => item.key !== "battery" || hasBatteryData(data.battery));
  if (!visibleItems.some((item) => item.key === activeDetail)) activeDetail = visibleItems[0].key;
  detailMenu.innerHTML = visibleItems
    .map(
      (item) => `
        <button class="detail-button ${item.key === activeDetail ? "active" : ""}" data-detail="${item.key}" type="button">
          <span>${item.title}</span>
          <small>${item.desc}</small>
        </button>
      `,
    )
    .join("");

  const selected = visibleItems.find((item) => item.key === activeDetail) ?? visibleItems[0];
  detailContent.innerHTML = renderHumanDetail(selected.key, data);

  detailMenu.querySelectorAll<HTMLButtonElement>(".detail-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeDetail = button.dataset.detail ?? activeDetail;
      renderDetail();
    });
  });
};

const renderAll = () => {
  renderSettingsSummary();
  renderDetail();
  renderSubmitMeta();
};

const renderSubmitMeta = () => {
  const existing = document.querySelector<HTMLElement>("#submitMeta");
  if (!existing) {
    return;
  }
  existing.hidden = !lastSubmittedAt;
  if (!lastSubmittedAt) {
    existing.textContent = "";
    return;
  }
  const label = lastSubmittedConfigLabel ? ` / ${lastSubmittedConfigLabel}` : "";
  existing.textContent = `最近提交：${formatClock(lastSubmittedAt)}${label}`;
};

const renderConfig = (config: AgentConfig) => {
  activeConfig = { ...config };
  siteInput.value = config.site || "";
  nameInput.value = config.name || "";
  tokenInput.value = config.token || "";
  configImportToolbar.hidden = false;
  renderConfigStatus(config);
  updateInteractiveState();
  renderAll();
};

const loadConfig = async () => {
  const config = await invoke<AgentConfig>("get_saved_config");
  renderConfig(config);
};

const saveConfig = async (options: { quietMissing?: boolean } = {}) => {
  const config = getConfig();
  if (!hasUploadConfig(config)) {
    if (!options.quietMissing) {
      showSubmitResult("error", "缺少上传配置", "请先导入配置，或手动填写完整授权码和站点地址。");
    }
    return false;
  }

  await invoke("save_config", { config });
  verifiedConfigKey = "";
  activeConfig = { ...config };
  renderConfigStatus(config);
  renderAll();
  return true;
};

const saveManualConfig = async () => {
  try {
    manualDialogMessage.textContent = "";
    const saved = await saveConfig({ quietMissing: true });
    if (!saved) {
      manualDialogMessage.textContent = "请填写完整授权码和站点地址。";
      return;
    }
    closeManualConfigDialog();
    setToast("上传配置已保存。", "ok");
  } catch (error) {
    manualDialogMessage.textContent = errorMessage(error);
  }
};

const openImportDialog = () => {
  configJsonInput.value = "";
  importDialogMessage.textContent = "";
  setToast("");
  showModalSafely(configImportDialog);
  configJsonInput.focus();
};

const closeImportDialog = () => {
  closeDialogSafely(configImportDialog);
};

const importConfig = async () => {
  try {
    const config = parseImportedConfig(configJsonInput.value);
    await invoke("save_config", { config });
    verifiedConfigKey = "";
    resetSubmittedState();
    renderConfig(config);
    closeManualConfigDialog();
    closeImportDialog();
    setToast("上传配置已导入。", "ok");
    logAppEvent("info", "ui.import_config_succeeded", config.token ? "token_present=true" : "token_present=false");
  } catch (error) {
    const message = errorMessage(error);
    importDialogMessage.textContent = message;
    logAppEvent("warn", "ui.import_config_failed", message);
  }
};

const verifyConfig = async () => {
  const config = getConfig();
  if (!hasUploadConfig(config)) {
    showSubmitResult("error", "无法验证", "请先导入配置，或手动填写完整授权码和站点地址。");
    return;
  }
  verifyConfigButton.disabled = true;
  setToast("正在验证连接...");
  try {
    const result = await invoke<string>("verify_upload_config", { config });
    verifiedConfigKey = `${config.site}\n${config.token}`;
    renderConfigStatus(config);
    setToast(result || "连接正常。", "ok");
  } catch (error) {
    verifiedConfigKey = "";
    renderConfigStatus(config);
    setToast(`连接验证失败：${errorMessage(error)}`, "error");
  } finally {
    updateInteractiveState();
  }
};

const clearConfig = async () => {
  if (!window.confirm("清除站点地址和授权码？清除后需要重新导入配置才能上传。")) {
    return;
  }
  try {
    await invoke("clear_saved_config");
    verifiedConfigKey = "";
    resetSubmittedState();
    renderConfig({ site: "", name: "", token: "" });
    setToast("上传配置已清除。", "ok");
  } catch (error) {
    setToast(`清除配置失败：${errorMessage(error)}`, "error");
  }
};

const clearImportDialog = () => {
  configJsonInput.value = "";
  importDialogMessage.textContent = "";
};

const collect = async (options: { submitContext?: boolean; preserveToast?: boolean } = {}) => {
  setCollecting(true);
  if (!options.preserveToast) {
    setToast("");
  }
  collectStateText.textContent = "采集中";
  try {
    snapshot = await invoke<DeviceSnapshot>("collect_device_snapshot");
    collectStateText.textContent = "已采集";
    renderAll();
    return true;
  } catch (error) {
    const message = errorMessage(error);
    collectStateText.textContent = "采集失败";
    setToast(message, "error");
    if (options.submitContext) {
      showSubmitResult("error", "提交失败", `提交前采集设备信息失败：${message}`);
    }
    return false;
  } finally {
    setCollecting(false);
  }
};

const loadAppVersion = async () => {
  try {
    currentAppVersion = await getVersion();
  } catch {
    currentAppVersion = "";
  }
};

const fetchDesktopUpdateManifest = async () => {
  const response = await fetch(`${DESKTOP_UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`更新清单读取失败：HTTP ${response.status}`);
  }
  latestDesktopManifest = (await response.json()) as DesktopUpdateManifest;
  const download = preferredDesktopDownload(latestDesktopManifest);
  downloadUpdateUrl = stringValue(download?.url) || stringValue(latestDesktopManifest.releaseUrl);
  return latestDesktopManifest;
};

const checkDesktopUpdate = async () => {
  setCheckingUpdate(true);
  pendingAutoUpdate = null;
  downloadUpdateUrl = "";
  let manualMessage = "";
  let manualUpdateAvailable = false;
  let manifestError = "";

  try {
    const manifest = await fetchDesktopUpdateManifest();
    const latestVersion = stringValue(manifest.version);
    const note = updateNote(manifest.notes);
    if (latestVersion && currentAppVersion && compareVersions(latestVersion, currentAppVersion) > 0) {
      manualUpdateAvailable = true;
      manualMessage = `发现新版本 ${latestVersion}${note ? `：${note}` : ""}`;
    } else if (latestVersion) {
      manualMessage = `当前已是最新版本 ${currentAppVersion || latestVersion}`;
    }
  } catch (error) {
    manifestError = errorMessage(error);
  }

  try {
    const update = await check({ timeout: 15000 });
    if (update) {
      pendingAutoUpdate = update;
      const note = updateNote(update.body);
      const message = `发现新版本 ${update.version}${note ? `：${note}` : ""}`;
      notifyUpdate(message, "ok");
      logAppEvent("info", "update.available", `version=${update.version}`);
      if (window.confirm(`${message}\n\n现在下载安装并重启？`)) {
        await installDesktopUpdate();
      }
      return;
    }
    if (manualMessage) {
      notifyUpdate(manualMessage, manualUpdateAvailable ? "ok" : "");
      if (manualUpdateAvailable && downloadUpdateUrl && window.confirm(`${manualMessage}\n\n自动更新暂未返回安装包，是否打开下载页面？`)) {
        await openDesktopUpdateDownload();
      }
      return;
    }
    notifyUpdate("当前已是最新版本。");
  } catch (error) {
    const updaterError = errorMessage(error);
    if (manualMessage) {
      const message = `${manualMessage}。自动更新暂不可用：${updaterError}`;
      notifyUpdate(message, manualUpdateAvailable ? "ok" : "error");
      if (manualUpdateAvailable && downloadUpdateUrl && window.confirm(`${message}\n\n是否打开下载页面？`)) {
        await openDesktopUpdateDownload();
      }
      return;
    }
    const message = manifestError ? `检查失败：${manifestError}；${updaterError}` : `检查失败：${updaterError}`;
    notifyUpdate(message, "error");
    window.alert(message);
    logAppEvent("warn", "update.check_failed", updaterError);
  } finally {
    setCheckingUpdate(false);
  }
};

const installDesktopUpdate = async () => {
  if (!pendingAutoUpdate) {
    return;
  }
  setInstallingUpdate(true);
  let downloaded = 0;
  try {
    await pendingAutoUpdate.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        downloaded = 0;
        notifyUpdate("开始下载更新包...");
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        notifyUpdate(`正在下载更新包：${formatBytes(downloaded)}`);
      } else if (event.event === "Finished") {
        notifyUpdate("更新包下载完成，正在安装...");
      }
    });
    notifyUpdate("更新已安装，正在重启软件...", "ok");
    logAppEvent("info", "update.installed", `version=${pendingAutoUpdate.version}`);
    await relaunch();
  } catch (error) {
    const message = errorMessage(error);
    notifyUpdate(`安装失败：${message}`, "error");
    window.alert(`安装失败：${message}`);
    logAppEvent("error", "update.install_failed", message);
  } finally {
    setInstallingUpdate(false);
  }
};

const openDesktopUpdateDownload = async () => {
  const url = downloadUpdateUrl || stringValue(latestDesktopManifest?.releaseUrl);
  if (!url) {
    return;
  }
  try {
    await invoke("open_url", { url });
    notifyUpdate("已打开下载页面。", "ok");
    logAppEvent("info", "update.open_download", url);
  } catch (error) {
    const message = `打开下载失败：${errorMessage(error)}`;
    notifyUpdate(message, "error");
    window.alert(message);
  }
};

const generateDiagnostics = async () => {
  if (isGeneratingDiagnostics || isExportingHardware || isCollecting || isSubmitting) {
    return;
  }
  setGeneratingDiagnostics(true);
  renderDiagnosticsProgress({ current: 0, total: 1, stage: "正在生成上传排障包...", detail: "后台正在收集系统信息。" });
  openDiagnosticsFolderButton.hidden = true;
  copyDiagnosticsPathButton.hidden = true;
  diagnosticsDirectoryPath = "";
  diagnosticsOutputPath = "";
  try {
    const result = await invoke<DiagnosticsPackage>("generate_diagnostics_package");
    diagnosticsDirectoryPath = result.directory_path;
    diagnosticsOutputPath = result.zip_path;
    openDiagnosticsFolderButton.hidden = false;
    copyDiagnosticsPathButton.hidden = false;
    diagnosticsResult.className = "diagnostics-result ok";
    diagnosticsResult.innerHTML = `
      <strong>排障包已生成</strong>
      <span>请将 zip 文件发送给管理员。</span>
      <span class="diagnostics-path">${escapeHtml(result.zip_path)}</span>
    `;
  } catch (error) {
    diagnosticsResult.className = "diagnostics-result error";
    diagnosticsResult.innerHTML = `
      <strong>生成失败</strong>
      <span>${escapeHtml(errorMessage(error))}</span>
    `;
  } finally {
    setGeneratingDiagnostics(false);
  }
};

const exportHardwareFeedback = async () => {
  if (isExportingHardware || isGeneratingDiagnostics || isCollecting || isSubmitting) {
    return;
  }
  setExportingHardware(true);
  openDiagnosticsFolderButton.hidden = true;
  copyDiagnosticsPathButton.hidden = true;
  diagnosticsDirectoryPath = "";
  diagnosticsOutputPath = "";
  diagnosticsResult.className = "diagnostics-result";
  diagnosticsResult.innerHTML = `
    <strong>正在重新采集硬件信息...</strong>
    <span>文件只保存在本机，不会自动上传。</span>
  `;
  try {
    const result = await invoke<HardwareFeedbackExport>("export_hardware_feedback");
    diagnosticsDirectoryPath = result.directory_path;
    diagnosticsOutputPath = result.file_path;
    openDiagnosticsFolderButton.hidden = false;
    copyDiagnosticsPathButton.hidden = false;
    diagnosticsResult.className = "diagnostics-result ok";
    diagnosticsResult.innerHTML = `
      <strong>硬件信息已导出</strong>
      <span>请将这个 JSON 文件作为问题反馈附件。</span>
      <span class="diagnostics-path">${escapeHtml(result.file_path)}</span>
    `;
    try {
      await invoke("open_path", { path: result.directory_path });
    } catch (error) {
      logAppEvent("warn", "ui.open_hardware_export_folder_failed", errorMessage(error));
    }
  } catch (error) {
    diagnosticsResult.className = "diagnostics-result error";
    diagnosticsResult.innerHTML = `
      <strong>导出失败</strong>
      <span>${escapeHtml(errorMessage(error))}</span>
    `;
  } finally {
    setExportingHardware(false);
  }
};

const renderDiagnosticsProgress = (progress: DiagnosticsProgress) => {
  const total = Math.max(1, Math.round(finiteNumber(progress.total) ?? 1));
  const current = Math.min(total, Math.max(0, Math.round(finiteNumber(progress.current) ?? 0)));
  const percent = Math.round((current / total) * 100);
  diagnosticsResult.className = "diagnostics-result";
  diagnosticsResult.innerHTML = `
    <strong>${escapeHtml(progress.stage || "正在生成上传排障包...")}</strong>
    <span>${escapeHtml(progress.detail || "后台正在收集系统信息。")}</span>
    <div class="diagnostics-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <span style="width: ${percent}%"></span>
    </div>
    <small class="diagnostics-progress-meta">${escapeHtml(`${current}/${total}`)}</small>
  `;
};

const copyDiagnosticsPath = async () => {
  if (!diagnosticsOutputPath) {
    return;
  }
  try {
    await navigator.clipboard.writeText(diagnosticsOutputPath);
    diagnosticsResult.className = "diagnostics-result ok";
    diagnosticsResult.innerHTML = `
      <strong>文件位置已复制</strong>
      <span>可以将对应文件作为问题反馈附件。</span>
      <span class="diagnostics-path">${escapeHtml(diagnosticsOutputPath)}</span>
    `;
  } catch (error) {
    diagnosticsResult.className = "diagnostics-result error";
    diagnosticsResult.innerHTML = `
      <strong>复制失败</strong>
      <span>${escapeHtml(errorMessage(error))}</span>
    `;
  }
};

configForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

collectButton.addEventListener("click", () => {
  void collect();
});
importConfigButton.addEventListener("click", openImportDialog);
manualConfigButton.addEventListener("click", openManualConfigDialog);
verifyConfigButton.addEventListener("click", () => void verifyConfig());
clearConfigButton.addEventListener("click", () => void clearConfig());
cancelImportButton.addEventListener("click", closeImportDialog);
confirmImportButton.addEventListener("click", importConfig);
configImportDialog.addEventListener("close", clearImportDialog);
cancelManualConfigButton.addEventListener("click", () => closeManualConfigDialog({ restore: true }));
saveManualConfigButton.addEventListener("click", () => {
  void saveManualConfig();
});
manualConfigDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeManualConfigDialog({ restore: true });
});
checkIdentityButton.addEventListener("click", async () => {
  if (isCheckingIdentity || isCollecting || isSubmitting || isGeneratingDiagnostics || isExportingHardware) return;
  isCheckingIdentity = true;
  checkIdentityButton.textContent = "检查中...";
  identityCheckResult.className = "diagnostics-result";
  identityCheckResult.textContent = "正在重新采集设备身份...";
  updateInteractiveState();
  try {
    if (!await collect()) throw new Error("采集失败，请导出上传排障包查看原因。");
    const result = asRecord(snapshot?.data.identityDiagnostics);
    const label = (value: unknown) => value === "valid" ? "有效" : value === "invalid_placeholder" ? "厂家默认值或无效值" : "未采集到";
    const ready = result.decision === "ready";
    identityCheckResult.className = `diagnostics-result ${ready ? "ok" : "error"}`;
    identityCheckResult.innerHTML = `<strong>${ready ? "可以识别此设备" : "暂时无法识别此设备"}</strong>
      <span>系统 UUID：${label(result.systemUuid)}</span>
      <span>主板序列号：${label(result.baseboardSerial)}</span>
      <span>有效永久 PCI 网卡地址：${escapeHtml(result.permanentPciMacCount ?? 0)} 个</span>
      <span>${ready ? "本次仅检查，未上传。" : "请导出硬件信息，交给管理员核对。"}</span>`;
  } catch (error) {
    identityCheckResult.className = "diagnostics-result error";
    identityCheckResult.textContent = errorMessage(error);
  } finally {
    isCheckingIdentity = false;
    checkIdentityButton.textContent = "检查设备身份";
    updateInteractiveState();
  }
});
generateDiagnosticsButton.addEventListener("click", () => {
  void generateDiagnostics();
});
exportHardwareButton.addEventListener("click", () => {
  void exportHardwareFeedback();
});
openDiagnosticsFolderButton.addEventListener("click", () => {
  if (diagnosticsDirectoryPath) {
    logAppEvent("info", "ui.open_diagnostics_folder", diagnosticsDirectoryPath);
    void invoke("open_path", { path: diagnosticsDirectoryPath });
  }
});

copyDiagnosticsPathButton.addEventListener("click", () => {
  void copyDiagnosticsPath();
});

void listen(MENU_CHECK_UPDATE_EVENT, () => {
  if (isCheckingUpdate || isInstallingUpdate) {
    notifyUpdate("正在处理更新，请稍候。");
    return;
  }
  notifyUpdate("正在检查更新...");
  void checkDesktopUpdate();
});

void listen<DiagnosticsProgress>("diagnostics-progress", (event) => {
  if (!isGeneratingDiagnostics) {
    return;
  }
  renderDiagnosticsProgress(event.payload);
}).catch((error) => {
  console.warn("diagnostics progress listener failed", error);
});

submitButton.addEventListener("click", async () => {
  if (!hasUploadConfig()) {
    showSubmitResult("error", "缺少上传配置", "请先导入配置，或手动填写完整授权码和站点地址。");
    logAppEvent("warn", "ui.submit_blocked_missing_config");
    return;
  }
  setSubmitting(true);
  setToast("");
  try {
    if (!snapshot) {
      const collected = await collect({ submitContext: true });
      if (!collected) {
        return;
      }
    }
    if (!snapshot) {
      return;
    }

    const saved = await saveConfig();
    if (!saved) {
      return;
    }
    const response = await invoke<SubmitDeviceResponse>("submit_device_data", {
      config: getConfig(),
      data: snapshot.data,
    });
    lastSubmittedAt = new Date();
    lastSubmittedConfigLabel = configLabel();
    renderSubmitMeta();
    showSubmitResult("success", "上传成功", formatSubmitResultMessage(response));
  } catch (error) {
    showSubmitResult("error", "上传失败", errorMessage(error));
  } finally {
    setSubmitting(false);
  }
});

helpButton.addEventListener("click", () => showModalSafely(helpDialog));
closeHelpButton.addEventListener("click", () => closeDialogSafely(helpDialog));
closeSubmitResultButton.addEventListener("click", () => closeDialogSafely(submitResultDialog));

tabs.forEach((button) => {
  button.addEventListener("click", () => switchTab((button.dataset.tab ?? "settings") as TabId));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const current = tabs.indexOf(button);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    switchTab((next.dataset.tab ?? "settings") as TabId);
    next.focus();
  });
});

nameInput.addEventListener("input", () => {
  resetSubmittedState();
  renderAll();
});
siteInput.addEventListener("input", () => {
  verifiedConfigKey = "";
  markManualConfigEdited();
});
tokenInput.addEventListener("input", () => {
  verifiedConfigKey = "";
  markManualConfigEdited();
});

renderAll();

const bootstrap = async () => {
  await loadAppVersion();
  let loadConfigError = "";
  try {
    await loadConfig();
  } catch (error) {
    loadConfigError = `配置读取失败：${errorMessage(error)}。请重新导入上传配置。`;
    setToast(loadConfigError, "error");
  }

  try {
    const cachedSnapshot = await invoke<DeviceSnapshot | null>("get_cached_device_snapshot");
    if (cachedSnapshot) {
      snapshot = cachedSnapshot;
      collectStateText.textContent = "已加载缓存，正在刷新";
      renderAll();
    }
  } catch (error) {
    console.warn("cached snapshot load failed", error);
  }
  await collect({ preserveToast: Boolean(loadConfigError) });
  if (loadConfigError && collectStateText.textContent === "已采集") {
    setToast(loadConfigError, "error");
  }
};

void bootstrap();

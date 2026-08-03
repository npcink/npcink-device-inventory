import { readFile } from "node:fs/promises";
import process from "node:process";

const SCHEMA = "npcink-windows-hardware-identity-probe-v1";
const INVALID_VALUES = new Set([
  "0",
  "00000000",
  "00000000-0000-0000-0000-000000000000",
  "03000200-0400-0500-0006-000700080009",
  "ffffffff",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "xxxxxxxx",
  "default string",
  "n/a",
  "na",
  "invalid",
  "undefined",
  "not applicable",
  "none",
  "null",
  "not specified",
  "not available",
  "not present",
  "not provided",
  "not set",
  "unknown",
  "to be filled by o.e.m.",
  "to be filled by oem",
  "not filled by o.e.m.",
  "system serial number",
  "-",
]);

function normalizeIdentityValue(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim().replace(/\s+/g, " ").toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (
    !normalized ||
    INVALID_VALUES.has(normalized) ||
    !compact ||
    /^0+$/.test(compact) ||
    /^x+$/.test(compact) ||
    (compact.length >= 8 && /^f+$/.test(compact))
  ) {
    return null;
  }
  return normalized;
}

function normalizeMac(value) {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (compact.length !== 12 || /^0+$/.test(compact) || /^f+$/.test(compact)) {
    return null;
  }
  return compact.match(/.{2}/g).join(":");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pnpBus(value) {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toUpperCase();
  if (normalized.startsWith("PCI\\")) {
    return "pci";
  }
  if (normalized.startsWith("USB\\")) {
    return "usb";
  }
  return "other";
}

function parseProbeJson(contents) {
  return JSON.parse(contents.replace(/^\uFEFF/, ""));
}

export function analyzeWindowsIdentityProbe(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Probe payload must be a JSON object.");
  }
  if (payload.schema !== SCHEMA) {
    throw new Error(`Unexpected probe schema: ${payload.schema || "missing"}`);
  }

  const baseboard = payload.baseboard && typeof payload.baseboard === "object" ? payload.baseboard : {};
  const systemProduct = payload.systemProduct && typeof payload.systemProduct === "object" ? payload.systemProduct : {};
  const processors = Array.isArray(payload.processors) ? payload.processors : [];
  const adapters = Array.isArray(payload.physicalNetworkAdapters) ? payload.physicalNetworkAdapters : [];

  const systemUuid = normalizeIdentityValue(systemProduct.uuid);
  const baseboardSerial = normalizeIdentityValue(baseboard.serialNumber);
  const baseboardManufacturer = normalizeIdentityValue(baseboard.manufacturer);
  const baseboardProduct = normalizeIdentityValue(baseboard.product);
  const cpuModels = unique(processors.map((processor) => normalizeIdentityValue(processor?.name)));
  const cpuProcessorIds = unique(processors.map((processor) => normalizeIdentityValue(processor?.processorId)));
  const pciAdapters = adapters.filter((adapter) => pnpBus(adapter?.pnpDeviceId) === "pci");
  const usbAdapters = adapters.filter((adapter) => pnpBus(adapter?.pnpDeviceId) === "usb");
  const permanentPciMacs = unique(pciAdapters.map((adapter) => normalizeMac(adapter?.permanentAddress)));
  const currentPciMacs = unique(pciAdapters.map((adapter) => normalizeMac(adapter?.macAddress)));
  const otherPermanentMacs = unique(
    adapters
      .filter((adapter) => pnpBus(adapter?.pnpDeviceId) !== "pci")
      .map((adapter) => normalizeMac(adapter?.permanentAddress))
  );
  const hasBoardGuard = Boolean(baseboardManufacturer && baseboardProduct);
  const hasCpuGuard = cpuModels.length > 0;

  let tier = "insufficient";
  if (systemUuid || (baseboardSerial && hasBoardGuard)) {
    tier = "strong";
  } else if (permanentPciMacs.length > 0 && hasBoardGuard && hasCpuGuard) {
    tier = "fallback_candidate";
  } else if (currentPciMacs.length > 0 && hasBoardGuard && hasCpuGuard) {
    tier = "manual_candidate";
  }

  return {
    schema: SCHEMA,
    assetNumber: typeof payload.assetNumber === "string" ? payload.assetNumber.trim() : "",
    tier,
    strongSignals: {
      systemUuid: Boolean(systemUuid),
      baseboardSerial: Boolean(baseboardSerial),
    },
    fallbackSignals: {
      permanentPciMacCount: permanentPciMacs.length,
      currentPciMacCount: currentPciMacs.length,
      usbAdapterCount: usbAdapters.length,
      otherPermanentMacCount: otherPermanentMacs.length,
      baseboardDescriptor: hasBoardGuard,
      cpuDescriptor: hasCpuGuard,
      cpuProcessorIdCount: cpuProcessorIds.length,
      tpmPresent: payload.tpm?.present === true,
      tpmReady: payload.tpm?.ready === true,
    },
    probeErrors: Array.isArray(payload.errors) ? payload.errors.length : 0,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Windows identity probe self-test failed: ${message}`);
  }
}

async function runSelfTest() {
  const shared = {
    schema: SCHEMA,
    systemProduct: { uuid: "03000200-0400-0500-0006-000700080009" },
    baseboard: { manufacturer: "Example", product: "Board", serialNumber: "Default string" },
    processors: [{ name: "Example CPU", processorId: "CPU-FAMILY-VALUE" }],
    physicalNetworkAdapters: [],
    tpm: { present: false, ready: false },
    errors: [],
  };

  const strong = analyzeWindowsIdentityProbe({
    ...shared,
    systemProduct: { uuid: "c32f1978-f6ad-4679-b356-f230cc47c915" },
  });
  assert(strong.tier === "strong", "a usable SMBIOS UUID must be strong");

  const fallback = analyzeWindowsIdentityProbe({
    ...shared,
    physicalNetworkAdapters: [{ pnpDeviceId: "PCI\\VEN_1234&DEV_5678", permanentAddress: "AA-BB-CC-DD-EE-01", macAddress: "aa:bb:cc:dd:ee:01" }],
    tpm: { present: true, ready: true },
  });
  assert(fallback.tier === "fallback_candidate", "permanent MAC plus board and CPU guards must be a fallback candidate");
  assert(fallback.fallbackSignals.permanentPciMacCount === 1, "permanent PCI MAC must be normalized and counted");

  const manual = analyzeWindowsIdentityProbe({
    ...shared,
    physicalNetworkAdapters: [{ pnpDeviceId: "PCI\\VEN_1234&DEV_5678", permanentAddress: null, macAddress: "aa:bb:cc:dd:ee:02" }],
  });
  assert(manual.tier === "manual_candidate", "a current physical MAC without a permanent address must remain manual");

  const usbOnly = analyzeWindowsIdentityProbe({
    ...shared,
    physicalNetworkAdapters: [{ pnpDeviceId: "USB\\VID_1234&PID_5678", permanentAddress: "aa:bb:cc:dd:ee:03" }],
  });
  assert(usbOnly.tier === "insufficient", "a USB adapter must not become a hardware identity anchor");
  assert(usbOnly.fallbackSignals.usbAdapterCount === 1, "USB adapters must be reported separately");

  const serialWithoutBoard = analyzeWindowsIdentityProbe({
    ...shared,
    baseboard: { serialNumber: "BOARD-ONLY-001" },
  });
  assert(serialWithoutBoard.tier === "insufficient", "a board serial without manufacturer and product guards must not be strong");

  const insufficient = analyzeWindowsIdentityProbe(shared);
  assert(insufficient.tier === "insufficient", "placeholder-only hardware must be insufficient");
  assert(!insufficient.strongSignals.systemUuid, "the known shared UUID must be rejected");
  assert(parseProbeJson("\uFEFF{\"schema\":\"test\"}").schema === "test", "PowerShell UTF-8 BOM must be accepted");

  const powershellSource = await readFile(
    new URL("../ele-rs/scripts/windows-hardware-identity-probe.ps1", import.meta.url),
    "utf8"
  );
  assert(
    !powershellSource.includes("System.Collections.Generic.List"),
    "the probe must avoid the Windows PowerShell 5.1 generic-list array conversion bug"
  );
  assert(powershellSource.includes("trap {"), "the probe must report the failing PowerShell source line");

  console.log("Windows hardware identity probe self-test passed.");
}

async function analyzeFile(filePath) {
  const payload = parseProbeJson(await readFile(filePath, "utf8"));
  const analysis = analyzeWindowsIdentityProbe(payload);
  console.log(JSON.stringify({ file: filePath, ...analysis }, null, 2));
}

const args = process.argv.slice(2);
const runEmbeddedSelfTest = args.includes("--self-test");
const filePaths = args.filter((arg) => arg !== "--self-test");
if (runEmbeddedSelfTest) {
  await runSelfTest();
}
if (filePaths.length > 0) {
  try {
    for (const filePath of filePaths) {
      await analyzeFile(filePath);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (!runEmbeddedSelfTest) {
  console.error("Usage: node scripts/check-windows-hardware-identity-probe.mjs --self-test|<probe.json> [...]");
  process.exitCode = 1;
}

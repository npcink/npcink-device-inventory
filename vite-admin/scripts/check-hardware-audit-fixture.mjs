import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixturePath = path.join(root, "tests/fixtures/hardware-audit-assets.json");
const entryPath = path.join(root, "src/utils/hardwareAudit.ts");
const outDir = await mkdtemp(path.join(tmpdir(), "npcink-hardware-audit-"));
const outFile = path.join(outDir, "hardwareAudit.mjs");

const aliasPlugin = {
  name: "npcink-alias",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@\// }, (args) => buildApi.resolve(
      path.join(root, "src", args.path.slice(2)), { kind: args.kind, resolveDir: args.resolveDir }
    ));
  },
};

try {
  await build({
    entryPoints: [entryPath],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [aliasPlugin],
    logLevel: "silent",
  });

  const { assetHardwareContext, hardwareMemoryModules, hardwareMemoryBytes, memoryModuleRows, diskComponentRows, collectionAgeBand, collectionFreshness, collectionOverdueLevel, detectHardwareIssues, hardwareSummary, inferredGraphicsForFallbackDriver, issueGroup } = await import(pathToFileURL(outFile).href);
  for (const [vendor, model, expected] of [
    ["NVIDIA", "NVIDIA GeForce GTX 1650", "NVIDIA GeForce GTX 1650"],
    ["Intel(R)", "Intel(R) Iris(R) Xe Graphics", "Intel(R) Iris(R) Xe Graphics"],
    [" nvidia ", " NVIDIA GeForce GTX 1650 ", "NVIDIA GeForce GTX 1650"],
    ["AMD", "Radeon RX 6600", "AMD Radeon RX 6600"],
    ["", "Test GPU", "Test GPU"],
  ]) {
    const summary = { graphics: `${vendor} ${model}` };
    const hardware = { graphics: { controllers: [{ vendor, model }] } };
    const before = JSON.stringify({ summary, hardware });
    assert.equal(hardwareSummary(summary, hardware).graphics, expected);
    assert.equal(JSON.stringify({ summary, hardware }), before, "Display must preserve stored observations");
  }
  assert.equal(hardwareSummary({ graphics: "Legacy GPU" }, {}).graphics, "Legacy GPU");
  assert.equal(hardwareSummary({ graphics: "Legacy GPU" }, { graphics: { controllers: [{ vendor: "NVIDIA" }] } }).graphics, "Legacy GPU");
  const moduleHardware = {
    memory: { modules: [
      { bank: "DIMM_A1", size: 8 * 1024 ** 3, type: "DDR4", manufacturer: "Kingston", partNum: "KVR32N22S8/8", clockSpeed: 3200, speedUnit: "MT/s", voltageConfigured: 1.2, configuredVoltageMv: 1200 },
      { bank: "DIMM_B1", size: 8 * 1024 ** 3, type: "DDR4", manufacturer: "Crucial", partNum: "CT8G4DFRA32A", clockSpeed: 2933, speedUnit: "MHz" },
    ], system: { total: 15.8 * 1024 ** 3 } },
    disks: [{ model: "Samsung SSD 980", name: "Physical disk", size: 512 * 1024 ** 3, type: "SSD", interfaceType: "NVMe" }],
  };
  const beforeComponents = JSON.stringify(moduleHardware);
  const modules = memoryModuleRows(moduleHardware);
  assert.equal(modules.length, 2, "Nested memory.modules must preserve both installed sticks");
  assert.equal(modules[0].model, "KVR32N22S8/8");
  assert.equal(modules[1].brand, "Crucial");
  assert.equal(modules[1].frequency, "2933 MHz");
  assert.equal(modules[0].frequency, "3200 MT/s");
  assert.equal(modules[0].capacity, "8 GB");
  assert.equal(modules[0].slot, "DIMM_A1");
  assert.equal(hardwareSummary({}, moduleHardware).memoryLines.length, 2);
  assert.equal(hardwareMemoryBytes({ latestObservation: { summary: {}, hardware: moduleHardware } }), 16 * 1024 ** 3);
  assert.equal(hardwareMemoryModules({ memory: { modules: [{ size: 16 * 1024 ** 3, bank: "", type: "", partNum: "" }] } }).length, 0, "An aggregate RAM placeholder is not proof of one physical stick");
  assert.equal(hardwareMemoryBytes({ latestObservation: { summary: {}, hardware: { memLayout: [{ size: 16 * 1024 ** 3 }] } } }), 16 * 1024 ** 3, "Reported total remains available without inferring a physical module count");
  assert.equal(hardwareMemoryModules({ memLayout: [{ size: 16 * 1024 ** 3, bank: "Unified Memory", manufacturer: "Apple", type: "Unified" }] }).length, 0, "Unified RAM must not be counted as one DIMM");
  assert.equal(hardwareMemoryModules({ memory: { modules: [{ size: 0, bank: "DIMM_A2", type: "DDR4" }] } }).length, 0, "Empty slots must not inflate module counts");
  assert.equal(diskComponentRows(moduleHardware)[0].model, "Samsung SSD 980", "Model must win over a generic disk name");
  assert.equal(diskComponentRows(moduleHardware)[0].interface, "NVMe");
  assert.equal(diskComponentRows({ disks: [{ size: 100, mount: "C:\\", fsType: "NTFS", name: "System" }] })[0].isVolume, true, "Filesystem volumes cannot prove physical disk counts");
  assert.equal(JSON.stringify(moduleHardware), beforeComponents, "Display parsing must preserve collected facts");
  for (const [moduleName, modulePath] of [
    ["finance", "src/pages/shared/finance.tsx"],
    ["analysisData", "src/components/analysis/analysisData.ts"],
    ["tabular", "src/pages/shared/tabular.tsx"],
    ["assetForm", "src/pages/shared/assetForm.ts"],
    ["assets", "src/pages/shared/assets.tsx"],
    ["cache", "src/pages/shared/cache.tsx"],
  ]) {
    await build({
      entryPoints: [path.join(root, modulePath)], outfile: path.join(outDir, `${moduleName}.cjs`),
      bundle: true, format: "cjs", platform: "node", jsx: "automatic",
      plugins: [{ name: "no-fixture-network", setup(builder) {
        builder.onResolve({ filter: /^@\/services\/v3$/ }, () => ({ path: "asset-api", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const getAssets = () => { throw new Error('Unexpected fixture network request'); };" }));
      } }, aliasPlugin], logLevel: "silent",
    });
  }
  const { assetPurchaseDateText, calculatedFinancialResidualForAsset, effectiveFinancialResidualValue } = createRequire(import.meta.url)(path.join(outDir, "finance.cjs"));
  const { assetMissingFields, assetValueSummary } = createRequire(import.meta.url)(path.join(outDir, "analysisData.cjs"));
  const { assetsToCsv, ASSET_EXPORT_FIELDS, csvCell, parseTabularText, buildImportPreviewRows } = createRequire(import.meta.url)(path.join(outDir, "tabular.cjs"));
  const { assetFormValuesToInput } = createRequire(import.meta.url)(path.join(outDir, "assetForm.cjs"));
  const { customAssetInfo } = createRequire(import.meta.url)(path.join(outDir, "assets.cjs"));
  globalThis.window = {};
  const { clearObsoleteAssetListCache } = createRequire(import.meta.url)(path.join(outDir, "cache.cjs"));
  const stored = {
    "npcinkDeviceInventoryAssetList:computer": "obsolete",
    "npcinkDeviceInventoryAssetList:custom": "obsolete",
    "npcinkDeviceInventoryAssetListOther": "keep",
    "npcinkDeviceInventorySavedFilters": "keep",
    "npcinkDeviceInventoryLayout": "keep",
  };
  window.localStorage = new Proxy(stored, { get(target, key) {
    return key === "removeItem" ? (name) => { delete target[name]; } : target[key];
  } });
  clearObsoleteAssetListCache();
  assert.deepEqual(Object.keys(stored), ["npcinkDeviceInventoryAssetListOther", "npcinkDeviceInventorySavedFilters", "npcinkDeviceInventoryLayout"], "Only obsolete full-list entries may be removed");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
  assert.doesNotThrow(clearObsoleteAssetListCache, "Unavailable storage must not prevent startup");
  delete globalThis.window;
  const financeAsset = {
    id: 1, uuid: "finance-fixture", assetType: "computer", assetNumber: "FIN-001", name: "电脑",
    department: "IT", ownerName: "管理员", status: "active", createdAt: "2010-01-01",
    purchasePrice: 5000, financialResidualValue: 0, secondHandMarketValue: 0, metadata: {},
    latestObservation: { observedAt: "2026-11-10", summary: { cpu: "Test CPU", memory_bytes: 8 * 1024 ** 3, disk_bytes: 256 * 1024 ** 3 } },
  };
  const financeSettings = { depreciationPeriodMonths: 60, defaultResidualRate: 5 };
  assert.equal(assetPurchaseDateText(financeAsset), "", "A registration date must never substitute for an unknown purchase date");
  assert.equal(calculatedFinancialResidualForAsset(financeAsset, financeSettings), null, "Unknown purchase dates cannot support depreciation estimates");
  assert.deepEqual(assetMissingFields(financeAsset), [], "Zero money values do not make operational records incomplete");
  const retiredAsset = { ...financeAsset, status: "retired", ownerName: "" };
  assert.equal(effectiveFinancialResidualValue(retiredAsset, financeSettings), 0);
  assert.deepEqual(assetMissingFields(retiredAsset), [], "Retired assets do not require an owner or a positive valuation");
  const datedAsset = { ...financeAsset, metadata: { purchase: { order_time: "2026-01-15" } } };
  assert.equal(assetPurchaseDateText(datedAsset), "2026-01-15", "Explicit purchase dates must survive unchanged");
  assert.equal(typeof calculatedFinancialResidualForAsset(datedAsset, financeSettings), "number");
  assert(assetMissingFields({ ...financeAsset, ownerName: "" }).includes("责任人"), "An active asset without an owner must remain actionable");
  const manualZero = { ...financeAsset, metadata: { finance: { financial_residual_mode: "manual" } } };
  const autoZero = { ...financeAsset, metadata: { purchase: { order_time: "2010-01-01" }, finance: { financial_residual_mode: "auto" } } };
  const zeroResidualSettings = { ...financeSettings, defaultResidualRate: 0 };
  const financeFacts = [financeAsset, manualZero, autoZero, retiredAsset];
  const beforeFinance = JSON.stringify(financeFacts);
  assert.equal(effectiveFinancialResidualValue(financeAsset, financeSettings), null, "The default stored zero cannot prove an unknown automatic carrying amount");
  assert.equal(effectiveFinancialResidualValue(manualZero, financeSettings), 0, "A manual zero must remain known");
  assert.equal(effectiveFinancialResidualValue(autoZero, zeroResidualSettings), 0, "Fully depreciated automatic zero must remain known");
  assert.equal(effectiveFinancialResidualValue({ ...financeAsset, financialResidualValue: 500 }, financeSettings), 500, "Historical positive entries must survive missing purchase dates");
  const values = assetValueSummary(financeFacts, zeroResidualSettings);
  assert.equal(values.totalPurchase, 20000);
  assert.equal(values.totalResidual, 0);
  assert.equal(values.knownDepreciation, 15000, "Manual, fully depreciated and retired zero amounts must all contribute depreciation");
  assert.equal(values.unknownResidualCount, 1);
  assert.equal(values.departmentRows[0].value, 0);
  assert(values.departmentRows[0].meta.includes("3 条"), "Unknown amounts must not inflate department value counts");
  assert.equal(assetValueSummary([financeAsset], financeSettings).totalResidual, null, "No known values must not be reported as a zero total");
  assert.equal(assetValueSummary([financeAsset], financeSettings).knownDepreciation, null);
  const financialField = ASSET_EXPORT_FIELDS.find((field) => field.key === "financialResidualValue");
  assert.equal(financialField.value(financeAsset, financeSettings), null, "Excel and preview must receive an empty cell for unknown values");
  assert.equal(financialField.value(manualZero, financeSettings), 0);
  assert.deepEqual(assetsToCsv(financeFacts, ["assetNumber", "financialResidualValue"], zeroResidualSettings).split("\n").slice(1), ["FIN-001,", "FIN-001,0", "FIN-001,0", "FIN-001,0"], "CSV must distinguish blank unknown amounts from known zero");
  assert.equal(JSON.stringify(financeFacts), beforeFinance, "Financial display and export must not mutate stored asset facts");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell("=1+1"), "'=1+1", "Empty-value handling must preserve CSV formula protection");
  assert.equal(csvCell('a,"b"'), '"a,""b"""', "Quoted CSV fields must stay escaped");
  const editedAsset = {
    ...financeAsset, financialResidualValue: 1700, metadata: {
      purpose: "原用途", notes: "原备注",
      purchase: { title: "原名称", total: 5000, numbers: 2, purchaser: "采购员", shop_name: "原店铺", link: "https://example.test/item", order: "ORDER-1", order_time: "2026-01-15", platform: "京东", pay_method: "微信", future: "保留扩展" },
      finance: { financial_residual_mode: "auto", future: "保留财务扩展" },
    },
  };
  const beforeEdit = JSON.stringify(editedAsset);
  const basicEdit = assetFormValuesToInput({ name: "新名称" }, editedAsset, financeSettings);
  assert.equal(basicEdit.metadata.purpose, "原用途", "Unrendered fields must survive a partial edit");
  assert.equal(basicEdit.metadata.purchase.order_time, "2026-01-15");
  assert.equal(basicEdit.metadata.purchase.numbers, 2);
  assert.equal(basicEdit.metadata.purchase.shop_name, "原店铺");
  assert.equal(basicEdit.metadata.purchase.future, "保留扩展");
  assert.equal(basicEdit.metadata.finance.future, "保留财务扩展");
  assert.equal(basicEdit.purchasePrice, 5000);
  assert.equal(basicEdit.name, "新名称");
  assert.equal(basicEdit.metadata.purchase.title, "原名称", "Legacy mirrored facts are preserved, never rewritten");
  const moneyEdit = assetFormValuesToInput({ name: "主记录名称", purchasePrice: 1234 }, editedAsset, financeSettings);
  assert.equal(moneyEdit.purchasePrice, 1234);
  assert.equal(moneyEdit.metadata.purchase.total, 5000);
  const canonicalInfo = customAssetInfo({ ...editedAsset, ...moneyEdit });
  assert.equal(canonicalInfo.title, "主记录名称", "Stale purchase titles must not override the asset name");
  assert.equal(canonicalInfo.priceText, "1,234 元", "Stale purchase totals must not override the purchase price");
  const newInput = assetFormValuesToInput({ name: "新增", purchasePrice: 100 }, null, financeSettings);
  assert.equal(newInput.metadata.purchase.title, undefined);
  assert.equal(newInput.metadata.purchase.total, undefined);
  const clearedDate = assetFormValuesToInput({ financialResidualMode: "auto", orderTime: "", financialResidualValue: 4200 }, editedAsset, financeSettings);
  assert.equal(clearedDate.metadata.purchase.order_time, "");
  assert.equal(clearedDate.financialResidualValue, 0, "Clearing the purchase date must not store an obsolete automatic estimate");
  assert.equal(effectiveFinancialResidualValue({ ...editedAsset, ...clearedDate }, financeSettings), null);
  for (const purchasePrice of [0, null]) {
    assert.equal(assetFormValuesToInput({ financialResidualMode: "auto", purchasePrice, financialResidualValue: 4200 }, editedAsset, financeSettings).financialResidualValue, 0, "Clearing or zeroing the price must discard obsolete automatic estimates");
  }
  const recalculated = assetFormValuesToInput({ financialResidualMode: "auto", purchasePrice: 8000, orderTime: "2026-01-15", financialResidualValue: 1 }, editedAsset, financeSettings);
  assert.equal(recalculated.financialResidualValue, calculatedFinancialResidualForAsset({ ...editedAsset, purchasePrice: 8000 }, financeSettings), "The final submitted inputs must determine automatic value");
  const manualEdit = assetFormValuesToInput({ financialResidualMode: "manual", financialResidualValue: 0, orderTime: "" }, editedAsset, financeSettings);
  assert.equal(manualEdit.financialResidualValue, 0);
  assert.equal(effectiveFinancialResidualValue({ ...editedAsset, ...manualEdit }, financeSettings), 0, "Explicit manual zero must remain known");
  const historicalAuto = { ...editedAsset, metadata: { ...editedAsset.metadata, purchase: { ...editedAsset.metadata.purchase, order_time: "" } } };
  assert.equal(assetFormValuesToInput({ name: "只改名称" }, historicalAuto, financeSettings).financialResidualValue, 1700, "Unchanged historical positive amounts must survive unrelated edits");
  assert.equal(assetFormValuesToInput({ financialResidualMode: "auto" }, { ...historicalAuto, metadata: { ...historicalAuto.metadata, finance: { financial_residual_mode: "manual" } } }, financeSettings).financialResidualValue, 0, "Switching to automatic without inputs must not retain a manual amount as an estimate");
  const clearedPurchase = assetFormValuesToInput({ purpose: "", purchaser: "", order: "", numbers: 0, shopName: "", platform: undefined }, editedAsset, financeSettings);
  assert.equal(clearedPurchase.metadata.purpose, "");
  assert.equal(clearedPurchase.metadata.purchase.purchaser, "");
  assert.equal(clearedPurchase.metadata.purchase.order, "");
  assert.equal(clearedPurchase.metadata.purchase.numbers, 0);
  assert.equal(clearedPurchase.metadata.purchase.platform, "", "Explicitly cleared selects may submit undefined, which differs from an absent field");
  assert.equal(clearedPurchase.metadata.purchase.link, "https://example.test/item");
  assert.equal(assetFormValuesToInput({ financialResidualMode: "auto", purchasePrice: 9000 }, editedAsset).financialResidualValue, 0, "Unavailable settings must not preserve an estimate after its inputs change");
  assert.equal(JSON.stringify(editedAsset), beforeEdit, "Form serialization must not mutate the stored asset");
  const importedAsset = {
    ...financeAsset, category: "台式电脑", metadata: {
      notes: "保留备注", purchase: { order_time: "2026-01-15", vendor: "保留供应商" },
      manualHardware: { cpu: "旧 CPU", memory: "16 GB", disk: "512 GB", raw: { cpu: "旧 CPU", memory: "16 GB", disk: "512 GB", future: "保留原始信息" } },
    },
  };
  const beforeImport = JSON.stringify(importedAsset);
  const importPreview = (row, sections = ["basic", "finance", "hardware"]) => buildImportPreviewRows(
    [{ assetNumber: "FIN-001", ...row }], [importedAsset], "upsert-by-number", sections, ["IT"]
  )[0];
  const financeOnly = importPreview({ assetType: "手机", category: "新分类", name: "不应修改", status: "报废", purchasePrice: "0" }, ["finance"]);
  assert.equal(financeOnly.action, "update");
  assert.equal(financeOnly.input.assetType, "computer", "Finance-only import must preserve the asset type");
  assert.equal(financeOnly.input.category, "台式电脑");
  assert.equal(financeOnly.input.name, "电脑");
  assert.equal(financeOnly.input.status, "active");
  assert.equal(financeOnly.input.purchasePrice, 0, "An explicit zero must overwrite the previous amount");
  assert.equal(financeOnly.input.metadata.purchase.total, undefined, "Imports must not add a mirrored purchase total");
  assert.equal(financeOnly.input.metadata.purchase.vendor, "保留供应商");
  assert.equal(importPreview({ purchasePrice: "" }).input.purchasePrice, 5000, "Blank amounts preserve existing facts");
  const hardwareOnly = importPreview({ cpu: "新 CPU" }, ["hardware"]).input.metadata;
  assert.equal(hardwareOnly.manualHardware.cpu, "新 CPU");
  assert.equal(hardwareOnly.manualHardware.memory, "16 GB", "Partial hardware import must preserve other fields");
  assert.equal(hardwareOnly.manualHardware.raw.cpu, "新 CPU");
  assert.equal(hardwareOnly.manualHardware.raw.future, "保留原始信息");
  assert.equal(hardwareOnly.notes, "保留备注");
  for (const field of ["purchasePrice", "secondHandMarketValue", "financialResidualValue"]) {
    for (const value of ["abc", "NaN", "Infinity", "-1", "10000000000", "1,2", "￥元", "0x10"]) {
      assert.equal(importPreview({ [field]: value }).action, "invalid", `${field}=${value} must not silently become valid money`);
    }
    assert.equal(importPreview({ [field]: "￥ 1,234.50 元" }).input[field], 1234.5);
    assert.notEqual(importPreview({ [field]: "9999999999.99" }).action, "invalid");
  }
  assert.equal(importPreview({ purchasePrice: "abc", status: "未知状态", purchaseDate: "not-a-date" }, ["hardware"]).action, "update", "Ignored sections must not reject unrelated columns");
  assert.equal(importPreview({}, []).action, "invalid", "An empty selection must never produce an executable import");
  assert.equal(importPreview({ status: "未知状态" }).action, "invalid");
  assert.equal(importPreview({ status: "maintenance" }).input.status, "maintenance");
  assert.equal(importPreview({ status: "闲置" }).input.status, "inactive");
  for (const date of ["2026-02-29", "2026-02-31", "unknown"]) {
    assert.equal(importPreview({ purchaseDate: date }).action, "invalid", `Invalid purchase date ${date} must not be normalized into another date`);
  }
  assert.equal(importPreview({ purchaseDate: "2024-02-29" }).input.metadata.purchase.order_time, "2024-02-29");
  assert.equal(JSON.stringify(importedAsset), beforeImport, "Preflight must not mutate existing assets");
  const multilineName = '第一行\n第二行，带 "引号"';
  assert.equal(parseTabularText(assetsToCsv([{ ...financeAsset, name: multilineName }], ["assetNumber", "name"]))[0]["资产名称"], multilineName);
  const exportedPriceRow = parseTabularText(assetsToCsv([financeAsset], ["assetNumber", "purchasePrice"]))[0];
  assert.equal(buildImportPreviewRows([exportedPriceRow], [], "create-only", ["finance"])[0].input.purchasePrice, 5000, "Exported purchase-price headers must also be recognized on import");
  assert.deepEqual(parseTabularText('\uFEFF资产编号,备注\r\nFIN-001,"第一行\r\n第二行"\r\n'), [{ 资产编号: "FIN-001", 备注: "第一行\r\n第二行" }]);
  for (const text of ['资产编号,备注\nFIN-001,"未闭合', '资产编号,备注\nFIN-001,多余,一列', '资产编号,资产编号\nA,B', '资产名称\n无编号', '[{"assetNumber":"FIN-001"}]']) {
    assert.throws(() => parseTabularText(text), undefined, "Malformed or unsupported input must never leave executable rows");
  }
  const detailBundle = path.join(outDir, "hardware-details.cjs");
  await build({
    entryPoints: [path.join(root, "src/pages/shared/detail.tsx")],
    outfile: detailBundle, bundle: true, format: "cjs", platform: "node", jsx: "automatic",
    plugins: [aliasPlugin], logLevel: "silent",
  });
  const { hardwareDetailSections, groupDetailSections, visibleDetailSections } = createRequire(path.join(root, "package.json"))(detailBundle);
  const residualDetail = (asset) => hardwareDetailSections(asset, assetHardwareContext(asset), financeSettings).find((section) => section.key === "asset").rows.find((row) => row.key === "financialResidualValue").value;
  assert.equal(residualDetail(financeAsset), "暂无法确定");
  assert(residualDetail(manualZero).includes("0"), "Technical details must display a known zero instead of missing-value copy");
  const detailAsset = { assetType: "computer", metadata: {}, latestObservation: { summary: {}, hardware: moduleHardware } };
  const sections = hardwareDetailSections(detailAsset, assetHardwareContext(detailAsset));
  const memoryDetails = sections.find((section) => section.key === "memory").rows;
  assert.equal(memoryDetails.find((row) => row.key === "memory-0-manufacturer").value, "Kingston");
  assert.equal(memoryDetails.find((row) => row.key === "memory-1-partNum").value, "CT8G4DFRA32A");
  assert.equal(memoryDetails.find((row) => row.key === "memory-1-clockSpeed").value, "2933 MHz");
  assert.equal(memoryDetails.find((row) => row.key === "memory-0-clockSpeed").value, "3200 MT/s");
  assert.equal(memoryDetails.find((row) => row.key === "memory-1-bank").value, "DIMM_B1");
  const diskDetails = sections.find((section) => section.key === "disk").rows;
  assert.equal(diskDetails.find((row) => row.key === "disk-0-model").value, "Samsung SSD 980");
  assert.equal(memoryDetails.find((row) => row.key === "memory-count").value, "2 条");
  assert.equal(memoryDetails.find((row) => row.key === "memory-0-voltageConfigured").value, "1.2 V");
  assert.equal(memoryDetails.find((row) => row.key === "memory-0-configuredVoltageMv").value, "1200 mV");
  assert.equal(hardwareMemoryModules({ memory: { kind: "dimm", modules: [{ size: 16 * 1024 ** 3 }] } }).length, 1, "Explicit physical-memory provenance establishes a module even if SPD metadata is absent");
  assert.equal(memoryDetails.find((row) => row.key === "memory-combination").value, "8 GB × 2");
  const completeHardware = {
    ...moduleHardware,
    memory: { ...moduleHardware.memory, arrays: [{ slots: 4, maxCapacityBytes: 128 * 1024 ** 3 }] },
    disks: [{ ...moduleHardware.disks[0], firmwareRevision: "2A", extraDiskFact: false }],
    volumes: [{ name: "新加卷", mount: "D:\\", fsType: "NTFS", size: 200 * 1024 ** 3 }],
    hardwareUuid: "HW-COMPLETE",
    os: { arch: "x86_64", hostname: "PC-COMPLETE", kernel: "10.0" },
    graphics: { controllers: [{ model: "Test GPU", driverVersion: "999.1", virtualExtra: 0 }], displays: [{ resolution: "3840 x 2160", yearOfManufacture: 2024 }] },
    bios: { serial: "BIOS-COMPLETE" },
    collection: { hardwareProbes: [{ source: "memory_modules", status: "failed", error: "query_timeout", elapsedMs: 12000 }] },
    platformData: { memory_modules: [{ FutureField: "FUTURE-RAW" }] },
    futureCategory: { unknownFact: "PRESERVE-ME", enabled: false, count: 0 },
  };
  const completeAsset = { ...detailAsset, uuid: "ASSET-COMPLETE", latestObservation: { summary: { os: "Windows complete" }, hardware: completeHardware } };
  const completeSections = hardwareDetailSections(completeAsset, assetHardwareContext(completeAsset));
  const rowsFor = (key) => completeSections.find((section) => section.key === key).rows;
  assert.equal(rowsFor("memory").find((row) => row.key === "memory-free-slots").value, "2");
  assert(rowsFor("memory").some((row) => row.value === "查询超时"));
  assert(rowsFor("disk").some((row) => row.value === "2A"));
  assert(rowsFor("disk").some((row) => row.value === "否"));
  assert(rowsFor("volumes").some((row) => row.attribute === "卷标" && row.value === "新加卷"));
  assert(!rowsFor("volumes").some((row) => row.attribute.includes("硬盘") || row.attribute === "型号"));
  assert(rowsFor("uuid").some((row) => row.value === "HW-COMPLETE"));
  assert(rowsFor("os").some((row) => row.value === "Windows complete"));
  assert(rowsFor("graphics").some((row) => row.value === "999.1"));
  assert(rowsFor("graphics").some((row) => row.value === "0"));
  assert(rowsFor("display").some((row) => row.value === "3840 x 2160"));
  assert(rowsFor("bios").some((row) => row.value === "BIOS-COMPLETE"));
  assert(rowsFor("platform").some((row) => row.value === "FUTURE-RAW"));
  assert(rowsFor("additional").some((row) => row.value === "PRESERVE-ME"));
  assert(rowsFor("additional").some((row) => row.value === "否"));
  assert(rowsFor("additional").some((row) => row.value === "0"));
  const volumeOnlyAsset = { ...detailAsset, latestObservation: { summary: { memory_bytes: 16 * 1024 ** 3 }, hardware: { memory: { system: { total: 16 * 1024 ** 3 }, modules: null }, disks: [{ name: "新加卷", mount: "D:\\", fsType: "NTFS", size: 200 * 1024 ** 3 }] } } };
  const partialSections = hardwareDetailSections(volumeOnlyAsset, assetHardwareContext(volumeOnlyAsset));
  assert(partialSections.find((section) => section.key === "memory").rows.some((row) => row.key === "memory-count" && row.value.includes("未知")));
  assert(partialSections.find((section) => section.key === "disk").rows.some((row) => row.key === "disk-count" && row.value.includes("未知")));
  assert(!partialSections.find((section) => section.key === "disk").rows.some((row) => row.value === "新加卷"));
  const emptyHardwareAsset = { ...detailAsset, latestObservation: { summary: {}, hardware: {
    storage: { devices: [], health: [{ note: "  ", value: null }] },
    security: { secureBoot: null, tpm: {} },
    peripherals: { audio: [], usb: [null, " "] },
  } } };
  const emptySections = hardwareDetailSections(emptyHardwareAsset, assetHardwareContext(emptyHardwareAsset));
  const beforeEmptySections = JSON.stringify(emptySections);
  const defaultSections = visibleDetailSections(emptySections);
  for (const key of ["storage", "security", "peripherals", "battery", "platform", "processor", "memory", "disk", "volumes", "bios", "chassis", "system", "os"]) {
    assert(!defaultSections.some((section) => section.key === key), `Empty ${key} must not leave a navigation item`);
  }
  assert(defaultSections.every((section) => section.rows.length > 0 && section.rows.every((row) => !row.empty)));
  assert(visibleDetailSections(emptySections, true).some((section) => section.key === "storage" && section.rows.some((row) => row.empty)), "Show empty fields must restore placeholders for inspection");
  assert.equal(JSON.stringify(emptySections), beforeEmptySections, "Visibility filtering must not mutate the collected rows");
  const visibleComplete = visibleDetailSections(completeSections);
  assert(visibleComplete.find((section) => section.key === "additional").rows.some((row) => row.value === "0"));
  assert(visibleComplete.find((section) => section.key === "additional").rows.some((row) => row.value === "否"));
  assert(visibleComplete.find((section) => section.key === "collection").rows.some((row) => row.value === "查询超时"));
  assert(!visibleComplete.find((section) => section.key === "memory").rows.some((row) => row.key === "memory-0-serialNum"), "Missing fields within a populated module should also be hidden");
  const beforeGrouping = JSON.stringify(completeSections);
  const groupedSections = groupDetailSections(completeSections);
  assert.deepEqual(groupedSections.map((section) => section.label), ["资产", "处理器", "内存", "存储", "图形与显示", "网络与外设", "系统与固件", "采集诊断"]);
  assert.deepEqual(groupedSections.flatMap((section) => section.rows.map((row) => row.key)).sort(), completeSections.flatMap((section) => section.rows.map((row) => row.key)).sort(), "Grouping must preserve every source row exactly once");
  const groupedStorage = groupedSections.find((section) => section.key === "storage").rows;
  assert(groupedStorage.some((row) => row.group === "物理硬盘 1" && row.value === "Samsung SSD 980"));
  assert(groupedStorage.some((row) => row.group === "卷 1" && row.value === "新加卷"), "Physical disks and filesystem volumes must remain separately labeled inside storage");
  assert(groupedSections.find((section) => section.key === "graphics").rows.some((row) => row.value === "3840 x 2160"));
  assert(groupedSections.find((section) => section.key === "system").rows.some((row) => row.value === "BIOS-COMPLETE"));
  assert(groupedSections.find((section) => section.key === "diagnostics").rows.some((row) => row.value === "FUTURE-RAW"));
  assert.equal(JSON.stringify(completeSections), beforeGrouping);
  assert(!visibleDetailSections(groupDetailSections(emptySections)).some((section) => ["storage", "graphics", "devices"].includes(section.key)), "Merged categories must still hide when all source rows are empty");
  assert.equal(visibleDetailSections(groupDetailSections(emptySections), true).length, 8, "Showing empty fields must not restore the old long navigation");
  assert(visibleDetailSections(groupDetailSections(partialSections)).find((section) => section.key === "storage").rows.some((row) => row.value === "新加卷"), "Volume-only observations must retain their storage category");
  const graphicsAsset = (platform, controllers) => ({ ...detailAsset, latestObservation: { summary: { platform }, hardware: { graphics: { controllers } } } });
  const graphicsRows = (asset) => hardwareDetailSections(asset, assetHardwareContext(asset)).find((section) => section.key === "graphics").rows;
  const oldGraphics = graphicsAsset("Windows", [{ model: "NVIDIA GeForce RTX 5060", vram: 4293918720 }]);
  const oldGraphicsBefore = JSON.stringify(oldGraphics);
  const oldGraphicsRows = graphicsRows(oldGraphics);
  assert(!oldGraphicsRows.some((row) => row.key.endsWith("-vram")), "Legacy 32-bit AdapterRAM must not be displayed as actual VRAM");
  assert(oldGraphicsRows.some((row) => row.attribute.includes("待核实") && row.value.includes("4,293,918,720 字节")));
  assert(oldGraphicsRows.some((row) => row.value.includes("容量可能截断")));
  assert.equal(JSON.stringify(oldGraphics), oldGraphicsBefore, "Marking legacy VRAM must not rewrite saved observations");
  const dxgiRows = graphicsRows(graphicsAsset("Windows", [{ model: "NVIDIA GeForce RTX 5060", vram: 8 * 1024 ** 3, vramSource: "DXGI_ADAPTER_DESC1.DedicatedVideoMemory", sharedSystemMemoryBytes: 16 * 1024 ** 3 }]));
  assert(dxgiRows.some((row) => row.key.endsWith("-vram") && row.value === "8 GB"));
  assert(dxgiRows.some((row) => row.attribute.includes("非独立显存") && row.value === "16 GB"));
  assert(graphicsRows(graphicsAsset("darwin", [{ model: "AMD Radeon", vram: 8 * 1024 ** 3 }])).some((row) => row.key.endsWith("-vram") && row.value === "8 GB"), "macOS reported VRAM must remain unchanged");
  const relationHardware = {
    ...moduleHardware,
    storage: {
      topology: {
        status: "partial",
        partitions: [{ partitionDevice: "partition-a", diskIndex: 0, partitionIndex: 0, startingOffsetBytes: 1048576, bootPartition: false }],
        volumeMappings: [
          { mount: "C:", diskDevices: ["disk-a"], partitionDevices: ["partition-a"], matchStatus: "matched" },
          { mount: "D:", diskDevices: ["disk-a", "disk-b"], partitionDevices: ["partition-a", "partition-b"], matchStatus: "matched" },
          { mount: "E:", diskDevices: [], matchStatus: "ambiguous", reason: "duplicate_identifier" },
          { mount: "F:", diskDevices: [], matchStatus: "unmapped", reason: "no_association" },
        ],
      },
      health: [{ StorageUniqueId: "uid-b", Temperature: 32 }],
      healthMappings: [{ healthRecordIndex: 0, storageUniqueId: "uid-b", storageSerialNumber: "serial-b", matchStatus: "matched" }],
    },
    graphics: {
      controllers: [{ model: "Same GPU", dxgiMatchStatus: "ambiguous", dxgiMatchReason: "ambiguous_instance_match", vram: null }],
      displays: [{ modeMatchStatus: "single_pair_fallback", resolutionSource: "Win32_VideoController (single adapter/display fallback)" }],
    },
    collection: { hardwareProbes: [
      { source: "memory_modules", status: "empty", reason: "no_records" },
      { source: "storage_health", status: "failed", reason: "permission_denied" },
      { source: "monitor_edid", status: "failed", reason: "query_timeout" },
      { source: "tpm", status: "failed", reason: "unsupported" },
    ] },
  };
  const relationAsset = { ...detailAsset, latestObservation: { summary: { platform: "windows" }, hardware: relationHardware } };
  const relationBefore = JSON.stringify(relationAsset);
  const relationSections = visibleDetailSections(groupDetailSections(hardwareDetailSections(relationAsset, assetHardwareContext(relationAsset))));
  const relationRows = relationSections.find((section) => section.key === "storage").rows;
  assert(relationRows.some((row) => row.attribute === "关联物理盘" && row.value === "disk-a、disk-b"));
  assert(relationRows.some((row) => row.value === "关联不唯一，无法确认"));
  assert(relationRows.some((row) => row.value === "系统未返回可解析的关联"));
  assert(relationRows.some((row) => row.attribute === "分区起始偏移" && row.value === "1,048,576 字节"));
  assert(relationRows.some((row) => row.attribute === "对应健康记录" && row.value === "第 1 条健康记录"));
  assert(relationRows.some((row) => row.value === "serial-b"));
  assert(relationRows.some((row) => row.value === "权限不足"));
  assert(relationSections.find((section) => section.key === "memory").rows.some((row) => row.value === "未返回记录"));
  assert(!relationSections.flatMap((section) => section.rows).some((row) => row.value === "未发现设备"), "Empty results must not assert absent hardware");
  const relationGraphics = relationSections.find((section) => section.key === "graphics").rows;
  assert(relationGraphics.some((row) => row.value.includes("未分配显存")));
  assert(relationGraphics.some((row) => row.value === "单显卡单显示器模式回退"));
  assert(relationGraphics.some((row) => row.value === "查询超时"));
  assert(relationSections.find((section) => section.key === "system").rows.some((row) => row.value === "系统不支持"));
  assert(relationSections.find((section) => section.key === "diagnostics").rows.some((row) => row.attribute === "硬件查询诊断记录数" && row.value === "4"));
  assert.equal(JSON.stringify(relationAsset), relationBefore);
  const macAsset = { ...detailAsset, latestObservation: { summary: { platform: "darwin" }, hardware: {
    collection: { hardwareProbes: [
      { source: "system_profiler_core", status: "ok" },
      { source: "SPMemoryDataType", status: "failed", reason: "missing_result" },
    ] },
  } } };
  const macMemory = visibleDetailSections(hardwareDetailSections(macAsset, assetHardwareContext(macAsset))).find((section) => section.key === "memory").rows;
  assert(macMemory.some((row) => row.value === "该子查询未返回结果"));
  assert(!macMemory.some((row) => row.value === "成功"), "Process-level success must not hide failed memory subtype");
  macAsset.latestObservation.hardware.collection.hardwareProbes = [{ source: "system_profiler_core", status: "failed", reason: "query_timeout" }];
  assert(visibleDetailSections(hardwareDetailSections(macAsset, assetHardwareContext(macAsset))).find((section) => section.key === "memory").rows.some((row) => row.value === "查询超时"), "Group failure remains evidence when no subtype was returned");
  const partialHealthAsset = { ...detailAsset, latestObservation: { summary: {}, hardware: {
    storage: { health: [{ StorageUniqueId: "disk-ok", Temperature: 0 }] },
    collection: { hardwareProbes: [{ source: "storage_health", status: "partial", error: "item_query_failed", recordCount: 1, itemErrors: [{ reference: { StorageUniqueId: "disk-denied" }, error: "permission_denied" }] }] },
  } } };
  const partialHealthRows = visibleDetailSections(groupDetailSections(hardwareDetailSections(partialHealthAsset, assetHardwareContext(partialHealthAsset)))).find((section) => section.key === "storage").rows;
  assert(partialHealthRows.some((row) => row.value === "部分完成（信息不完整）"));
  assert(partialHealthRows.some((row) => row.value === "设备明细查询失败"));
  assert(partialHealthRows.some((row) => row.value === "权限不足"));
  assert(partialHealthRows.some((row) => row.value === "disk-denied"));
  assert(partialHealthRows.some((row) => row.attribute === "温度（采集时）" && row.value === "0"));
  const assets = JSON.parse(await readFile(fixturePath, "utf8"));
  const issues = detectHardwareIssues(assets);
  const whitespaceOwnerIssues = detectHardwareIssues([
    {
      ...assets[1],
      uuid: "fixture-active-whitespace-owner",
      assetNumber: "OWNER-WS-001",
      ownerName: "   ",
    },
  ]);
  const issueTypes = new Set(issues.map((issue) => issue.type));
  const groups = new Set(issues.map((issue) => issueGroup(issue.type)));

  const expectedTypes = [
    "重复编号",
    "重复 IP",
    "部门待分配",
    "责任人缺失",
    "CPU 缺失",
    "显卡缺失",
    "内存缺失",
    "硬盘缺失",
    "未接入采集",
  ];
  const expectedGroups = [
    "重复风险",
    "资料缺失",
    "硬件缺失",
    "采集状态",
  ];

  const missingTypes = expectedTypes.filter((type) => !issueTypes.has(type));
  const missingGroups = expectedGroups.filter((group) => !groups.has(group));
  const activeMissingOwner = issues.some((issue) => issue.key === "fixture-missing-hardware-missing-owner");
  const inactiveMissingOwner = issues.some((issue) => issue.key === "fixture-inactive-unassigned-missing-owner");
  const maintenanceIssueCreated = issues.some((issue) => issue.type === "待维护");
  const whitespaceMissingOwner = whitespaceOwnerIssues.some(
    (issue) => issue.key === "fixture-active-whitespace-owner-missing-owner"
  );
  const placeholderIssues = detectHardwareIssues([
    {
      ...assets[1],
      uuid: "fixture-placeholder-one",
      assetNumber: "PLACEHOLDER-001",
      latestObservation: {
        ...assets[1].latestObservation,
        summary: { ...assets[1].latestObservation.summary, primary_ip: "127.0.0.1" },
        hardware: { ...assets[1].latestObservation.hardware, baseboard: { serial: "Default string" } },
      },
    },
    {
      ...assets[1],
      uuid: "fixture-placeholder-two",
      assetNumber: "PLACEHOLDER-002",
      latestObservation: {
        ...assets[1].latestObservation,
        summary: { ...assets[1].latestObservation.summary, primary_ip: "127.0.0.1" },
        hardware: { ...assets[1].latestObservation.hardware, baseboard: { serial: "Default string" } },
      },
    },
  ]);
  const placeholderDuplicateIssues = placeholderIssues.filter((issue) => issue.type === "重复 IP" || issue.type === "疑似重复设备");
  const freshnessNow = Date.parse("2026-07-10T00:00:00Z");
  const freshSample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-07-03T00:00:00Z" } };
  const agingSample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-07-02T00:00:00Z" } };
  const stale31To60Sample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-06-09T00:00:00Z" } };
  const stale61To90Sample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-05-10T00:00:00Z" } };
  const stale90PlusSample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-04-10T00:00:00Z" } };
  const staleSample = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: "2026-06-09T00:00:00Z" } };
  const missingSample = { ...assets[1], latestObservation: undefined };
  const freshnessClassificationFailed =
    collectionFreshness(freshSample, freshnessNow) !== "fresh" ||
    collectionFreshness(agingSample, freshnessNow) !== "aging" ||
    collectionFreshness(staleSample, freshnessNow) !== "stale" ||
    collectionFreshness(missingSample, freshnessNow) !== "missing";
  const ageBandClassificationFailed =
    collectionAgeBand(freshSample, freshnessNow) !== "fresh" ||
    collectionAgeBand(agingSample, freshnessNow) !== "aging" ||
    collectionAgeBand(stale31To60Sample, freshnessNow) !== "stale_31_60" ||
    collectionAgeBand(stale61To90Sample, freshnessNow) !== "stale_61_90" ||
    collectionAgeBand(stale90PlusSample, freshnessNow) !== "stale_90_plus" ||
    collectionAgeBand(missingSample, freshnessNow) !== "missing";
  const atCollectionAge = (days) => new Date(freshnessNow - days * 86400000).toISOString();
  const collection179Days = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: atCollectionAge(179) } };
  const collection180Days = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: atCollectionAge(180) } };
  const collection270Days = { ...assets[1], latestObservation: { ...assets[1].latestObservation, observedAt: atCollectionAge(270) } };
  const collectionThresholdFailed =
    collectionOverdueLevel(collection179Days, freshnessNow) !== null ||
    collectionOverdueLevel(collection180Days, freshnessNow) !== "warning" ||
    collectionOverdueLevel(collection270Days, freshnessNow) !== "error" ||
    detectHardwareIssues([collection179Days], freshnessNow).some((issue) => issue.type === "长期未采集") ||
    detectHardwareIssues([collection180Days], freshnessNow).find((issue) => issue.type === "长期未采集")?.level !== "warning" ||
    detectHardwareIssues([collection270Days], freshnessNow).find((issue) => issue.type === "长期未采集")?.level !== "error";
  const duplicateNumberIssue = issues.find((issue) => issue.key === "fixture-missing-hardware-duplicate-number");
  const boardOnlyDuplicateAssets = [
    {
      ...assets[1],
      uuid: "fixture-board-only-one",
      assetNumber: "BOARD-ONLY-001",
      latestObservation: {
        ...assets[1].latestObservation,
        hardware: {
          ...assets[1].latestObservation.hardware,
          uuid: { hardware: "HARDWARE-ONE", macs: ["aa:bb:cc:dd:ee:01"] },
          baseboard: { serial: "BOARD-SHARED" },
        },
      },
    },
    {
      ...assets[1],
      uuid: "fixture-board-only-two",
      assetNumber: "BOARD-ONLY-002",
      latestObservation: {
        ...assets[1].latestObservation,
        hardware: {
          ...assets[1].latestObservation.hardware,
          uuid: { hardware: "HARDWARE-TWO", macs: ["aa:bb:cc:dd:ee:02"] },
          baseboard: { serial: "BOARD-SHARED" },
        },
      },
    },
  ];
  const strongIdentityDuplicateAssets = [
    {
      ...boardOnlyDuplicateAssets[0],
      uuid: "fixture-strong-identity-one",
      assetNumber: "IDENTITY-001",
      latestObservation: {
        ...boardOnlyDuplicateAssets[0].latestObservation,
        hardware: {
          ...boardOnlyDuplicateAssets[0].latestObservation.hardware,
          uuid: { hardware: "HARDWARE-SHARED", macs: ["aa:bb:cc:dd:ee:ff"] },
        },
      },
    },
    {
      ...boardOnlyDuplicateAssets[1],
      uuid: "fixture-strong-identity-two",
      assetNumber: "IDENTITY-002",
      latestObservation: {
        ...boardOnlyDuplicateAssets[1].latestObservation,
        hardware: {
          ...boardOnlyDuplicateAssets[1].latestObservation.hardware,
          uuid: { hardware: "HARDWARE-SHARED", macs: ["aa:bb:cc:dd:ee:ff"] },
        },
      },
    },
  ];
  const boardOnlyDuplicateIssues = detectHardwareIssues(boardOnlyDuplicateAssets, freshnessNow).filter(
    (issue) => issue.type === "疑似重复设备"
  );
  const strongIdentityDuplicateIssue = detectHardwareIssues(strongIdentityDuplicateAssets, freshnessNow).find(
    (issue) => issue.key === "fixture-strong-identity-one-duplicate-identity"
  );
  const duplicateRelationFailed =
    duplicateNumberIssue?.duplicateGroupKey !== "number:dup-001" ||
    !duplicateNumberIssue.relatedAssets?.some((asset) => asset.uuid === "fixture-duplicate-hardware") ||
    boardOnlyDuplicateIssues.length > 0 ||
    strongIdentityDuplicateIssue?.duplicateGroupKey !== "identity:fixture-strong-identity-one,fixture-strong-identity-two" ||
    !strongIdentityDuplicateIssue.relatedAssets?.some((asset) => asset.uuid === "fixture-strong-identity-two") ||
    !strongIdentityDuplicateIssue.message.includes("主 MAC 地址") ||
    !strongIdentityDuplicateIssue.message.includes("主板序列号 BOARD-SHARED 也相同");
  const virtualGraphicsSummary = hardwareSummary(
    { graphics: "OrayIddDriver Device" },
    {
      graphics: {
        controllers: [
          { model: "OrayIddDriver Device" },
          { model: "NVIDIA GeForce RTX 4060" },
        ],
      },
    }
  );
  const virtualGraphicsFilteringFailed = virtualGraphicsSummary.graphics !== "NVIDIA GeForce RTX 4060";
  const fallbackGraphicsInferenceFailed =
    inferredGraphicsForFallbackDriver("Intel Core i7-9700K") !== "UHD 630（驱动未识别）" ||
    inferredGraphicsForFallbackDriver("Intel Core i7-9700KF") !== "显卡驱动未识别";

  if (missingTypes.length || missingGroups.length || !activeMissingOwner || inactiveMissingOwner || maintenanceIssueCreated || !whitespaceMissingOwner || placeholderDuplicateIssues.length || freshnessClassificationFailed || ageBandClassificationFailed || collectionThresholdFailed || duplicateRelationFailed || virtualGraphicsFilteringFailed || fallbackGraphicsInferenceFailed) {
    console.error("Hardware audit fixture check failed.");
    if (missingTypes.length) {
      console.error(`Missing issue types: ${missingTypes.join(", ")}`);
    }
    if (missingGroups.length) {
      console.error(`Missing issue groups: ${missingGroups.join(", ")}`);
    }
    if (!activeMissingOwner) {
      console.error("Active asset without an owner must report 责任人缺失.");
    }
    if (inactiveMissingOwner) {
      console.error("Inactive asset without an owner must not report 责任人缺失.");
    }
    if (maintenanceIssueCreated) {
      console.error("Maintenance status is a lifecycle state and must not create a pending issue.");
    }
    if (!whitespaceMissingOwner) {
      console.error("Whitespace-only owner names must report 责任人缺失 for active assets.");
    }
    if (placeholderDuplicateIssues.length) {
      console.error("Loopback IP and default hardware strings must not create duplicate-risk issues.");
    }
    if (freshnessClassificationFailed) {
      console.error("Collection freshness must preserve the 7-day, 30-day, and missing-data boundaries.");
    }
    if (ageBandClassificationFailed) {
      console.error("Collection age bands must preserve the 31-60, 61-90, and 90-plus day boundaries.");
    }
    if (collectionThresholdFailed) {
      console.error("Long-uncollected reminders must start at 180 days and become high risk at 270 days.");
    }
    if (duplicateRelationFailed) {
      console.error("Board serial alone must not create a duplicate issue; strong identity matches must retain related assets and a stable group key.");
    }
    if (virtualGraphicsFilteringFailed) {
      console.error("Known remote-display adapters must not replace the physical graphics controller.");
    }
    if (fallbackGraphicsInferenceFailed) {
      console.error("Microsoft's fallback display driver must infer UHD 630 for i7-9700K without inferring graphics for KF models.");
    }
    console.error(`Detected types: ${Array.from(issueTypes).join(", ")}`);
    process.exit(1);
  }

  console.log(`Hardware audit fixture check passed: ${issues.length} issues, ${groups.size} groups.`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}

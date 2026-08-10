import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixturePath = path.join(root, "tests/fixtures/hardware-audit-assets.json");
const entryPath = path.join(root, "src/utils/hardwareAudit.ts");
const outDir = await mkdtemp(path.join(tmpdir(), "npcink-hardware-audit-"));
const outFile = path.join(outDir, "hardwareAudit.mjs");

const aliasPlugin = {
  name: "npcink-alias",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@\// }, (args) => ({
      path: path.join(root, "src", args.path.slice(2)),
    }));
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

  const { collectionAgeBand, collectionFreshness, collectionOverdueLevel, detectHardwareIssues, hardwareSummary, inferredGraphicsForFallbackDriver, issueGroup } = await import(pathToFileURL(outFile).href);
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

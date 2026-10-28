import { lazy } from "react";
import { DeferredPanel } from "@/components/DeferredPanel";
import {
  buildHardwareInventoryRows,
  buildHardwareQueryItems,
  filterHardwareQueryItems,
  observationComparableFields,
} from "@/components/analysis/analysisData";
import { AnalysisDistribution, analysisDistribution } from "@/components/analysis/AnalysisDistribution";
import {
  COLLECTION_BAND_META,
  HARDWARE_INVENTORY_OPTIONS,
  createEmptyHardwareQuery,
  type AnalysisTabKey,
  type AnalysisViewKey,
  type AssetCompletenessRow,
  type AssetPlanningView,
  type DataHealthView,
  type HardwareAnalysisView,
  type HardwareChangeRow,
  type HardwareInventoryKey,
  type HardwareQueryItem,
  type HardwareQueryState,
  type RenewalCandidateRow,
} from "@/components/analysis/analysisTypes";
import { RenewalView, ValueOverviewView } from "@/components/analysis/AssetPlanningViews";
import { CollectionHealthView } from "@/components/analysis/CollectionHealthView";
import { DataQualityView } from "@/components/analysis/DataQualityView";
import { HardwareChangesView } from "@/components/analysis/HardwareChangesView";
import { HardwareInventoryView } from "@/components/analysis/HardwareInventoryView";
import { HardwareQueryView } from "@/components/analysis/HardwareQueryView";
import { fetchComparisonObservations } from "@/services/analysis";
import { getCollectionTrends, getSettings } from "@/services/v3";
import type { Asset, ComparisonObservation } from "@/type/v3";
import {
  assetHardwareContext,
  collectionAgeBand,
  collectionAgeDays,
  detectHardwareIssues,
  hardwareDiskBytes,
  hardwareMemoryBytes,
  issueGroup,
} from "@/utils/hardwareAudit";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Modal, Radio, Table, Tabs, Tag, Typography } from "antd";
import { useMemo, useState, type ReactNode } from "react";
import { fetchAllAssets } from "@/pages/shared/assets";
import { normalizeDepartmentList } from "@/pages/shared/departments";
import { assetPurchaseDateText, effectiveFinancialResidualValue } from "@/pages/shared/finance";
import { STATUS_OPTIONS } from "@/pages/shared/options";
import {
  assetTypeLabel,
  formatDate,
  formatDateInput,
  formatMoney,
  parseDateValue,
  statusLabel,
} from "@/pages/shared/presentation";
import { csvCell, downloadCsvFile } from "@/pages/shared/tabular";

const { Text, Title } = Typography;

const DetailDrawer = lazy(() => import("@/pages/assets/DetailDrawer").then((module) => ({ default: module.DetailDrawer })));

export const AnalysisWorkspace = () => {
  const [analysisNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<AnalysisTabKey>("summary");
  const [hardwareAnalysisView, setHardwareAnalysisView] = useState<HardwareAnalysisView>("inventory");
  const [dataHealthView, setDataHealthView] = useState<DataHealthView>("collection");
  const [assetPlanningView, setAssetPlanningView] = useState<AssetPlanningView>("value");
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [selectedType, setSelectedType] = useState<string>();
  const [selectedChangeType, setSelectedChangeType] = useState<string>();
  const [selectedRenewalUuids, setSelectedRenewalUuids] = useState<Set<string>>(new Set());
  const [hardwareInventoryKey, setHardwareInventoryKey] = useState<HardwareInventoryKey>("cpu");
  const [hardwareInventorySearch, setHardwareInventorySearch] = useState("");
  const [hardwareQuery, setHardwareQuery] = useState<HardwareQueryState>(createEmptyHardwareQuery);
  const [drillDown, setDrillDown] = useState<{ title: string; assets: Asset[] } | null>(null);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [detailAssets, setDetailAssets] = useState<Asset[]>([]);
  const analysisViewKey: AnalysisViewKey = activeTab === "hardware"
    ? hardwareAnalysisView
    : activeTab === "health"
      ? dataHealthView
      : activeTab === "planning"
        ? assetPlanningView
        : "summary";
  const assetsQuery = useQuery(
    ["v3-analysis-assets"],
    () => fetchAllAssets({ assetScope: "all" }),
    { staleTime: 60_000 }
  );
  const trendsQuery = useQuery(["v3-analysis-collection-trends"], getCollectionTrends, { staleTime: 60_000 });
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const observationsQuery = useQuery(["v3-analysis-observations"], ({ signal }) => fetchComparisonObservations(signal), {
    enabled: analysisViewKey === "changes",
    staleTime: 60_000,
  });
  const allAssets = useMemo(
    () => (assetsQuery.data || []).filter((asset) => asset.status !== "deleted"),
    [assetsQuery.data]
  );
  const assets = useMemo(() => allAssets.filter((asset) => asset.assetType === "computer"), [allAssets]);
  const hardwareInventoryRows = useMemo(
    () => buildHardwareInventoryRows(assets, hardwareInventoryKey),
    [assets, hardwareInventoryKey]
  );
  const visibleHardwareInventoryRows = useMemo(() => {
    const keyword = hardwareInventorySearch.trim().toLowerCase();
    if (!keyword) return hardwareInventoryRows;
    return hardwareInventoryRows.filter((row) => `${row.label} ${row.detail}`.toLowerCase().includes(keyword));
  }, [hardwareInventoryRows, hardwareInventorySearch]);
  const hardwareInventoryCollectedAssets = useMemo(
    () => new Set(hardwareInventoryRows.flatMap((row) => row.assets.map((asset) => asset.uuid))).size,
    [hardwareInventoryRows]
  );
  const hardwareInventoryComponents = hardwareInventoryRows.reduce((total, row) => total + row.componentCount, 0);
  const hardwareQueryItems = useMemo<HardwareQueryItem[]>(() => buildHardwareQueryItems(assets), [assets]);
  const matchedHardwareQueryItems = useMemo(
    () => filterHardwareQueryItems(hardwareQueryItems, hardwareQuery),
    [hardwareQuery, hardwareQueryItems]
  );
  const hardwareDepartmentOptions = useMemo(() => analysisDistribution(assets.map((asset) => asset.department || "未填写")).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [assets]);
  const hardwareGraphicsOptions = useMemo(() => analysisDistribution(hardwareQueryItems.map((item) => item.graphics).filter(Boolean)).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [hardwareQueryItems]);
  const hardwareCpuOptions = useMemo(() => analysisDistribution(hardwareQueryItems.map((item) => item.cpu).filter(Boolean)).map((row) => ({ label: `${row.label}（${row.value}）`, value: row.label })), [hardwareQueryItems]);
  const hardwareQueryConditions = [
    ...hardwareQuery.departments.map((value) => `部门：${value}`),
    ...hardwareQuery.statuses.map((value) => `状态：${statusLabel(value)}`),
    ...(hardwareQuery.ownerMode ? [`使用人：${hardwareQuery.ownerMode === "assigned" ? "已分配" : "未分配"}`] : []),
    ...(hardwareQuery.ownerKeyword.trim() ? [`使用人包含：${hardwareQuery.ownerKeyword.trim()}`] : []),
    ...hardwareQuery.graphicsTerms.map((value) => `显卡${hardwareQuery.graphicsMode === "exact" ? "等于" : "包含"}：${value}`),
    ...hardwareQuery.cpuTerms.map((value) => `CPU${hardwareQuery.cpuMode === "exact" ? "等于" : "包含"}：${value}`),
    ...(hardwareQuery.minMemoryGb ? [`内存 ≥ ${hardwareQuery.minMemoryGb} GB`] : []),
    ...(hardwareQuery.minDiskGb ? [`硬盘 ≥ ${hardwareQuery.minDiskGb} GB`] : []),
  ];
  const hardwareQueryTags: ReactNode[] = [
    ...hardwareQuery.departments.map((item) => <Tag key={`department:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, departments: value.departments.filter((entry) => entry !== item) }))}>部门：{item}</Tag>),
    ...hardwareQuery.statuses.map((item) => <Tag key={`status:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, statuses: value.statuses.filter((entry) => entry !== item) }))}>状态：{statusLabel(item)}</Tag>),
    ...(hardwareQuery.ownerMode ? [<Tag key="owner-mode" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, ownerMode: undefined }))}>使用人：{hardwareQuery.ownerMode === "assigned" ? "已分配" : "未分配"}</Tag>] : []),
    ...(hardwareQuery.ownerKeyword.trim() ? [<Tag key="owner-keyword" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, ownerKeyword: "" }))}>使用人包含：{hardwareQuery.ownerKeyword.trim()}</Tag>] : []),
    ...hardwareQuery.graphicsTerms.map((item) => <Tag key={`graphics:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, graphicsTerms: value.graphicsTerms.filter((entry) => entry !== item) }))}>显卡{hardwareQuery.graphicsMode === "exact" ? "等于" : "包含"}：{item}</Tag>),
    ...hardwareQuery.cpuTerms.map((item) => <Tag key={`cpu:${item}`} closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, cpuTerms: value.cpuTerms.filter((entry) => entry !== item) }))}>CPU{hardwareQuery.cpuMode === "exact" ? "等于" : "包含"}：{item}</Tag>),
    ...(hardwareQuery.minMemoryGb ? [<Tag key="min-memory" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, minMemoryGb: undefined }))}>内存 ≥ {hardwareQuery.minMemoryGb} GB</Tag>] : []),
    ...(hardwareQuery.minDiskGb ? [<Tag key="min-disk" closable color="blue" onClose={() => setHardwareQuery((value) => ({ ...value, minDiskGb: undefined }))}>硬盘 ≥ {hardwareQuery.minDiskGb} GB</Tag>] : []),
  ];
  const issues = useMemo(() => detectHardwareIssues(assets), [assets]);
  const groupOptions = useMemo(
    () =>
      Array.from(new Set(issues.map((issue) => issueGroup(issue.type))))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [issues]
  );
  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          issues
            .filter((issue) => !selectedGroup || issueGroup(issue.type) === selectedGroup)
            .map((issue) => issue.type)
        )
      )
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [issues, selectedGroup]
  );
  const visibleIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (!selectedGroup || issueGroup(issue.type) === selectedGroup) &&
          (!selectedType || issue.type === selectedType)
      ),
    [issues, selectedGroup, selectedType]
  );
  const connectedCount = assets.filter((asset) => Boolean(asset.latestObservation?.observedAt)).length;
  const duplicateRiskGroups = new Set(
    issues
      .filter((issue) => issueGroup(issue.type) === "重复风险")
      .map((issue) => issue.duplicateGroupKey)
      .filter(Boolean)
  ).size;
  const departmentRows = useMemo(() => analysisDistribution(allAssets.map((asset) => asset.department)), [allAssets]);
  const statusRows = useMemo(
    () => analysisDistribution(allAssets.map((asset) => STATUS_OPTIONS.find((item) => item.value === asset.status)?.label || asset.status)),
    [allAssets]
  );
  const platformRows = useMemo(
    () => analysisDistribution(assets.map((asset) => assetHardwareContext(asset).extracted.platform || "未采集"), "未采集"),
    [assets]
  );
  const issueGroupRows = useMemo(() => analysisDistribution(issues.map((issue) => issueGroup(issue.type))), [issues]);
  const totalPurchase = allAssets.reduce((total, asset) => total + Math.max(0, Number(asset.purchasePrice || 0)), 0);
  const totalResidual = allAssets.reduce((total, asset) => total + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)), 0);
  const valuedAssets = allAssets.filter((asset) => Number(asset.purchasePrice || 0) > 0 || effectiveFinancialResidualValue(asset, settingsQuery.data) > 0);
  const pendingFinancialRows = useMemo(() => allAssets
    .map((asset) => {
      const missing: string[] = [];
      if (Number(asset.purchasePrice || 0) <= 0) missing.push("采购价");
      if (Number(asset.secondHandMarketValue || 0) <= 0) missing.push("二手市场价");
      return { asset, missing };
    })
    .filter((row) => row.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN")), [allAssets]);
  const fullyValuedAssets = allAssets.filter((asset) => Number(asset.purchasePrice || 0) > 0 && effectiveFinancialResidualValue(asset, settingsQuery.data) > 0);
  const knownDepreciation = fullyValuedAssets.reduce(
    (total, asset) => total + Math.max(0, Number(asset.purchasePrice) - effectiveFinancialResidualValue(asset, settingsQuery.data)),
    0
  );
  const departmentValueRows = useMemo(() => {
    const totals = new Map<string, { count: number; value: number }>();
    allAssets.forEach((asset) => {
      const label = asset.department.trim() || "未填写";
      const current = totals.get(label) || { count: 0, value: 0 };
      totals.set(label, { count: current.count + 1, value: current.value + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)) });
    });
    return Array.from(totals, ([label, value]) => ({ label, value: value.value, meta: `${formatMoney(value.value)} · ${value.count} 条` }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [allAssets, settingsQuery.data]);
  const trend = trendsQuery.data?.collection || [];
  const trendMax = Math.max(...trend.map((item) => item.count), 1);
  const openDrillDown = (title: string, rows: Asset[]) => setDrillDown({ title, assets: rows });
  const openAnalysisAsset = (asset: Asset, candidates?: Asset[]) => {
    setDetailAssets(candidates?.length ? candidates : (drillDown?.assets.length ? drillDown.assets : assets));
    setDetailAsset(asset);
    setDrillDown(null);
  };
  const analysisAssetLink = (asset: Asset, candidates?: Asset[]) => (
    <Button type="link" className="npcink-v3-link" onClick={() => openAnalysisAsset(asset, candidates)}>
      {asset.assetNumber || asset.name || asset.uuid}
    </Button>
  );
  const detailAssetIndex = detailAsset ? detailAssets.findIndex((asset) => asset.uuid === detailAsset.uuid) : -1;
  const previousDetailAsset = detailAssetIndex > 0 ? detailAssets[detailAssetIndex - 1] : undefined;
  const nextDetailAsset = detailAssetIndex >= 0 && detailAssetIndex < detailAssets.length - 1 ? detailAssets[detailAssetIndex + 1] : undefined;
  const collectionRows = useMemo(
    () => assets.map((asset) => ({ asset, band: collectionAgeBand(asset, analysisNow), days: collectionAgeDays(asset, analysisNow) })),
    [analysisNow, assets]
  );
  const collectionBandRows = useMemo(
    () => Object.entries(COLLECTION_BAND_META).map(([key, meta]) => ({
      label: meta.label,
      value: collectionRows.filter((row) => row.band === key).length,
    })),
    [collectionRows]
  );
  const departmentCoverageRows = useMemo(() => {
    const groups = new Map<string, { total: number; connected: number }>();
    assets.forEach((asset) => {
      const label = asset.department.trim() || "未填写";
      const current = groups.get(label) || { total: 0, connected: 0 };
      groups.set(label, {
        total: current.total + 1,
        connected: current.connected + ((collectionAgeDays(asset, analysisNow) ?? Number.POSITIVE_INFINITY) <= 30 ? 1 : 0),
      });
    });
    return Array.from(groups, ([label, group]) => ({
      label,
      value: group.total ? Math.round((group.connected / group.total) * 100) : 0,
      meta: `${group.connected}/${group.total} · ${group.total ? Math.round((group.connected / group.total) * 100) : 0}%`,
    })).sort((a, b) => a.value - b.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [assets]);
  const completenessRows = useMemo<AssetCompletenessRow[]>(() => assets.map((asset) => {
    const context = assetHardwareContext(asset);
    const checks = [
      { label: "资产编号", complete: Boolean(asset.assetNumber.trim()) },
      { label: "资产名称", complete: Boolean(asset.name.trim()) },
      { label: "具体部门", complete: Boolean(asset.department.trim() && !["未分配", "默认"].includes(asset.department.trim())) },
      ...(asset.status === "active" ? [{ label: "责任人", complete: Boolean(asset.ownerName.trim()) }] : []),
      { label: "采集快照", complete: Boolean(asset.latestObservation?.observedAt) },
      { label: "CPU", complete: Boolean(context.extracted.cpu) },
      { label: "内存", complete: hardwareMemoryBytes(asset) > 0 },
      { label: "硬盘", complete: hardwareDiskBytes(asset) > 0 },
      { label: "采购价", complete: Number(asset.purchasePrice || 0) > 0 },
      { label: "账面净值", complete: effectiveFinancialResidualValue(asset, settingsQuery.data) > 0 },
    ];
    const missing = checks.filter((check) => !check.complete).map((check) => check.label);
    return { asset, missing, score: Math.round(((checks.length - missing.length) / checks.length) * 100) };
  }).sort((a, b) => a.score - b.score || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN")), [assets]);
  const completenessFieldRows = useMemo(() => {
    const fields = new Map<string, number>();
    completenessRows.forEach((row) => row.missing.forEach((field) => fields.set(field, (fields.get(field) || 0) + 1)));
    return Array.from(fields, ([label, missing]) => ({
      label,
      value: assets.length ? Math.round(((assets.length - missing) / assets.length) * 100) : 0,
      meta: `${assets.length - missing}/${assets.length} · 缺 ${missing}`,
    })).sort((a, b) => a.value - b.value || a.label.localeCompare(b.label, "zh-CN"));
  }, [assets.length, completenessRows]);
  const averageCompleteness = completenessRows.length
    ? Math.round(completenessRows.reduce((total, row) => total + row.score, 0) / completenessRows.length)
    : 0;
  const renewalSettings = settingsQuery.data || {
    renewalAgeYears: 5,
    renewalMinMemoryGb: 8,
    renewalMinDiskGb: 256,
    renewalMaxResidualRate: 20,
  };
  const renewalRows = useMemo<RenewalCandidateRow[]>(() => assets.map((asset) => {
    const reasons: string[] = [];
    const purchaseDate = parseDateValue(assetPurchaseDateText(asset));
    if (purchaseDate) {
      const years = (analysisNow - purchaseDate.getTime()) / (365.25 * 86400000);
      if (years >= renewalSettings.renewalAgeYears) reasons.push(`购置约 ${years.toFixed(1)} 年`);
    }
    const memoryGb = hardwareMemoryBytes(asset) / (1024 ** 3);
    if (memoryGb > 0 && memoryGb < renewalSettings.renewalMinMemoryGb) reasons.push(`内存 ${Number(memoryGb.toFixed(1))} GB`);
    const diskGb = hardwareDiskBytes(asset) / (1024 ** 3);
    if (diskGb > 0 && diskGb < renewalSettings.renewalMinDiskGb * 0.92) reasons.push(`硬盘 ${Number(diskGb.toFixed(0))} GB`);
    if (asset.status === "maintenance") reasons.push("当前处于维护状态");
    const effectiveResidual = effectiveFinancialResidualValue(asset, settingsQuery.data);
    if (asset.purchasePrice > 0 && effectiveResidual > 0) {
      const residualRate = (effectiveResidual / asset.purchasePrice) * 100;
      if (residualRate <= renewalSettings.renewalMaxResidualRate) reasons.push(`账面净值率 ${Math.round(residualRate)}%`);
    }
    return { asset, reasons };
  }).filter((row) => row.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length), [analysisNow, assets, renewalSettings.renewalAgeYears, renewalSettings.renewalMaxResidualRate, renewalSettings.renewalMinDiskGb, renewalSettings.renewalMinMemoryGb]);
  const hardwareChangeRows = useMemo<HardwareChangeRow[]>(() => {
    const observationsByAsset = new Map<number, ComparisonObservation[]>();
    (observationsQuery.data || []).forEach((observation) => {
      observationsByAsset.set(observation.assetId, [...(observationsByAsset.get(observation.assetId) || []), observation]);
    });
    const changes: HardwareChangeRow[] = [];
    assets.forEach((asset) => {
      const observations = (observationsByAsset.get(asset.id) || [])
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id - a.id)
        .slice(0, 2);
      if (observations.length < 2) return;
      const latest = observationComparableFields(observations[0]);
      const previous = observationComparableFields(observations[1]);
      Object.entries(latest).forEach(([field, after]) => {
        const before = previous[field as keyof typeof previous];
        if (!before || !after || before.trim().toLowerCase() === after.trim().toLowerCase()) return;
        changes.push({
          key: `${asset.uuid}:${field}`,
          asset,
          field,
          before,
          after,
          observedAt: observations[0].observedAt,
        });
      });
    });
    return changes.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.asset.assetNumber.localeCompare(b.asset.assetNumber, "zh-CN"));
  }, [assets, observationsQuery.data]);
  const visibleHardwareChanges = selectedChangeType
    ? hardwareChangeRows.filter((row) => row.field === selectedChangeType)
    : hardwareChangeRows;
  const hardwareChangeTypes = Array.from(new Set(hardwareChangeRows.map((row) => row.field))).map((value) => ({ label: value, value }));
  const selectedRenewalRows = renewalRows.filter((row) => selectedRenewalUuids.has(row.asset.uuid));
  const selectedRenewalPurchase = selectedRenewalRows.reduce((total, row) => total + Math.max(0, row.asset.purchasePrice || 0), 0);
  const selectedRenewalResidual = selectedRenewalRows.reduce((total, row) => total + Math.max(0, effectiveFinancialResidualValue(row.asset, settingsQuery.data)), 0);
  const renewalDepartmentPlanRows = useMemo(() => {
    const groups = new Map<string, { count: number; purchase: number; residual: number }>();
    selectedRenewalRows.forEach(({ asset }) => {
      const label = asset.department.trim() || "未填写";
      const current = groups.get(label) || { count: 0, purchase: 0, residual: 0 };
      groups.set(label, {
        count: current.count + 1,
        purchase: current.purchase + Math.max(0, asset.purchasePrice || 0),
        residual: current.residual + Math.max(0, effectiveFinancialResidualValue(asset, settingsQuery.data)),
      });
    });
    return Array.from(groups, ([label, value]) => ({
      label,
      value: value.purchase,
      meta: `${value.count} 台 · 历史采购 ${formatMoney(value.purchase)} · 账面净值 ${formatMoney(value.residual)}`,
    })).sort((a, b) => b.value - a.value);
  }, [selectedRenewalRows]);
  const exportRenewalPlan = () => {
    const rows = [["资产编号", "资产名称", "部门", "状态", "候选依据", "历史采购价", "账面净值（估算）", "累计折旧（估算）"], ...selectedRenewalRows.map((row) => {
      const residual = effectiveFinancialResidualValue(row.asset, settingsQuery.data);
      return [row.asset.assetNumber, row.asset.name, row.asset.department, statusLabel(row.asset.status), row.reasons.join("、"), String(row.asset.purchasePrice || 0), String(residual), String(Math.max(0, (row.asset.purchasePrice || 0) - residual))];
    })];
    downloadCsvFile(`设备更新计划草案-${formatDateInput(new Date().toISOString())}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  };
  const exportAnalysisCsv = () => {
    let filename = `设备分析-${analysisViewKey}-${formatDateInput(new Date().toISOString())}.csv`;
    let rows: string[][];
    if (analysisViewKey === "query") {
      rows = [["使用人", "部门", "资产编号", "资产名称", "显卡", "CPU", "内存GB", "硬盘GB", "状态", "最后采集"], ...matchedHardwareQueryItems.map((item) => [item.asset.ownerName, item.asset.department, item.asset.assetNumber, item.asset.name, item.graphics, item.cpu, item.memoryGb ? String(Number(item.memoryGb.toFixed(1))) : "", item.diskGb ? String(Number(item.diskGb.toFixed(1))) : "", statusLabel(item.asset.status), item.asset.latestObservation?.observedAt || ""])];
    } else if (analysisViewKey === "inventory") {
      const category = HARDWARE_INVENTORY_OPTIONS.find((item) => item.key === hardwareInventoryKey)?.label || "硬件";
      rows = [["分类", "型号或容量", "补充信息", "部件数量", "设备数量", "设备占比"], ...visibleHardwareInventoryRows.map((row) => [category, row.label, row.detail, String(row.componentCount), String(row.assetCount), `${row.percent.toFixed(1)}%`])];
      filename = `设备分析-硬件盘点-${category}-${formatDateInput(new Date().toISOString())}.csv`;
    } else if (analysisViewKey === "collection") {
      rows = [["资产编号", "资产名称", "部门", "采集状态", "距今天数", "最后采集"], ...collectionRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, COLLECTION_BAND_META[row.band].label, row.days === null ? "" : String(row.days), row.asset.latestObservation?.observedAt || ""])];
    } else if (analysisViewKey === "quality") {
      rows = [["资产编号", "资产名称", "部门", "完整度", "缺失项目"], ...completenessRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, `${row.score}%`, row.missing.join("、")])];
    } else if (analysisViewKey === "changes") {
      rows = [["资产编号", "资产名称", "部门", "变化字段", "变化前", "变化后", "采集时间"], ...visibleHardwareChanges.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, row.field, row.before, row.after, row.observedAt])];
    } else if (analysisViewKey === "renewal") {
      rows = [["资产编号", "资产名称", "部门", "状态", "候选依据", "采购价", "账面净值（估算）"], ...renewalRows.map((row) => [row.asset.assetNumber, row.asset.name, row.asset.department, statusLabel(row.asset.status), row.reasons.join("、"), String(row.asset.purchasePrice || 0), String(effectiveFinancialResidualValue(row.asset, settingsQuery.data))])];
    } else if (analysisViewKey === "value") {
      rows = [["资产编号", "资产名称", "类型", "部门", "采购价", "二手市场价", "账面净值（估算）"], ...allAssets.map((asset) => [asset.assetNumber, asset.name, assetTypeLabel(asset.assetType), asset.department, String(asset.purchasePrice || 0), String(asset.secondHandMarketValue || 0), String(effectiveFinancialResidualValue(asset, settingsQuery.data))])];
    } else {
      rows = [["资产编号", "资产名称", "类型", "部门", "状态", "最后采集"], ...allAssets.map((asset) => [asset.assetNumber, asset.name, assetTypeLabel(asset.assetType), asset.department, statusLabel(asset.status), asset.latestObservation?.observedAt || ""])];
      filename = `设备分析-管理摘要-${formatDateInput(new Date().toISOString())}.csv`;
    }
    downloadCsvFile(filename, rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  };

  return (
    <div className="npcink-v3-analysis-workspace">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>分析概览</Title>
          <Text type="secondary">
            只读统计当前资产与采集快照，不写回问题状态，也不在分析页修改资产。
          </Text>
        </div>
        <Button onClick={exportAnalysisCsv}>导出当前分析</Button>
      </div>
      {assetsQuery.isError ? (
        <Alert type="error" showIcon message="分析数据加载失败" description="请刷新页面后重试。" />
      ) : null}
      <div className="npcink-v3-simple-kpis" aria-label="电脑资产概览">
        {[
          { label: "电脑总数", value: assets.length },
          { label: "已接入采集", value: connectedCount },
          { label: "待处理问题", value: issues.length },
          { label: "重复风险组", value: duplicateRiskGroups },
        ].map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{assetsQuery.isLoading || assetsQuery.isError ? "-" : item.value}</strong>
          </div>
        ))}
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as AnalysisTabKey)}
        items={[
          { key: "summary", label: "概览" },
          { key: "hardware", label: "硬件分析" },
          { key: "health", label: "数据健康" },
          { key: "planning", label: "资产规划" },
        ]}
        className="npcink-v3-analysis-tabs"
      />
      {activeTab !== "summary" ? (
        <div className="npcink-v3-analysis-subnav">
          {activeTab === "hardware" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={hardwareAnalysisView}
              onChange={(event) => setHardwareAnalysisView(event.target.value)}
              options={[{ label: "型号盘点", value: "inventory" }, { label: "组合筛选", value: "query" }]}
            />
          ) : null}
          {activeTab === "health" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={dataHealthView}
              onChange={(event) => setDataHealthView(event.target.value)}
              options={[{ label: "采集状态", value: "collection" }, { label: "资料完整度", value: "quality" }, { label: "硬件变化", value: "changes" }]}
            />
          ) : null}
          {activeTab === "planning" ? (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={assetPlanningView}
              onChange={(event) => setAssetPlanningView(event.target.value)}
              options={[{ label: "价值概览", value: "value" }, { label: "更新候选", value: "renewal" }]}
            />
          ) : null}
        </div>
      ) : null}
      {analysisViewKey === "summary" ? (
        <div className="npcink-v3-analysis-grid">
          <section className="npcink-v3-analysis-panel is-wide">
            <div className="npcink-v3-analysis-panel-head">
              <div><Title level={4}>近 30 天采集趋势</Title><Text type="secondary">按客户端采集时间统计接收快照数量。</Text></div>
              <strong>{trend.reduce((total, item) => total + item.count, 0)} 次</strong>
            </div>
            {trendsQuery.isError ? <Alert type="error" showIcon message="采集趋势加载失败" /> : (
              <div className="npcink-v3-analysis-trend" aria-label="近 30 天采集数量">
                {trend.map((item, index) => (
                  <div key={item.date} title={`${item.date}：${item.count} 次`}>
                    <i style={{ height: `${Math.max((item.count / trendMax) * 100, item.count ? 6 : 1)}%` }} />
                    {(index === 0 || index === trend.length - 1 || index % 7 === 0) ? <span>{item.date.slice(5)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="npcink-v3-analysis-panel"><Title level={4}>全部资产部门分布</Title><Text type="secondary">统计 {allAssets.length} 条未归档电脑和自定义资产。</Text><AnalysisDistribution rows={departmentRows.slice(0, 8)} onSelect={(row) => openDrillDown(`${row.label}资产`, allAssets.filter((asset) => (asset.department.trim() || "未填写") === row.label))} /></section>
          <section className="npcink-v3-analysis-panel"><Title level={4}>全部资产状态</Title><Text type="secondary">与左侧部门分布使用相同口径。</Text><AnalysisDistribution rows={statusRows} onSelect={(row) => openDrillDown(`${row.label}资产`, allAssets.filter((asset) => (STATUS_OPTIONS.find((item) => item.value === asset.status)?.label || asset.status) === row.label))} /></section>
        </div>
      ) : null}
      {analysisViewKey === "inventory" ? (
        <HardwareInventoryView
          assetsCount={assets.length}
          collectedAssets={hardwareInventoryCollectedAssets}
          componentCount={hardwareInventoryComponents}
          rows={hardwareInventoryRows}
          visibleRows={visibleHardwareInventoryRows}
          inventoryKey={hardwareInventoryKey}
          search={hardwareInventorySearch}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          onSearchChange={setHardwareInventorySearch}
          onInventoryKeyChange={(value) => {
            setHardwareInventoryKey(value);
            setHardwareInventorySearch("");
          }}
          onOpenDrillDown={openDrillDown}
        />
      ) : null}
      {analysisViewKey === "query" ? (
        <HardwareQueryView
          assetsCount={assets.length}
          query={hardwareQuery}
          matchedItems={matchedHardwareQueryItems}
          departmentOptions={hardwareDepartmentOptions}
          graphicsOptions={hardwareGraphicsOptions}
          cpuOptions={hardwareCpuOptions}
          conditions={hardwareQueryConditions}
          tags={hardwareQueryTags}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          onQueryChange={(updater) => setHardwareQuery(updater)}
          onReset={() => setHardwareQuery(createEmptyHardwareQuery())}
          onOpenDrillDown={openDrillDown}
          onOpenAsset={openAnalysisAsset}
          assetLink={analysisAssetLink}
          statusLabel={statusLabel}
          formatDate={formatDate}
        />
      ) : null}
      {analysisViewKey === "collection" ? (
        <CollectionHealthView
          collectionRows={collectionRows}
          collectionBandRows={collectionBandRows}
          departmentCoverageRows={departmentCoverageRows}
          assets={assets}
          assetLink={analysisAssetLink}
          formatDate={formatDate}
          onOpenDrillDown={openDrillDown}
        />
      ) : null}
      {analysisViewKey === "quality" ? (
        <DataQualityView
          averageCompleteness={averageCompleteness}
          completenessRows={completenessRows}
          completenessFieldRows={completenessFieldRows}
          pendingFinancialRows={pendingFinancialRows}
          platformRows={platformRows}
          issueGroupRows={issueGroupRows}
          visibleIssues={visibleIssues}
          groupOptions={groupOptions}
          typeOptions={typeOptions}
          selectedGroup={selectedGroup}
          selectedType={selectedType}
          assetsError={Boolean(assetsQuery.isError)}
          loading={assetsQuery.isLoading || assetsQuery.isFetching}
          assetLink={analysisAssetLink}
          formatMoney={formatMoney}
          onOpenDrillDown={openDrillDown}
          onGroupChange={(value) => {
            setSelectedGroup(value);
            setSelectedType(undefined);
          }}
          onTypeChange={setSelectedType}
        />
      ) : null}
      {analysisViewKey === "changes" ? (
        <HardwareChangesView
          rows={visibleHardwareChanges}
          types={hardwareChangeTypes}
          selectedType={selectedChangeType}
          loading={observationsQuery.isLoading || observationsQuery.isFetching}
          error={Boolean(observationsQuery.isError)}
          assetLink={analysisAssetLink}
          formatDate={formatDate}
          onTypeChange={setSelectedChangeType}
        />
      ) : null}
      {analysisViewKey === "renewal" ? (
        <RenewalView
          rows={renewalRows}
          selectedRows={selectedRenewalRows}
          selectedPurchase={selectedRenewalPurchase}
          selectedResidual={selectedRenewalResidual}
          departmentRows={renewalDepartmentPlanRows}
          settings={renewalSettings}
          loading={settingsQuery.isLoading}
          assetLink={analysisAssetLink}
          formatMoney={formatMoney}
          statusLabel={statusLabel}
          onSelectionChange={(keys) => setSelectedRenewalUuids(new Set(keys.map(String)))}
          onClear={() => setSelectedRenewalUuids(new Set())}
          onExport={exportRenewalPlan}
        />
      ) : null}
      {analysisViewKey === "value" ? (
        <ValueOverviewView totalPurchase={totalPurchase} totalResidual={totalResidual} knownDepreciation={knownDepreciation} valuedCount={valuedAssets.length} totalCount={allAssets.length} departmentRows={departmentValueRows} formatMoney={formatMoney} />
      ) : null}
      <Modal
        title={drillDown?.title || "分析下钻"}
        open={Boolean(drillDown)}
        onCancel={() => setDrillDown(null)}
        footer={null}
        width="min(900px, calc(100vw - 40px))"
        destroyOnClose
      >
        <Table
          rowKey="uuid"
          size="middle"
          dataSource={drillDown?.assets || []}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            { title: "资产", render: (_, asset) => analysisAssetLink(asset) },
            { title: "名称", dataIndex: "name" },
            { title: "部门", dataIndex: "department", width: 140 },
            { title: "状态", dataIndex: "status", width: 100, render: statusLabel },
            { title: "最后采集", width: 180, render: (_, asset) => formatDate(asset.latestObservation?.observedAt) },
          ]}
        />
      </Modal>
      <DeferredPanel open={Boolean(detailAsset)}>
      <DetailDrawer
        uuid={detailAsset?.uuid || null}
        open={Boolean(detailAsset)}
        initialAsset={detailAsset}
        departmentOptions={normalizeDepartmentList(settingsQuery.data?.departments || [])}
        readOnly
        previousAsset={previousDetailAsset}
        nextAsset={nextDetailAsset}
        navigationLabel={detailAssetIndex >= 0 ? `当前筛选结果第 ${detailAssetIndex + 1} / ${detailAssets.length} 台` : undefined}
        onNavigate={setDetailAsset}
        onClose={() => setDetailAsset(null)}
        onArchive={() => undefined}
      />
      </DeferredPanel>
    </div>
  );
};

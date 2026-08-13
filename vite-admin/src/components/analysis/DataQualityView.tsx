import { Empty, Select, Space, Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import type { HardwareIssue } from "@/utils/hardwareAudit";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";
import type { AssetCompletenessRow } from "./analysisTypes";

const { Text, Title } = Typography;

export interface DataQualityViewProps {
  averageCompleteness: number;
  completenessRows: AssetCompletenessRow[];
  completenessFieldRows: AnalysisDistributionRow[];
  pendingFinancialRows: Array<{ asset: Asset; missing: string[] }>;
  platformRows: AnalysisDistributionRow[];
  issueGroupRows: AnalysisDistributionRow[];
  visibleIssues: HardwareIssue[];
  groupOptions: Array<{ label: string; value: string }>;
  typeOptions: Array<{ label: string; value: string }>;
  selectedGroup?: string;
  selectedType?: string;
  assetsError: boolean;
  loading: boolean;
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  formatMoney: (value: number) => string;
  onOpenDrillDown: (title: string, assets: Asset[]) => void;
  onGroupChange: (value?: string) => void;
  onTypeChange: (value?: string) => void;
}

const ISSUE_LEVEL_META = { error: { label: "高", color: "red" }, warning: { label: "中", color: "orange" }, info: { label: "低", color: "blue" } } as const;

export const DataQualityView = ({ averageCompleteness, completenessRows, completenessFieldRows, pendingFinancialRows, platformRows, issueGroupRows, visibleIssues, groupOptions, typeOptions, selectedGroup, selectedType, assetsError, loading, assetLink, formatMoney, onOpenDrillDown, onGroupChange, onTypeChange }: DataQualityViewProps) => (
  <>
    <div className="npcink-v3-analysis-grid">
      <section className="npcink-v3-analysis-panel"><Title level={4}>平均完整度</Title><div className="npcink-v3-analysis-score">{averageCompleteness}%</div><Text type="secondary">按基础资料、采集硬件和金额字段计算。</Text></section>
      <section className="npcink-v3-analysis-panel"><Title level={4}>字段覆盖率</Title><AnalysisDistribution rows={completenessFieldRows} onSelect={(row) => onOpenDrillDown(`缺少${row.label}`, completenessRows.filter((item) => item.missing.includes(row.label)).map((item) => item.asset))} /></section>
      <section className="npcink-v3-analysis-panel is-wide"><Title level={4}>资料待补设备</Title><Table<AssetCompletenessRow> rowKey={(row) => row.asset.uuid} size="middle" dataSource={completenessRows.filter((row) => row.missing.length)} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }} columns={[{ title: "资产", render: (_value, row) => assetLink(row.asset) }, { title: "部门", render: (_value, row) => row.asset.department || "-", width: 150 }, { title: "完整度", dataIndex: "score", width: 110, render: (score) => <Tag color={score >= 80 ? "green" : score >= 60 ? "orange" : "red"}>{score}%</Tag> }, { title: "缺失项目", render: (_value, row) => row.missing.join("、") }]} locale={{ emptyText: <Empty description="资料完整" /> }} /></section>
      <section className="npcink-v3-analysis-panel is-wide"><div className="npcink-v3-analysis-panel-head"><div><Title level={4}>财务资料待补充</Title><Text type="secondary">列出采购价或二手市场价未填写的未归档资产，点击编号可查看详情。</Text></div><strong>{pendingFinancialRows.length} 条</strong></div><Table rowKey={(row) => row.asset.uuid} size="middle" dataSource={pendingFinancialRows} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }} columns={[{ title: "资产编号", width: 150, render: (_value, row) => assetLink(row.asset, pendingFinancialRows.map((item) => item.asset)) }, { title: "使用人", width: 120, render: (_value, row) => row.asset.ownerName || <Text type="secondary">未分配</Text> }, { title: "部门", width: 140, render: (_value, row) => row.asset.department || "-" }, { title: "采购价", width: 130, render: (_value, row) => Number(row.asset.purchasePrice || 0) > 0 ? formatMoney(row.asset.purchasePrice) : <Tag color="red">未填写</Tag> }, { title: "二手市场价", width: 140, render: (_value, row) => Number(row.asset.secondHandMarketValue || 0) > 0 ? formatMoney(row.asset.secondHandMarketValue) : <Tag color="orange">未填写</Tag> }, { title: "待补字段", render: (_value, row) => row.missing.map((field) => <Tag key={field} color={field === "采购价" ? "red" : "orange"}>{field}</Tag>) }]} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="采购价和二手市场价均已填写" /> }} /></section>
    </div>
    <div className="npcink-v3-analysis-grid"><section className="npcink-v3-analysis-panel"><Title level={4}>操作系统分布</Title><AnalysisDistribution rows={platformRows} /></section><section className="npcink-v3-analysis-panel"><Title level={4}>问题分组</Title><AnalysisDistribution rows={issueGroupRows} emptyText="暂无硬件问题" /></section></div>
    <div className="npcink-v3-analysis-issues"><div className="npcink-v3-analysis-issues-head"><div><Title level={4}>问题清单</Title><Text type="secondary">共 {assetsError ? "-" : visibleIssues.length} 条，只读展示，不在分析页执行修复。</Text></div><Space wrap><Select allowClear placeholder="问题分组" aria-label="按问题分组筛选" options={groupOptions} value={selectedGroup} disabled={assetsError} onChange={onGroupChange} className="npcink-v3-filter" /><Select allowClear placeholder="问题类型" aria-label="按问题类型筛选" options={typeOptions} value={selectedType} disabled={assetsError} onChange={onTypeChange} className="npcink-v3-filter" /></Space></div><Table<HardwareIssue> rowKey="key" size="middle" loading={loading} dataSource={assetsError ? [] : visibleIssues} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }} columns={[{ title: "级别", dataIndex: "level", width: 88, render: (level: HardwareIssue["level"]) => <Tag color={ISSUE_LEVEL_META[level].color}>{ISSUE_LEVEL_META[level].label}</Tag> }, { title: "类型", dataIndex: "type", width: 150 }, { title: "资产", width: 220, render: (_value, issue) => <Space direction="vertical" size={0}><Text strong>{issue.asset.assetNumber || issue.asset.name || issue.asset.uuid}</Text>{issue.asset.assetNumber && issue.asset.name ? <Text type="secondary">{issue.asset.name}</Text> : null}</Space> }, { title: "说明", dataIndex: "message" }]} scroll={{ x: 760 }} locale={{ emptyText: <Empty description={assetsError ? "分析数据加载失败" : "暂无异常发现"} /> }} /></div>
  </>
);

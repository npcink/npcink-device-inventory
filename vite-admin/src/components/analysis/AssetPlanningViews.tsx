import { Button, Space, Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";
import type { RenewalCandidateRow } from "./analysisTypes";

const { Text, Title } = Typography;

export interface RenewalViewProps {
  rows: RenewalCandidateRow[];
  selectedRows: RenewalCandidateRow[];
  selectedPurchase: number;
  selectedResidual: number;
  departmentRows: AnalysisDistributionRow[];
  settings: { renewalAgeYears: number; renewalMinMemoryGb: number; renewalMinDiskGb: number; renewalMaxResidualRate: number };
  loading: boolean;
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  formatMoney: (value: number) => string;
  statusLabel: (value: string) => string;
  onSelectionChange: (keys: React.Key[]) => void;
  onClear: () => void;
  onExport: () => void;
}

export const RenewalView = ({ rows, selectedRows, selectedPurchase, selectedResidual, departmentRows, settings, loading, assetLink, formatMoney, statusLabel, onSelectionChange, onClear, onExport }: RenewalViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel is-wide"><div className="npcink-v3-analysis-panel-head"><div><Title level={4}>设备更新候选</Title><Text type="secondary">仅依据设置阈值列出候选，不代表必须淘汰。</Text></div><strong>{rows.length} 台</strong></div><div className="npcink-v3-threshold-summary"><span>年限 ≥ {settings.renewalAgeYears} 年</span><span>内存 &lt; {settings.renewalMinMemoryGb} GB</span><span>硬盘 &lt; {settings.renewalMinDiskGb} GB</span><span>账面净值率 ≤ {settings.renewalMaxResidualRate}%</span></div></section>
    <section className="npcink-v3-analysis-panel is-wide"><Table<RenewalCandidateRow> rowKey={(row) => row.asset.uuid} size="middle" loading={loading} dataSource={rows} rowSelection={{ selectedRowKeys: selectedRows.map((row) => row.asset.uuid), onChange: onSelectionChange }} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 台候选` }} columns={[{ title: "资产", render: (_value, row) => assetLink(row.asset) }, { title: "部门", render: (_value, row) => row.asset.department || "-", width: 150 }, { title: "状态", render: (_value, row) => statusLabel(row.asset.status), width: 100 }, { title: "候选依据", render: (_value, row) => row.reasons.map((reason) => <Tag key={reason} color="orange">{reason}</Tag>) }]} locale={{ emptyText: <span>暂无符合阈值的更新候选</span> }} /></section>
    <section className="npcink-v3-analysis-panel is-wide"><div className="npcink-v3-analysis-panel-head"><div><Title level={4}>更新计划草案</Title><Text type="secondary">勾选候选设备后按部门汇总；金额来自现有资产事实，不是未来采购报价。</Text></div><Space><Button disabled={!selectedRows.length} onClick={onClear}>清空选择</Button><Button type="primary" disabled={!selectedRows.length} onClick={onExport}>导出计划草案</Button></Space></div><div className="npcink-v3-value-kpis npcink-v3-renewal-plan-kpis"><div><span>已选设备</span><strong>{selectedRows.length} 台</strong></div><div><span>历史采购价</span><strong>{formatMoney(selectedPurchase)}</strong></div><div><span>账面净值（估算）</span><strong>{formatMoney(selectedResidual)}</strong></div><div><span>累计折旧（估算）</span><strong>{formatMoney(Math.max(0, selectedPurchase - selectedResidual))}</strong><small>历史采购价 - 账面净值</small></div></div><AnalysisDistribution rows={departmentRows} emptyText="请先勾选更新候选设备" /></section>
  </div>
);

export interface ValueOverviewViewProps {
  totalPurchase: number;
  totalResidual: number;
  knownDepreciation: number;
  valuedCount: number;
  totalCount: number;
  departmentRows: AnalysisDistributionRow[];
  formatMoney: (value: number) => string;
}

export const ValueOverviewView = ({ totalPurchase, totalResidual, knownDepreciation, valuedCount, totalCount, departmentRows, formatMoney }: ValueOverviewViewProps) => (
  <div className="npcink-v3-analysis-grid"><section className="npcink-v3-analysis-panel is-wide"><div className="npcink-v3-value-kpis"><div><span>采购价合计</span><strong>{formatMoney(totalPurchase)}</strong></div><div><span>账面净值合计</span><strong>{formatMoney(totalResidual)}</strong></div><div><span>已知折价</span><strong>{formatMoney(knownDepreciation)}</strong></div><div><span>估值覆盖</span><strong>{totalCount ? `${Math.round((valuedCount / totalCount) * 100)}%` : "-"}</strong><small>{valuedCount}/{totalCount} 条有金额</small></div></div></section><section className="npcink-v3-analysis-panel is-wide"><Title level={4}>全部资产部门账面净值分布</Title><Text type="secondary">汇总 {totalCount} 条未归档电脑和自定义资产的当前有效账面净值；自动模式使用实时估算值，手动模式使用已登记值。</Text><AnalysisDistribution rows={departmentRows} emptyText="暂无账面净值数据" /></section></div>
);

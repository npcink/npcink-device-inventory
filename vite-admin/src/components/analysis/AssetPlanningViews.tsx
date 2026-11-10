import { Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";
import type { RenewalCandidateRow } from "./analysisTypes";

const { Text, Title } = Typography;

export interface RenewalViewProps {
  rows: RenewalCandidateRow[];
  settings: { renewalAgeYears: number; renewalMinMemoryGb: number; renewalMinDiskGb: number; renewalMaxResidualRate: number };
  loading: boolean;
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  statusLabel: (value: string) => string;
}

export const RenewalView = ({ rows, settings, loading, assetLink, statusLabel }: RenewalViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel is-wide"><div className="npcink-v3-analysis-panel-head"><div><Title level={4}>设备更新候选</Title><Text type="secondary">仅依据设置阈值列出候选，不代表必须淘汰。</Text></div><strong>{rows.length} 台</strong></div><div className="npcink-v3-threshold-summary"><span>年限 ≥ {settings.renewalAgeYears} 年</span><span>内存 &lt; {settings.renewalMinMemoryGb} GB</span><span>硬盘 &lt; {settings.renewalMinDiskGb} GB</span><span>账面净值率 ≤ {settings.renewalMaxResidualRate}%</span></div></section>
    <section className="npcink-v3-analysis-panel is-wide"><Table<RenewalCandidateRow> rowKey={(row) => row.asset.uuid} size="middle" loading={loading} dataSource={rows} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 台候选` }} columns={[{ title: "资产", render: (_value, row) => assetLink(row.asset) }, { title: "部门", render: (_value, row) => row.asset.department || "-", width: 150 }, { title: "状态", render: (_value, row) => statusLabel(row.asset.status), width: 100 }, { title: "候选依据", render: (_value, row) => row.reasons.map((reason) => <Tag key={reason} color="orange">{reason}</Tag>) }]} locale={{ emptyText: <span>暂无符合阈值的更新候选</span> }} /></section>
  </div>
);

export interface ValueOverviewViewProps {
  totalPurchase: number;
  totalResidual: number | null;
  knownDepreciation: number | null;
  unknownResidualCount: number;
  totalCount: number;
  departmentRows: AnalysisDistributionRow[];
  formatMoney: (value: number) => string;
}

export const ValueOverviewView = ({ totalPurchase, totalResidual, knownDepreciation, unknownResidualCount, totalCount, departmentRows, formatMoney }: ValueOverviewViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel is-wide">
      <div className="npcink-v3-value-kpis">
        <div><span>采购价合计</span><strong>{formatMoney(totalPurchase)}</strong></div>
        <div><span>账面净值合计</span><strong>{totalResidual === null ? "暂无法确定" : formatMoney(totalResidual)}</strong></div>
        <div><span>已知折旧合计</span><strong>{knownDepreciation === null ? "暂无法确定" : formatMoney(knownDepreciation)}</strong></div>
      </div>
      {unknownResidualCount > 0 ? <Text type="secondary">{unknownResidualCount} 条资产净值暂无法确定，未计入净值和折旧合计。</Text> : null}
    </section>
    <section className="npcink-v3-analysis-panel is-wide">
      <Title level={4}>全部资产部门账面净值分布</Title>
      <Text type="secondary">在 {totalCount} 条未归档电脑和自定义资产中，按部门汇总可确定的净值；报废资产按零计入。</Text>
      <AnalysisDistribution rows={departmentRows} emptyText="暂无账面净值数据" />
    </section>
  </div>
);

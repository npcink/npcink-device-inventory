import { Empty, Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";
import { COLLECTION_BAND_META } from "./analysisTypes";

const { Text, Title } = Typography;

interface CollectionRow { asset: Asset; band: keyof typeof COLLECTION_BAND_META; days: number | null }

export interface CollectionHealthViewProps {
  collectionRows: CollectionRow[];
  collectionBandRows: AnalysisDistributionRow[];
  departmentCoverageRows: AnalysisDistributionRow[];
  assets: Asset[];
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  formatDate: (value?: string) => string;
  onOpenDrillDown: (title: string, assets: Asset[]) => void;
}

export const CollectionHealthView = ({ collectionRows, collectionBandRows, departmentCoverageRows, assets, assetLink, formatDate, onOpenDrillDown }: CollectionHealthViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel"><Title level={4}>采集新鲜度</Title><AnalysisDistribution rows={collectionBandRows} onSelect={(row) => onOpenDrillDown(row.label, collectionRows.filter((item) => COLLECTION_BAND_META[item.band].label === row.label).map((item) => item.asset))} /></section>
    <section className="npcink-v3-analysis-panel"><Title level={4}>部门 30 天采集覆盖率</Title><Text type="secondary">仅把最近 30 天内有采集的电脑计为新鲜覆盖。</Text><AnalysisDistribution rows={departmentCoverageRows} onSelect={(row) => onOpenDrillDown(`${row.label}电脑`, assets.filter((asset) => (asset.department.trim() || "未填写") === row.label))} /></section>
    <section className="npcink-v3-analysis-panel is-wide">
      <Title level={4}>采集待关注设备</Title>
      <Table<CollectionRow>
        rowKey={(row) => row.asset.uuid}
        size="middle"
        dataSource={collectionRows.filter((row) => !["fresh", "aging"].includes(row.band))}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        columns={[
          { title: "资产", render: (_value, row) => assetLink(row.asset) },
          { title: "部门", render: (_value, row) => row.asset.department || "-", width: 150 },
          { title: "采集状态", width: 140, render: (_value, row) => <Tag color={COLLECTION_BAND_META[row.band].color}>{COLLECTION_BAND_META[row.band].label}</Tag> },
          { title: "距今", width: 120, render: (_value, row) => row.days === null ? "从未采集" : `${row.days} 天` },
          { title: "最后采集", width: 180, render: (_value, row) => formatDate(row.asset.latestObservation?.observedAt) },
        ]}
        locale={{ emptyText: <Empty description="所有电脑最近 30 天内均有采集" /> }}
      />
    </section>
  </div>
);

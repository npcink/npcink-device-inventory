import { HelpLabel } from "@/components/HelpLabel";
import { Empty, Select, Space, Table, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import type { HardwareIssue } from "@/utils/hardwareAudit";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";
import type { AssetCompletenessRow } from "./analysisTypes";

const { Text, Title } = Typography;

export interface DataQualityViewProps {
  completenessRows: AssetCompletenessRow[];
  completenessFieldRows: AnalysisDistributionRow[];
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
  selectedMissingField?: string;
  onMissingFieldChange: (value?: string) => void;
  onGroupChange: (value?: string) => void;
  onTypeChange: (value?: string) => void;
}

const ISSUE_LEVEL_META = { error: { label: "高", color: "red" }, warning: { label: "中", color: "orange" }, info: { label: "低", color: "blue" } } as const;

export const DataQualityView = ({ completenessRows, completenessFieldRows, platformRows, issueGroupRows, visibleIssues, groupOptions, typeOptions, selectedGroup, selectedType, assetsError, loading, assetLink, selectedMissingField, onMissingFieldChange, onGroupChange, onTypeChange }: DataQualityViewProps) => (
  <>
    <div className="npcink-v3-analysis-grid">
      <section className="npcink-v3-analysis-panel is-wide">
        <Title level={4}><HelpLabel label="资料缺项" description="按实际缺失字段查找设备；金额不参与资料完整性判断。" /></Title>
        <AnalysisDistribution rows={completenessFieldRows} emptyText="暂无资料缺项"
          onSelect={(row) => onMissingFieldChange(row.label)} />
      </section>
      <section className="npcink-v3-analysis-panel is-wide">
        <div className="npcink-v3-analysis-panel-head">
          <Title level={4}>资料待补设备</Title>
          <Select allowClear placeholder="按缺失字段筛选" aria-label="按缺失字段筛选"
            value={selectedMissingField} onChange={onMissingFieldChange}
            options={completenessFieldRows.map((row) => ({ label: `${row.label}（${row.value} 台）`, value: row.label }))}
            className="npcink-v3-filter" />
        </div>
        <Table<AssetCompletenessRow> rowKey={(row) => row.asset.uuid} size="middle" loading={loading}
          dataSource={completenessRows} pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            { title: "资产", render: (_value, row) => assetLink(row.asset) },
            { title: "部门", render: (_value, row) => row.asset.department || "-", width: 150 },
            { title: "缺失项目", render: (_value, row) => row.missing.join("、") },
          ]}
          locale={{ emptyText: <Empty description="当前范围没有资料缺项" /> }} />
      </section>
    </div>
    <div className="npcink-v3-analysis-grid"><section className="npcink-v3-analysis-panel"><Title level={4}>操作系统分布</Title><AnalysisDistribution rows={platformRows} /></section><section className="npcink-v3-analysis-panel"><Title level={4}>问题分组</Title><AnalysisDistribution rows={issueGroupRows} emptyText="暂无硬件问题" /></section></div>
    <div className="npcink-v3-analysis-issues"><div className="npcink-v3-analysis-issues-head"><div><Title level={4}>问题清单</Title><Text type="secondary">共 {assetsError ? "-" : visibleIssues.length} 条，只读展示，不在分析页执行修复。</Text></div><Space wrap><Select allowClear placeholder="问题分组" aria-label="按问题分组筛选" options={groupOptions} value={selectedGroup} disabled={assetsError} onChange={onGroupChange} className="npcink-v3-filter" /><Select allowClear placeholder="问题类型" aria-label="按问题类型筛选" options={typeOptions} value={selectedType} disabled={assetsError} onChange={onTypeChange} className="npcink-v3-filter" /></Space></div><Table<HardwareIssue> rowKey="key" size="middle" loading={loading} dataSource={assetsError ? [] : visibleIssues} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }} columns={[{ title: "级别", dataIndex: "level", width: 88, render: (level: HardwareIssue["level"]) => <Tag color={ISSUE_LEVEL_META[level].color}>{ISSUE_LEVEL_META[level].label}</Tag> }, { title: "类型", dataIndex: "type", width: 150 }, { title: "资产", width: 220, render: (_value, issue) => <Space direction="vertical" size={0}><Text strong>{issue.asset.assetNumber || issue.asset.name || issue.asset.uuid}</Text>{issue.asset.assetNumber && issue.asset.name ? <Text type="secondary">{issue.asset.name}</Text> : null}</Space> }, { title: "说明", dataIndex: "message" }]} scroll={{ x: 760 }} locale={{ emptyText: <Empty description={assetsError ? "分析数据加载失败" : "暂无异常发现"} /> }} /></div>
  </>
);

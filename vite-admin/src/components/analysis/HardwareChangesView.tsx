import { Alert, Empty, Select, Table, Typography } from "antd";
import type { Asset } from "@/type/v3";
import type { HardwareChangeRow } from "./analysisTypes";
import type { ReactNode } from "react";

const { Text, Title } = Typography;

export interface HardwareChangesViewProps {
  rows: HardwareChangeRow[];
  types: Array<{ label: string; value: string }>;
  selectedType?: string;
  loading: boolean;
  error: boolean;
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  formatDate: (value?: string) => string;
  onTypeChange: (value?: string) => void;
}

export const HardwareChangesView = ({ rows, types, selectedType, loading, error, assetLink, formatDate, onTypeChange }: HardwareChangesViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel is-wide">
      <div className="npcink-v3-analysis-panel-head">
        <div><Title level={4}>最近两次有效采集变化</Title><Text type="secondary">仅当变化前后字段均存在时展示，缺失字段不视为硬件移除。</Text></div>
        <Select allowClear placeholder="变化类型" options={types} value={selectedType} onChange={onTypeChange} className="npcink-v3-filter" />
      </div>
    </section>
    <section className="npcink-v3-analysis-panel is-wide">
      {error ? <Alert type="error" showIcon message="历史采集加载失败" /> : null}
      <Table<HardwareChangeRow>
        rowKey="key"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 项变化` }}
        columns={[
          { title: "资产", width: 130, render: (_value, row) => assetLink(row.asset) },
          { title: "部门", width: 120, render: (_value, row) => row.asset.department || "-" },
          { title: "字段", dataIndex: "field", width: 120 },
          { title: "变化前", dataIndex: "before" },
          { title: "变化后", dataIndex: "after" },
          { title: "采集时间", dataIndex: "observedAt", width: 180, render: formatDate },
        ]}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description="最近两次采集未发现可确认的硬件变化" /> }}
      />
    </section>
  </div>
);

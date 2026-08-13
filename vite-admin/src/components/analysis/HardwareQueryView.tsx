import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Empty, Input, InputNumber, Radio, Select, Table, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import type { Asset } from "@/type/v3";
import type { HardwareQueryItem, HardwareQueryState } from "./analysisTypes";
import { AnalysisDistribution, type AnalysisDistributionRow } from "./AnalysisDistribution";

const { Text, Title } = Typography;

export interface HardwareQueryViewProps {
  assetsCount: number;
  query: HardwareQueryState;
  matchedItems: HardwareQueryItem[];
  departmentOptions: Array<{ label: string; value: string }>;
  graphicsOptions: Array<{ label: string; value: string }>;
  cpuOptions: Array<{ label: string; value: string }>;
  conditions: string[];
  tags: ReactNode[];
  loading: boolean;
  onQueryChange: (updater: (value: HardwareQueryState) => HardwareQueryState) => void;
  onReset: () => void;
  onOpenDrillDown: (title: string, assets: Asset[]) => void;
  onOpenAsset: (asset: Asset, candidates?: Asset[]) => void;
  assetLink: (asset: Asset, candidates?: Asset[]) => ReactNode;
  statusLabel: (value: string) => string;
  formatDate: (value?: string) => string;
}

export const HardwareQueryView = ({
  assetsCount,
  query,
  matchedItems,
  departmentOptions,
  graphicsOptions,
  cpuOptions,
  conditions,
  tags,
  loading,
  onQueryChange,
  onReset,
  onOpenDrillDown,
  onOpenAsset,
  assetLink,
  statusLabel,
  formatDate,
}: HardwareQueryViewProps) => {
  const matchedAssets = matchedItems.map((item) => item.asset);
  const departmentRows = Array.from(new Set(matchedItems.map((item) => item.asset.department || "未填写")))
    .map((label) => ({ label, value: matchedItems.filter((item) => (item.asset.department || "未填写") === label).length }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
  return (
    <div className="npcink-v3-analysis-grid">
      <section className="npcink-v3-analysis-panel is-wide">
        <div className="npcink-v3-analysis-panel-head">
          <div><Title level={4}>组合查询条件</Title><Text type="secondary">不同字段之间为 AND；部门、状态、显卡和 CPU 的多个值在字段内部为 OR。</Text></div>
          {conditions.length ? <Button onClick={onReset}>重置条件</Button> : null}
        </div>
        <div className="npcink-v3-hardware-query-controls">
          <div><Text type="secondary">部门</Text><Select mode="multiple" allowClear showSearch placeholder="选择部门" options={departmentOptions} value={query.departments} onChange={(departments) => onQueryChange((value) => ({ ...value, departments }))} filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())} /></div>
          <div><Text type="secondary">状态</Text><Select mode="multiple" allowClear placeholder="选择状态" options={[{ label: "在用", value: "active" }, { label: "闲置", value: "inactive" }, { label: "维护", value: "maintenance" }, { label: "报废", value: "retired" }]} value={query.statuses} onChange={(statuses) => onQueryChange((value) => ({ ...value, statuses }))} /></div>
          <div><Text type="secondary">使用人</Text><Select allowClear placeholder="全部使用人" options={[{ label: "已分配", value: "assigned" }, { label: "未分配", value: "unassigned" }]} value={query.ownerMode} onChange={(ownerMode) => onQueryChange((value) => ({ ...value, ownerMode }))} /></div>
          <div><div className="npcink-v3-query-label"><Text type="secondary">显卡</Text><Tooltip title="系列包含会忽略 NVIDIA、GeForce 等常见厂商词；精确型号要求规范化后的完整型号一致。"><QuestionCircleOutlined /></Tooltip></div><Select mode="tags" allowClear showSearch placeholder="例如：4060" options={graphicsOptions} value={query.graphicsTerms} onChange={(graphicsTerms) => onQueryChange((value) => ({ ...value, graphicsTerms }))} filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())} /><Radio.Group size="small" optionType="button" buttonStyle="solid" options={[{ label: "系列包含", value: "contains" }, { label: "精确型号", value: "exact" }]} value={query.graphicsMode} onChange={(event) => onQueryChange((value) => ({ ...value, graphicsMode: event.target.value }))} /></div>
          <div><div className="npcink-v3-query-label"><Text type="secondary">CPU</Text><Tooltip title="可输入多个 CPU 系列或型号；多个值之间按 OR 匹配。"><QuestionCircleOutlined /></Tooltip></div><Select mode="tags" allowClear showSearch placeholder="例如：i5-12400 或 Ryzen 7" options={cpuOptions} value={query.cpuTerms} onChange={(cpuTerms) => onQueryChange((value) => ({ ...value, cpuTerms }))} filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())} /><Radio.Group size="small" optionType="button" buttonStyle="solid" options={[{ label: "系列包含", value: "contains" }, { label: "精确型号", value: "exact" }]} value={query.cpuMode} onChange={(event) => onQueryChange((value) => ({ ...value, cpuMode: event.target.value }))} /></div>
          <div><Text type="secondary">使用人姓名</Text><Input allowClear placeholder="姓名包含关键词" value={query.ownerKeyword} onChange={(event) => onQueryChange((value) => ({ ...value, ownerKeyword: event.target.value }))} /></div>
          <div><Text type="secondary">最低内存</Text><InputNumber min={1} max={1024} placeholder="不限" addonAfter="GB" value={query.minMemoryGb} onChange={(value) => onQueryChange((queryValue) => ({ ...queryValue, minMemoryGb: value || undefined }))} /></div>
          <div><Text type="secondary">最低硬盘</Text><InputNumber min={1} max={16384} placeholder="不限" addonAfter="GB" value={query.minDiskGb} onChange={(value) => onQueryChange((queryValue) => ({ ...queryValue, minDiskGb: value || undefined }))} /></div>
        </div>
        {tags.length ? <div className="npcink-v3-query-conditions">{tags}</div> : null}
        <div className="npcink-v3-query-kpis">
          <div><span>筛选范围</span><strong>{assetsCount} 台</strong></div>
          <div><span>命中设备</span><strong>{matchedItems.length} 台</strong></div>
          <div><span>涉及人员</span><strong>{new Set(matchedItems.map((item) => item.asset.ownerName.trim()).filter(Boolean)).size} 人</strong></div>
          <div><span>涉及部门</span><strong>{new Set(matchedItems.map((item) => item.asset.department || "未填写")).size} 个</strong></div>
        </div>
      </section>
      <section className="npcink-v3-analysis-panel is-wide npcink-v3-query-distribution"><Title level={4}>命中部门分布</Title><AnalysisDistribution rows={departmentRows} onSelect={(row: AnalysisDistributionRow) => onOpenDrillDown(`${row.label}命中设备`, matchedItems.filter((item) => (item.asset.department || "未填写") === row.label).map((item) => item.asset))} emptyText="暂无命中部门" /></section>
      <section className="npcink-v3-analysis-panel is-wide">
        <div className="npcink-v3-analysis-panel-head"><div><Title level={4}>命中人员与设备</Title><Text type="secondary">点击资产编号可在当前分析页查看只读详情。</Text></div><Text type="secondary">共 {matchedItems.length} 台</Text></div>
        <Table<HardwareQueryItem>
          rowKey={(item) => item.asset.uuid}
          size="middle"
          loading={loading}
          dataSource={matchedItems}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 台` }}
          columns={[
            { title: "使用人", width: 120, render: (_value, item) => item.asset.ownerName || <Text type="secondary">未分配</Text> },
            { title: "部门", width: 120, render: (_value, item) => item.asset.department || "未填写" },
            { title: "资产", width: 110, render: (_value, item) => assetLink(item.asset, matchedAssets) },
            { title: "显卡", dataIndex: "graphics", ellipsis: true },
            { title: "CPU", dataIndex: "cpu", ellipsis: true },
            { title: "配置", width: 150, render: (_value, item) => `${item.memoryGb > 0 ? `${Number(item.memoryGb.toFixed(1))} GB` : "-"} / ${item.diskGb > 0 ? `${Number(item.diskGb.toFixed(0))} GB` : "-"}` },
            { title: "状态", width: 90, render: (_value, item) => statusLabel(item.asset.status) },
            { title: "最后采集", width: 180, render: (_value, item) => formatDate(item.asset.latestObservation?.observedAt) },
            { title: "操作", width: 80, fixed: "right", render: (_value, item) => <Button type="link" className="npcink-v3-link" onClick={() => onOpenAsset(item.asset, matchedAssets)}>查看</Button> },
          ]}
          scroll={{ x: 1040 }}
          locale={{ emptyText: <Empty description="没有符合全部条件的电脑" /> }}
        />
      </section>
    </div>
  );
};

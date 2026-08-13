import { SearchOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Radio, Table, Typography } from "antd";
import type { HardwareInventoryKey, HardwareInventoryRow } from "./analysisTypes";
import { HARDWARE_INVENTORY_OPTIONS } from "./analysisTypes";

const { Text, Title } = Typography;

export interface HardwareInventoryViewProps {
  assetsCount: number;
  collectedAssets: number;
  componentCount: number;
  rows: HardwareInventoryRow[];
  visibleRows: HardwareInventoryRow[];
  inventoryKey: HardwareInventoryKey;
  search: string;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onInventoryKeyChange: (value: HardwareInventoryKey) => void;
  onOpenDrillDown: (title: string, assets: HardwareInventoryRow["assets"]) => void;
}

export const HardwareInventoryView = ({
  assetsCount,
  collectedAssets,
  componentCount,
  rows,
  visibleRows,
  inventoryKey,
  search,
  loading,
  onSearchChange,
  onInventoryKeyChange,
  onOpenDrillDown,
}: HardwareInventoryViewProps) => (
  <div className="npcink-v3-analysis-grid">
    <section className="npcink-v3-analysis-panel is-wide">
      <div className="npcink-v3-analysis-panel-head">
        <div>
          <Title level={4}>硬件型号盘点</Title>
          <Text type="secondary">按未归档电脑的当前有效硬件事实统计（优先最新观测，兼容已有导入数据）；CPU、内存和主板按设备计数，硬盘同时统计物理块数与涉及设备数。</Text>
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          className="npcink-v3-hardware-inventory-search"
          placeholder="搜索型号或容量"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <Radio.Group
        className="npcink-v3-hardware-inventory-tabs"
        optionType="button"
        buttonStyle="solid"
        value={inventoryKey}
        onChange={(event) => onInventoryKeyChange(event.target.value)}
        options={HARDWARE_INVENTORY_OPTIONS.map((item) => ({ label: item.label, value: item.key }))}
      />
      <div className="npcink-v3-query-kpis npcink-v3-hardware-inventory-kpis">
        <div><span>电脑范围</span><strong>{assetsCount} 台</strong></div>
        <div><span>已采集设备</span><strong>{collectedAssets} 台</strong></div>
        <div><span>{inventoryKey === "disk" ? "物理硬盘" : "统计部件"}</span><strong>{componentCount} {inventoryKey === "disk" ? "块" : "个"}</strong></div>
        <div><span>型号或容量分类</span><strong>{rows.length} 项</strong></div>
      </div>
    </section>
    <section className="npcink-v3-analysis-panel is-wide">
      <div className="npcink-v3-analysis-panel-head">
        <div><Title level={4}>{HARDWARE_INVENTORY_OPTIONS.find((item) => item.key === inventoryKey)?.label}统计明细</Title><Text type="secondary">点击型号或“查看设备”可下钻到对应电脑的只读列表。</Text></div>
        <Text type="secondary">显示 {visibleRows.length} 项</Text>
      </div>
      <Table<HardwareInventoryRow>
        rowKey="key"
        size="middle"
        loading={loading}
        dataSource={visibleRows}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 项` }}
        columns={[
          { title: inventoryKey === "memory" ? "整机容量" : "型号", dataIndex: "label", render: (value, row) => <Button type="link" className="npcink-v3-link npcink-v3-inventory-model-link" onClick={() => onOpenDrillDown(`${value} 设备`, row.assets)}>{value}</Button> },
          { title: "补充信息", dataIndex: "detail", width: 220, render: (value) => value || <Text type="secondary">-</Text> },
          ...(inventoryKey === "disk" ? [{ title: "硬盘数", dataIndex: "componentCount", width: 100, sorter: (a: HardwareInventoryRow, b: HardwareInventoryRow) => a.componentCount - b.componentCount }] : []),
          { title: "设备数", dataIndex: "assetCount", width: 100, sorter: (a: HardwareInventoryRow, b: HardwareInventoryRow) => a.assetCount - b.assetCount },
          { title: "设备占比", dataIndex: "percent", width: 120, render: (value: number) => `${value.toFixed(1)}%`, sorter: (a: HardwareInventoryRow, b: HardwareInventoryRow) => a.percent - b.percent },
          { title: "操作", width: 100, render: (_value: unknown, row: HardwareInventoryRow) => <Button type="link" className="npcink-v3-link" onClick={() => onOpenDrillDown(`${row.label} 设备`, row.assets)}>查看设备</Button> },
        ]}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty description={search ? "没有匹配的硬件型号" : "暂无已采集硬件"} /> }}
      />
    </section>
  </div>
);

import {
  createAssetEvent,
  getAsset,
  getAssetEvents,
  getAssetIdentities,
  getAssetObservations,
  getSettings,
} from "@/services/v3";
import type { Asset, AssetEvent, AssetEventInput, AssetIdentity, AssetObservation, JsonRecord } from "@/type/v3";
import { assetHardwareContext, firstText, formatBytes, hardwareMemoryBytes } from "@/utils/hardwareAudit";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Collapse, Empty, Input, Modal, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Fragment, useMemo, useState } from "react";
import { AssetSettingsPanel } from "@/pages/assets/AssetSettingsPanel";
import { CustomAssetDetail } from "@/pages/assets/CustomAssetDetail";
import { ManualRecordModal } from "@/pages/assets/ManualRecordModal";
import {
  fieldSourceCellClassName,
  fieldSourceRows,
  hardwareDetailSections,
  groupDetailSections,
  visibleDetailSections,
  renderJsonBlock,
} from "@/pages/shared/detail";
import { automaticChangeRows, manualRecordItem, manualRecordOperator } from "@/pages/shared/events";
import {
  assetPurchaseRecord,
  effectiveFinancialResidualValue,
  financialResidualMode,
  isComputerAsset,
} from "@/pages/shared/finance";
import {
  PlatformMark,
  assetTypeLabel,
  compactJson,
  fieldText,
  formatDate,
  formatHardwareHeroText,
  formatMoney,
  resolvePlatformVisual,
  statusLabel,
} from "@/pages/shared/presentation";

const { Text } = Typography;

export interface DetailDrawerProps {
  uuid: string | null;
  open: boolean;
  initialAsset?: Asset | null;
  departmentOptions?: string[];
  onClose: () => void;
  onArchive: (asset: Asset) => void;
  readOnly?: boolean;
  previousAsset?: Asset;
  nextAsset?: Asset;
  navigationLabel?: string;
  onNavigate?: (asset: Asset) => void;
}

export const DetailDrawer = ({
  uuid,
  open,
  initialAsset = null,
  departmentOptions = [],
  onClose,
  onArchive,
  readOnly = false,
  previousAsset,
  nextAsset,
  navigationLabel,
  onNavigate,
}: DetailDrawerProps) => {
  const queryClient = useQueryClient();
  const [manualRecordOpen, setManualRecordOpen] = useState(false);
  const [manualRecordKeyword, setManualRecordKeyword] = useState("");
  const [manualRecordSearch, setManualRecordSearch] = useState("");
  const [activeDetailKey, setActiveDetailKey] = useState("processor");
  const [showEmptyDetailFields, setShowEmptyDetailFields] = useState(false);
  const [autoRecordSearch, setAutoRecordSearch] = useState("");
  const enabled = Boolean(uuid && open);
  const assetQuery = useQuery(["v3-asset", uuid], () => getAsset(uuid || ""), {
    enabled,
    initialData: initialAsset || undefined,
  });
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const identitiesQuery = useQuery(
    ["v3-asset-identities", uuid],
    () => getAssetIdentities(uuid || ""),
    { enabled }
  );
  const observationsQuery = useQuery(
    ["v3-asset-observations", uuid],
    () => getAssetObservations(uuid || "", 1, 20),
    { enabled }
  );
  const eventsQuery = useQuery(
    ["v3-asset-events", uuid],
    () => getAssetEvents(uuid || "", 1, 30),
    { enabled }
  );

  const asset = assetQuery.data || null;
  const observations = observationsQuery.data?.data || [];
  const events = eventsQuery.data?.data || [];
  const hardwareContext = assetHardwareContext(asset);
  const summary = hardwareContext.summary;
  const extracted = hardwareContext.extracted;
  const platformVisual = resolvePlatformVisual(
    extracted.platform,
    extracted.cpu,
    extracted.deviceModel,
    summary.os_label
  );
  const sourceRows = useMemo(
    () => (asset ? fieldSourceRows(asset, hardwareContext) : []),
    [asset, hardwareContext]
  );
  const allDetailSections = useMemo(
    () => (asset ? groupDetailSections(hardwareDetailSections(asset, hardwareContext, settingsQuery.data)) : []),
    [asset, hardwareContext, settingsQuery.data]
  );
  const detailSections = useMemo(
    () => visibleDetailSections(allDetailSections, showEmptyDetailFields),
    [allDetailSections, showEmptyDetailFields]
  );
  const activeDetailSection =
    detailSections.find((section) => section.key === activeDetailKey) ||
    detailSections.find((section) => section.key === "processor") ||
    detailSections[0];
  const detailTableRows = useMemo(() => {
    const rows = activeDetailSection?.rows || [];
    return rows.flatMap((row, index) => {
      const entry = { ...row, sequence: index + 1, groupHeader: false };
      if (!row.group || row.group === rows[index - 1]?.group) return [entry];
      return [{ ...row, key: `group-${row.key}`, attribute: row.group, value: "", sequence: 0, groupHeader: true }, entry];
    });
  }, [activeDetailSection]);
  const autoRecordRows = useMemo(
    () => automaticChangeRows(events, autoRecordSearch),
    [autoRecordSearch, events]
  );
  const manualRecords = useMemo(() => events.filter((event) => event.eventSource === "manual"), [events]);
  const filteredManualRecords = useMemo(() => {
    const keyword = manualRecordSearch.trim().toLowerCase();
    if (!keyword) {
      return manualRecords;
    }
    return manualRecords.filter((event) => {
      const text = [
        manualRecordOperator(event),
        manualRecordItem(event),
        fieldText(event.message),
        formatDate(event.createdAt),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [manualRecordSearch, manualRecords]);
  const purchaseRecord = asset ? assetPurchaseRecord(asset) : {};
  const purchaseDate = firstText(purchaseRecord.order_time);
  const purchasePrice = Number(asset?.purchasePrice || 0);
  const secondHandMarketValue = Number(asset?.secondHandMarketValue || 0);
  const financialResidualValue = asset ? effectiveFinancialResidualValue(asset, settingsQuery.data) : 0;
  const activeFinancialResidualMode = financialResidualMode(asset);
  const hasPurchasePrice = purchasePrice > 0;
  const hasFinancialResidualValue = financialResidualValue > 0;
  const createEventMutation = useMutation(
    (input: AssetEventInput) => createAssetEvent(uuid || "", input),
    {
      onSuccess: () => {
        setManualRecordOpen(false);
        queryClient.invalidateQueries(["v3-asset-events", uuid]);
        queryClient.invalidateQueries(["v3-events"]);
        message.success("手动记录已添加");
      },
    }
  );

  const handleAssetUpdated = (updated: Asset) => {
    queryClient.setQueryData(["v3-asset", updated.uuid], updated);
    queryClient.invalidateQueries(["v3-assets"]);
    queryClient.invalidateQueries(["v3-asset-events", updated.uuid]);
  };

  const identityColumns: ColumnsType<AssetIdentity> = [
    { title: "类型", dataIndex: "identityType", width: 130 },
    { title: "值", dataIndex: "identityValue" },
    {
      title: "主标识",
      dataIndex: "isPrimary",
      width: 90,
      render: (isPrimary: boolean) => (isPrimary ? <Tag color="blue">主</Tag> : "-"),
    },
    {
      title: "置信度",
      dataIndex: "confidence",
      width: 92,
      render: (value: number) => `${Number(value).toFixed(0)}%`,
    },
    { title: "来源", dataIndex: "source", width: 100 },
  ];

  const observationColumns: ColumnsType<AssetObservation> = [
    { title: "来源", dataIndex: "source", width: 100 },
    { title: "采集时间", dataIndex: "observedAt", width: 180, render: formatDate },
    { title: "接收时间", dataIndex: "receivedAt", width: 180, render: formatDate },
    {
      title: "摘要",
      dataIndex: "summary",
      render: (summary: JsonRecord) => (
        <Space direction="vertical" size={2}>
          <Text>{fieldText(summary.device_model || summary.hostname)}</Text>
          <Text type="secondary">{compactJson(summary)}</Text>
        </Space>
      ),
    },
  ];

  const eventColumns: ColumnsType<AssetEvent> = [
    {
      title: "序号",
      width: 72,
      render: (_value, _event, index) => index + 1,
    },
    {
      title: "变更人",
      width: 140,
      render: (_, event) => manualRecordOperator(event),
    },
    {
      title: "变更项目",
      width: 180,
      render: (_, event) => manualRecordItem(event),
    },
    {
      title: "变更说明",
      dataIndex: "message",
      render: fieldText,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 180,
      render: formatDate,
    },
  ];

  return (
    <Modal
      title={isComputerAsset(asset) ? "电脑资产详情" : "自定义资产详情"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={readOnly ? "min(780px, calc(100vw - 32px))" : (isComputerAsset(asset) ? "min(840px, calc(100vw - 32px))" : "min(860px, calc(100vw - 32px))")}
      className="npcink-v3-detail-modal"
      destroyOnClose
    >
      {assetQuery.isLoading ? (
        <Table loading pagination={false} showHeader={false} />
      ) : asset && !isComputerAsset(asset) ? (
        <CustomAssetDetail
          asset={asset}
          autoRecordRows={autoRecordRows}
          onUpdated={handleAssetUpdated}
          onArchive={onArchive}
          readOnly={readOnly}
        />
      ) : asset ? (
        <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
          {readOnly && navigationLabel ? (
            <div className="npcink-v3-detail-navigation">
              <Text type="secondary">{navigationLabel}</Text>
              <Space.Compact>
                <Button disabled={!previousAsset} onClick={() => previousAsset && onNavigate?.(previousAsset)}>上一台</Button>
                <Button disabled={!nextAsset} onClick={() => nextAsset && onNavigate?.(nextAsset)}>下一台</Button>
              </Space.Compact>
            </div>
          ) : null}
          <div className={`npcink-v3-device-hero is-${platformVisual.kind}`}>
            <div className="npcink-v3-device-brand">
              <PlatformMark visual={platformVisual} variant="hero" />
              <strong>{platformVisual.label}</strong>
            </div>
            <div>
              <h3>{asset.ownerName || asset.name || "未命名资产"}</h3>
              <p>
                {firstText(extracted.deviceModel, extracted.baseboard, formatHardwareHeroText(extracted.cpu, summary, hardwareContext.manualHardware, assetTypeLabel(asset.assetType)))}
              </p>
              <div className="npcink-v3-device-meta">
                <span>部门：{asset.department || "-"}</span>
                <span>状态：{statusLabel(asset.status)}</span>
                <span>编号：{asset.assetNumber || "-"}</span>
                <span>采集：{formatDate(asset.latestObservation?.observedAt)}</span>
              </div>
            </div>
          </div>
          <div className="npcink-v3-detail-finance-summary" aria-label="资产财务摘要">
            <div><span>购置日期</span><strong>{purchaseDate ? formatDate(purchaseDate) : "未登记"}</strong></div>
            <div><span>采购价</span><strong>{hasPurchasePrice ? formatMoney(purchasePrice) : "未登记"}</strong></div>
            <div><span>二手市场价</span><strong>{secondHandMarketValue > 0 ? formatMoney(secondHandMarketValue) : "未登记"}</strong></div>
            <div className="is-emphasis">
              <span className="npcink-v3-finance-label">
                账面净值（估算）
                <em>{activeFinancialResidualMode === "manual" ? "手动" : "自动"}</em>
              </span>
              <strong>{hasFinancialResidualValue ? formatMoney(financialResidualValue) : "未登记"}</strong>
            </div>
          </div>
          <Tabs
            defaultActiveKey="overview"
            items={[
            {
              key: "overview",
              label: "硬件信息",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <div className="npcink-v3-hardware-grid">
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">CPU 型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.cpu)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">显卡型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.graphics)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">计算机型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.deviceModel)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">主板型号</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.baseboard)}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">内存信息</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(hardwareContext.manualHardware.memory || formatBytes(hardwareMemoryBytes(asset)))}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card">
                      <span className="npcink-v3-hardware-label">显示器</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.display)}</strong>
                      <span className="npcink-v3-hardware-meta">{fieldText(extracted.displayModel)}</span>
                    </div>
                    <div className="npcink-v3-hardware-card is-primary">
                      <span className="npcink-v3-hardware-label">存储信息</span>
                      <strong className="npcink-v3-hardware-value">{fieldText(extracted.primaryDisk || hardwareContext.manualHardware.disk || formatBytes(summary.disk_bytes))}</strong>
                    </div>
                    <div className="npcink-v3-hardware-card is-muted">
                      <span className="npcink-v3-hardware-label">添加时间</span>
                      <strong className="npcink-v3-hardware-value">{formatDate(asset.createdAt)}</strong>
                    </div>
                  </div>
                </Space>
              ),
            },
            {
              key: "identities",
              label: "详细信息",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <Checkbox checked={showEmptyDetailFields} onChange={(event) => setShowEmptyDetailFields(event.target.checked)}>
                    显示空字段
                  </Checkbox>
                  <div className="npcink-v3-spec-layout">
                    <div className="npcink-v3-spec-nav">
                      {detailSections.map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          className={section.key === activeDetailSection?.key ? "is-active" : ""}
                          onClick={() => setActiveDetailKey(section.key)}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                    <Table
                      rowKey="key"
                      size="small"
                      className="npcink-v3-spec-table"
                      rowClassName={(row) => row.groupHeader ? "npcink-v3-spec-group" : ""}
                      columns={[
                        {
                          title: "序号",
                          width: 64,
                          render: (_value, row) => row.groupHeader ? <strong>{row.attribute}</strong> : row.sequence,
                          onCell: (row) => row.groupHeader ? { colSpan: 3 } : {},
                        },
                        {
                          title: "属性",
                          dataIndex: "attribute",
                          width: 220,
                          onCell: (row) => row.groupHeader ? { colSpan: 0 } : {},
                        },
                        {
                          title: "配置",
                          dataIndex: "value",
                          onCell: (row) => row.groupHeader ? { colSpan: 0 } : {},
                        },
                      ]}
                      dataSource={detailTableRows}
                      pagination={false}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无该分类信息" /> }}
                    />
                  </div>
                </Space>
              ),
            },
            {
              key: "observations",
              label: "自动记录",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <Text type="secondary">
                    自动记录字段：姓名、状态、编号、部门、IP、采购价、二手市场价、账面净值
                  </Text>
                  <div className="npcink-v3-auto-search">
                    <Input
                      allowClear
                      className="npcink-v3-auto-search-input"
                      placeholder="搜索变更记录"
                      value={autoRecordSearch}
                      onChange={(event) => setAutoRecordSearch(event.target.value)}
                      onPressEnter={() => setAutoRecordSearch(autoRecordSearch)}
                    />
                    <Button
                      aria-label="搜索变更记录"
                      className="npcink-v3-auto-search-button"
                      icon={<SearchOutlined />}
                      onClick={() => setAutoRecordSearch(autoRecordSearch)}
                    />
                  </div>
                  <Table
                    rowKey="key"
                    size="small"
                    className="npcink-v3-auto-table"
                    columns={[
                      {
                        title: "序号",
                        width: 72,
                        render: (_value, _row, index) => index + 1,
                      },
                      {
                        title: "选项",
                        dataIndex: "option",
                        width: 160,
                      },
                      {
                        title: "变更前",
                        dataIndex: "oldValue",
                      },
                      {
                        title: "变更后",
                        dataIndex: "newValue",
                      },
                      {
                        title: "时间",
                        dataIndex: "time",
                        width: 180,
                        render: formatDate,
                      },
                    ]}
                    dataSource={autoRecordRows}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: true,
                    }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自动变更记录" /> }}
                  />
                </Space>
              ),
            },
            ...(!readOnly ? [{
              key: "events",
              label: "手动记录",
              children: (
                <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
                  <div className="npcink-v3-manual-record-toolbar">
                    <Input
                      allowClear
                      className="npcink-v3-manual-record-search"
                      placeholder="搜索变更记录"
                      value={manualRecordKeyword}
                      onChange={(event) => {
                        const value = event.target.value;
                        setManualRecordKeyword(value);
                        if (!value) {
                          setManualRecordSearch("");
                        }
                      }}
                      onPressEnter={() => setManualRecordSearch(manualRecordKeyword.trim())}
                    />
                    <Button icon={<SearchOutlined />} onClick={() => setManualRecordSearch(manualRecordKeyword.trim())}>
                      搜索
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setManualRecordOpen(true)}>
                      添加记录
                    </Button>
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    columns={eventColumns}
                    dataSource={filteredManualRecords}
                    loading={eventsQuery.isLoading}
                    pagination={false}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" /> }}
                  />
                </Space>
              ),
            }] : []),
            {
              key: "debug",
              label: "调试",
              children: (
                <Collapse
                  size="small"
                  items={[
                    {
                      key: "identities",
                      label: `身份标识 ${(identitiesQuery.data || []).length}`,
                      children: (
                        <Table
                          rowKey="id"
                          size="small"
                          columns={identityColumns}
                          dataSource={identitiesQuery.data || []}
                          loading={identitiesQuery.isLoading}
                          pagination={false}
                        />
                      ),
                    },
                    {
                      key: "sources",
                      label: "字段来源对照",
                      children: (
                        <div className="npcink-v3-field-source">
                          <div className="npcink-v3-field-source-head">
                            <Text strong>字段来源对照</Text>
                            <Text type="secondary">标准字段、手动硬件字段和最新采集字段并排查看。</Text>
                          </div>
                          <div className="npcink-v3-field-source-grid">
                            <strong>字段</strong>
                            <strong>标准字段</strong>
                            <strong>手动字段</strong>
                            <strong>最新采集</strong>
                            {sourceRows.map((row) => (
                              <Fragment key={row.key}>
                                <span className={fieldSourceCellClassName(row.label, "label")}>{row.label}</span>
                                <span className={fieldSourceCellClassName(row.standard, "standard", row)}>{row.standard}</span>
                                <span className={fieldSourceCellClassName(row.manual, "manual", row)}>{row.manual}</span>
                                <span className={fieldSourceCellClassName(row.latest, "latest", row)}>{row.latest}</span>
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "metadata",
                      label: "资产扩展信息",
                      children: renderJsonBlock(asset.metadata),
                    },
                    {
                      key: "observations",
                      label: `采集记录 ${observations.length}`,
                      children: (
                        <Table
                          rowKey="id"
                          size="small"
                          columns={observationColumns}
                          dataSource={observations}
                          loading={observationsQuery.isLoading}
                          pagination={false}
                          expandable={{
                            expandedRowRender: (observation) => (
                              <Collapse
                                size="small"
                                items={[
                                  {
                                    key: "hardware",
                                    label: "硬件明细",
                                    children: renderJsonBlock(observation.hardware),
                                  },
                                  {
                                    key: "raw",
                                    label: "原始数据",
                                    children: renderJsonBlock(observation.raw),
                                  },
                                ]}
                              />
                            ),
                          }}
                        />
                      ),
                    },
                  ]}
                />
              ),
            },
            ...(!readOnly ? [{
              key: "settings",
              label: "设置",
              children: (
                <AssetSettingsPanel
                  asset={asset}
                  departmentOptions={departmentOptions}
                  onUpdated={handleAssetUpdated}
                  onArchive={onArchive}
                />
              ),
            }] : []),
            ]}
          />
          {!readOnly ? (
            <ManualRecordModal
              open={manualRecordOpen}
              asset={asset}
              loading={createEventMutation.isLoading}
              onClose={() => setManualRecordOpen(false)}
              onSubmit={(values) => createEventMutation.mutateAsync(values)}
            />
          ) : null}
        </Space>
      ) : (
        <Empty description="未找到资产" />
      )}
    </Modal>
  );
};

import { getAssets, getSettings } from "@/services/v3";
import type { Asset, AssetListParams } from "@/type/v3";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Empty, Modal, Radio, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { fetchAllAssets } from "@/pages/shared/assets";
import { effectiveFinancialResidualValue } from "@/pages/shared/finance";
import {
  AssetExportColorMode,
  AssetExportFieldKey,
  AssetExportFormat,
  AssetExportScope,
  AssetExportStatusColors,
  STATUS_OPTIONS,
} from "@/pages/shared/options";
import {
  ASSET_EXPORT_COLOR_STORAGE_KEY,
  ASSET_EXPORT_FIELDS,
  DEFAULT_ASSET_EXPORT_FIELD_KEYS,
  DEFAULT_ASSET_EXPORT_STATUS_COLORS,
  assetsToCsv,
  downloadCsvFile,
  exportAssetWorkbook,
  exportableAssets,
  loadAssetExportStatusColors,
  selectedAssetExportFields,
} from "@/pages/shared/tabular";

const { Text } = Typography;

export interface AssetExportModalProps {
  open: boolean;
  currentScopeLabel: string;
  currentQueryParams: AssetListParams;
  currentTotal?: number;
  selectedAssets?: Asset[];
  onClose: () => void;
}

export const AssetExportModal = ({
  open,
  currentScopeLabel,
  currentQueryParams,
  currentTotal,
  selectedAssets = [],
  onClose,
}: AssetExportModalProps) => {
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const [scope, setScope] = useState<AssetExportScope>("current-filter");
  const [fieldKeys, setFieldKeys] = useState<AssetExportFieldKey[]>(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
  const [format, setFormat] = useState<AssetExportFormat>("xlsx");
  const [statusColors, setStatusColors] = useState<AssetExportStatusColors>(loadAssetExportStatusColors);
  const [colorMode, setColorMode] = useState<AssetExportColorMode>("row");
  const [draggedField, setDraggedField] = useState<AssetExportFieldKey>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLeftOffset, setPreviewLeftOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportParams: Record<Exclude<AssetExportScope, "current-filter" | "selected">, AssetListParams> = {
    computer: { assetScope: "computer" },
    custom: { assetScope: "other" },
    all: { assetScope: "all" },
  };

  useEffect(() => {
    if (open) {
      setScope(selectedAssets.length ? "selected" : "current-filter");
      setFieldKeys(DEFAULT_ASSET_EXPORT_FIELD_KEYS);
      setFormat("xlsx");
      setStatusColors(loadAssetExportStatusColors());
      setColorMode("row");
      setPreviewOpen(false);
    }
  }, [open, selectedAssets.length]);

  useEffect(() => {
    if (!previewOpen) return;
    const updatePreviewOffset = () => {
      const menu = document.getElementById("adminmenuwrap");
      const right = menu?.getBoundingClientRect().right || 0;
      setPreviewLeftOffset(right > 0 && right < window.innerWidth * 0.4 ? Math.round(right) : 0);
    };
    updatePreviewOffset();
    window.addEventListener("resize", updatePreviewOffset);
    return () => window.removeEventListener("resize", updatePreviewOffset);
  }, [previewOpen]);

  const previewParams = scope === "current-filter" ? currentQueryParams : scope === "selected" ? undefined : exportParams[scope];
  const previewQuery = useQuery(
    ["v3-export-preview", scope, previewParams],
    () => getAssets({ ...previewParams, page: 1, pageSize: 30 }),
    { enabled: open && previewOpen && scope !== "selected", staleTime: 30_000 }
  );
  const selectedExportAssets = exportableAssets(selectedAssets);
  const previewAssets = exportableAssets(scope === "selected" ? selectedAssets : previewQuery.data?.data || []).slice(0, 30).map((asset) => ({
    ...asset,
    financialResidualValue: effectiveFinancialResidualValue(asset, settingsQuery.data),
  }));
  const previewFields = selectedAssetExportFields(fieldKeys);

  const toggleField = (key: AssetExportFieldKey, checked: boolean) => {
    setFieldKeys((keys) => checked ? [...keys, key] : keys.filter((item) => item !== key));
  };
  const moveField = (target: AssetExportFieldKey) => {
    if (!draggedField || draggedField === target) return;
    setFieldKeys((keys) => {
      const next = keys.filter((key) => key !== draggedField);
      next.splice(next.indexOf(target), 0, draggedField);
      return next;
    });
    setDraggedField(undefined);
  };
  const saveColorDefaults = () => {
    window.localStorage.setItem(ASSET_EXPORT_COLOR_STORAGE_KEY, JSON.stringify(statusColors));
    message.success("状态颜色已保存为默认方案");
  };

  const exportAssets = async () => {
    if (!fieldKeys.length) {
      message.warning("请至少选择一个导出字段");
      return;
    }
    setExporting(true);
    try {
      const assets = exportableAssets(scope === "selected"
        ? selectedAssets
        : await fetchAllAssets(scope === "current-filter" ? currentQueryParams : exportParams[scope]));
      if (!assets.length) {
        message.warning("当前范围没有可导出的未归档资产");
        return;
      }
      const exportAssetsWithEffectiveFinancialValue = assets.map((asset) => ({
        ...asset,
        financialResidualValue: effectiveFinancialResidualValue(asset, settingsQuery.data),
      }));
      if (format === "xlsx") {
        await exportAssetWorkbook(exportAssetsWithEffectiveFinancialValue, fieldKeys, statusColors, colorMode);
      } else {
        downloadCsvFile(`电脑设备-${Date.now()}.csv`, assetsToCsv(exportAssetsWithEffectiveFinancialValue, fieldKeys));
      }
      message.success(`已导出 ${assets.length} 条资产`);
      setPreviewOpen(false);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "表格导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  };
  const currentFilterCountText =
    typeof currentTotal === "number" ? `${currentTotal} 条` : "导出时计算";
  const previewTotalText = scope === "current-filter"
    ? currentFilterCountText
    : scope === "selected"
      ? `${selectedExportAssets.length} 条`
      : previewQuery.data
        ? `${previewQuery.data.pagination.totalItems} 条`
        : "计算中";
  const previewScopeLabel = scope === "current-filter"
    ? `${currentScopeLabel}（当前筛选）`
    : scope === "selected"
      ? "已勾选资产"
      : scope === "computer"
        ? "全部电脑设备"
        : scope === "custom"
          ? "全部自定义设备"
          : "全部资产";

  return (
    <>
    <Modal
      title="资产表格导出"
      open={open}
      onCancel={onClose}
      width={820}
      destroyOnClose
      className="npcink-v3-export-modal"
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="preview" disabled={!fieldKeys.length} onClick={() => setPreviewOpen(true)}>预览表格</Button>,
        <Button key="export" type="primary" loading={exporting} disabled={!fieldKeys.length} onClick={exportAssets}>{format === "xlsx" ? "导出 Excel" : "导出 CSV"}</Button>,
      ]}
    >
      <div className="npcink-v3-export-config">
        <section>
          <Text strong>文件格式</Text>
          <Radio.Group
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            options={[
              { label: "Excel（推荐，包含状态颜色）", value: "xlsx" },
              { label: "CSV（通用，无颜色）", value: "csv" },
            ]}
          />
          {format === "csv" ? <Alert type="info" showIcon message="CSV 不保存颜色和单元格样式，预览窗口仅展示数据内容。" /> : null}
        </section>
        <section>
          <Text strong>导出范围</Text>
          <Text type="secondary" className="npcink-v3-export-range-note">
            符合当前筛选条件的数据，就是资产列表里筛选后的全部结果，不只是当前页；已归档设备始终不会导出。
          </Text>
          <Radio.Group className="npcink-v3-export-scope-grid" value={scope} onChange={(event) => setScope(event.target.value)}>
            <Radio value="current-filter"><strong>当前筛选结果</strong><small>{currentScopeLabel} · {currentFilterCountText}</small></Radio>
            {selectedAssets.length ? <Radio value="selected"><strong>已勾选设备</strong><small>可导出 {selectedExportAssets.length} 条（自动排除已归档）</small></Radio> : <div className="npcink-v3-export-scope-empty"><strong>已勾选设备</strong><small>尚未选择设备，请先在资产列表进入批量模式并勾选。</small></div>}
            <Radio value="computer"><strong>全部电脑设备</strong><small>不受当前筛选条件影响</small></Radio>
            <Radio value="custom"><strong>全部自定义设备</strong><small>不受当前筛选条件影响</small></Radio>
            <Radio value="all"><strong>全部资产</strong><small>忽略当前筛选，包含电脑与自定义设备</small></Radio>
          </Radio.Group>
        </section>
        <section>
          <div className="npcink-v3-export-section-head"><Text strong>导出字段</Text><Text type="secondary">已选 {fieldKeys.length} 个，可拖动排序</Text></div>
          <div className="npcink-v3-export-field-toolbar">
            <div><Text type="secondary">常用方案</Text><Space wrap size={6}>
              <Button type="primary" ghost size="small" onClick={() => setFieldKeys(["assetNumber", "ownerName", "department", "status", "purchasePrice", "secondHandMarketValue", "financialResidualValue", "baseboard", "cpu"])}>推荐电脑台账</Button>
              <Button size="small" onClick={() => setFieldKeys(["assetNumber", "name", "ownerName", "department", "status", "purchasePrice", "secondHandMarketValue", "financialResidualValue", "purchaseDate"])}>财务台账</Button>
              <Button size="small" onClick={() => setFieldKeys(["assetNumber", "ownerName", "department", "status", "cpu", "memory", "disk", "graphics", "deviceModel", "baseboard", "ip"])}>硬件配置</Button>
            </Space></div>
            <Space size={6}><Button size="small" onClick={() => setFieldKeys(ASSET_EXPORT_FIELDS.map((field) => field.key))}>全选</Button><Button danger type="text" size="small" onClick={() => setFieldKeys([])}>清空</Button></Space>
          </div>
          {fieldKeys.length ? <div className="npcink-v3-export-field-order">
            {previewFields.map((field) => <button key={field.key} type="button" draggable onDragStart={() => setDraggedField(field.key)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveField(field.key)}>{field.label}<span>⋮⋮</span></button>)}
          </div> : null}
          <div className="npcink-v3-export-fields">
            {["基础信息", "财务信息", "硬件信息", "系统信息"].map((group) => (
              <div key={group}>
                <div className="npcink-v3-export-field-group-head">
                  <Text type="secondary">{group} {ASSET_EXPORT_FIELDS.filter((field) => field.group === group && fieldKeys.includes(field.key)).length}/{ASSET_EXPORT_FIELDS.filter((field) => field.group === group).length}</Text>
                  <Space size={4}><Button type="link" size="small" onClick={() => setFieldKeys((keys) => [...keys, ...ASSET_EXPORT_FIELDS.filter((field) => field.group === group && !keys.includes(field.key)).map((field) => field.key)])}>全选本组</Button><Button type="link" size="small" onClick={() => setFieldKeys((keys) => keys.filter((key) => ASSET_EXPORT_FIELDS.find((field) => field.key === key)?.group !== group))}>清空本组</Button></Space>
                </div>
                <div className="npcink-v3-export-field-options">{ASSET_EXPORT_FIELDS.filter((field) => field.group === group).map((field) => <Checkbox key={field.key} checked={fieldKeys.includes(field.key)} onChange={(event) => toggleField(field.key, event.target.checked)}>{field.label}</Checkbox>)}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="npcink-v3-export-section-head"><Text strong>状态颜色</Text><Text type="secondary">仅 Excel 生效</Text></div>
          <Radio.Group disabled={format === "csv"} value={colorMode} onChange={(event) => setColorMode(event.target.value)} options={[{ label: "整行背景", value: "row" }, { label: "仅状态单元格", value: "status-cell" }]} />
          <div className={`npcink-v3-export-colors${format === "csv" ? " is-disabled" : ""}`}>
            {STATUS_OPTIONS.map((status) => <div key={status.value}><span>{status.label}</span><input type="color" disabled={format === "csv"} value={statusColors[status.value] || "#ffffff"} onChange={(event) => setStatusColors((colors) => ({ ...colors, [status.value]: event.target.value }))} /><Button size="small" disabled={format === "csv" || !statusColors[status.value]} onClick={() => setStatusColors((colors) => ({ ...colors, [status.value]: "" }))}>不填色</Button></div>)}
          </div>
          <Space wrap><Button size="small" disabled={format === "csv"} onClick={() => setStatusColors({ ...DEFAULT_ASSET_EXPORT_STATUS_COLORS })}>恢复默认</Button><Button size="small" disabled={format === "csv"} onClick={saveColorDefaults}>保存为默认方案</Button></Space>
        </section>
      </div>
    </Modal>
    <Modal
      title="导出表格预览"
      open={previewOpen}
      onCancel={() => setPreviewOpen(false)}
      width={`calc(100vw - ${previewLeftOffset + 32}px)`}
      style={{ marginLeft: previewLeftOffset + 16, marginRight: 16 }}
      className="npcink-v3-export-preview-modal"
      destroyOnClose
      footer={[
        <Button key="back" onClick={() => setPreviewOpen(false)}>返回修改</Button>,
        <Button key="export" type="primary" loading={exporting} onClick={exportAssets}>{format === "xlsx" ? "确认导出 Excel" : "确认导出 CSV"}</Button>,
      ]}
    >
      <div className="npcink-v3-export-preview-summary">
        <div><Text strong>{previewScopeLabel}</Text><Text type="secondary">预览前 {previewAssets.length} 条，导出时包含范围内全部数据。</Text></div>
        <Text type="secondary">{previewTotalText} · {fieldKeys.length} 列 · {format === "xlsx" ? "Excel" : "CSV"}{format === "xlsx" ? ` · ${colorMode === "row" ? "整行着色" : "状态单元格着色"}` : ""}</Text>
      </div>
      <div className="npcink-v3-export-preview-table is-fullscreen">
        {fieldKeys.length ? <table><thead><tr>{previewFields.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{previewAssets.map((asset) => <tr key={asset.uuid}>{previewFields.map((field) => {
          const colored = format === "xlsx" && statusColors[asset.status] && (colorMode === "row" || field.key === "status");
          return <td key={field.key} style={colored ? { backgroundColor: statusColors[asset.status] } : undefined} title={String(field.value(asset) ?? "")}>{String(field.value(asset) ?? "") || "-"}</td>;
        })}</tr>)}</tbody></table> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择至少一个导出字段" />}
        {previewQuery.isLoading && scope !== "selected" ? <div className="npcink-v3-export-preview-loading">正在加载预览…</div> : null}
      </div>
    </Modal>
    </>
  );
};

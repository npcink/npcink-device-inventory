import { getSettings, importAssets } from "@/services/v3";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useMemo, useState } from "react";
import { fetchAllAssets } from "@/pages/shared/assets";
import { normalizeDepartmentList } from "@/pages/shared/departments";
import {
  AssetImportPreviewRow,
  AssetImportSection,
  AssetImportStrategy,
  DEFAULT_ASSET_IMPORT_SECTIONS,
} from "@/pages/shared/options";
import { fieldText, statusLabel } from "@/pages/shared/presentation";
import {
  buildImportPreviewRows,
  downloadCsvFile,
  importTemplateCsv,
  parseTabularText,
} from "@/pages/shared/tabular";

const { Text } = Typography;

export interface AssetImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export const AssetImportModal = ({ open, onClose, onImported }: AssetImportModalProps) => {
  const [rawText, setRawText] = useState("");
  const [strategy, setStrategy] = useState<AssetImportStrategy>("upsert-by-number");
  const [sections, setSections] = useState<AssetImportSection[]>(DEFAULT_ASSET_IMPORT_SECTIONS);
  const [previewRows, setPreviewRows] = useState<AssetImportPreviewRow[]>([]);
  const settingsQuery = useQuery(["v3-settings"], getSettings, { enabled: open, staleTime: 60_000 });
  const departmentOptions = useMemo(
    () => normalizeDepartmentList(settingsQuery.data?.departments || []),
    [settingsQuery.data?.departments]
  );
  const existingAssetsQuery = useQuery(["v3-assets-import-index"], () => fetchAllAssets({ assetScope: "all", includeDeleted: true }), {
    enabled: open,
  });
  const importMutation = useMutation(
    async (rows: AssetImportPreviewRow[]) => {
      const executable = rows.filter((row) => row.action === "create" || row.action === "update");
      const result = await importAssets(executable.map((row) => ({
        operation: row.action as "create" | "update",
        uuid: row.existing?.uuid,
        input: row.input,
      })));
      return { ...result, skipped: rows.length - executable.length };
    },
    {
      onSuccess: (result) => {
        onImported();
        message.success(`导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`);
        setRawText("");
        setPreviewRows([]);
        onClose();
      },
    }
  );

  const parseSource = (text = rawText) => {
    try {
      const rows = buildImportPreviewRows(parseTabularText(text), existingAssetsQuery.data || [], strategy, sections, departmentOptions);
      setPreviewRows(rows);
      if (!rows.length) {
        message.warning("没有识别到可导入的数据");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "解析失败");
    }
  };

  return (
    <Modal
      title="资产表格导入"
      open={open}
      onCancel={onClose}
      width={980}
      className="npcink-v3-import-modal"
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="preview" onClick={() => parseSource()}>
          生成预览
        </Button>,
        <Button
          key="import"
          type="primary"
          disabled={
            settingsQuery.isError ||
            settingsQuery.isLoading ||
            existingAssetsQuery.isError ||
            existingAssetsQuery.isLoading ||
            !previewRows.some((row) => row.action === "create" || row.action === "update")
          }
          loading={importMutation.isLoading}
          onClick={() => importMutation.mutate(previewRows)}
        >
          导入可执行数据
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} className="npcink-v3-detail-stack">
        <Alert
          type="info"
          showIcon
          message="只支持标准资产 CSV"
          description="请先下载模板填写。导入以资产编号为匹配键，可选择仅新增、仅更新，或按编号新增/更新。"
        />
        {settingsQuery.isError || existingAssetsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="导入预检数据加载失败"
            description="无法安全判断部门和已有资产，请重试后再导入。"
            action={<Button onClick={() => { settingsQuery.refetch(); existingAssetsQuery.refetch(); }}>重试</Button>}
          />
        ) : null}
        <Alert type="success" showIcon message="导入使用单次服务端事务" description="任意一行写入失败时，本次可执行数据会全部回滚，不会留下半导入。" />
        <Space wrap>
          <Button onClick={() => downloadCsvFile(`asset-import-template-${Date.now()}.csv`, importTemplateCsv())}>
            下载导入模板
          </Button>
          <Radio.Group
            value={strategy}
            onChange={(event) => {
              setStrategy(event.target.value);
              setPreviewRows([]);
            }}
            options={[
              { label: "新增或更新", value: "upsert-by-number" },
              { label: "只新增", value: "create-only" },
              { label: "只更新", value: "update-by-number" },
            ]}
          />
        </Space>
        <div>
          <Text strong>导入数据</Text>
          <Checkbox.Group
            className="npcink-v3-checkbox-row"
            value={sections}
            onChange={(values) => {
              setSections(values as AssetImportSection[]);
              setPreviewRows([]);
            }}
            options={[
              { label: "基础信息", value: "basic" },
              { label: "财务信息", value: "finance" },
              { label: "手动硬件", value: "hardware" },
            ]}
          />
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const text = String(reader.result || "");
              setRawText(text);
              parseSource(text);
            };
            reader.readAsText(file);
          }}
        />
        <Input.TextArea
          rows={6}
          value={rawText}
          onChange={(event) => {
            setRawText(event.target.value);
            setPreviewRows([]);
          }}
          placeholder="粘贴标准 CSV。第一行应使用模板表头：资产编号,资产名称,资产类型,使用人,部门,状态..."
        />
        <Table
          rowKey="key"
          size="small"
          pagination={{ pageSize: 5, showSizeChanger: false }}
          dataSource={previewRows}
          columns={[
            { title: "行号", dataIndex: "rowNumber", width: 76 },
            { title: "动作", dataIndex: "action", width: 96, render: (value) => (
              <Tag color={value === "create" ? "green" : value === "update" ? "blue" : value === "invalid" ? "red" : "default"}>
                {value === "create" ? "新增" : value === "update" ? "更新" : value === "invalid" ? "错误" : "跳过"}
              </Tag>
            ) },
            { title: "编号", render: (_, row) => fieldText(row.input.assetNumber), width: 150 },
            { title: "名称", render: (_, row) => fieldText(row.input.name) },
            { title: "使用人", render: (_, row) => fieldText(row.input.ownerName), width: 120 },
            { title: "部门", render: (_, row) => fieldText(row.input.department), width: 120 },
            { title: "状态", render: (_, row) => statusLabel(String(row.input.status || "")), width: 100 },
            {
              title: "校验",
              render: (_, row) => row.errors.length ? <Text type="danger">{row.errors.join("；")}</Text> : <Text type="secondary">通过</Text>,
            },
          ]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="先粘贴或选择文件，再生成导入预览"
              />
            ),
          }}
        />
      </Space>
    </Modal>
  );
};

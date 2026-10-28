import { useEffect, useState } from "react";
import axios from "axios";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Empty, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { exportBackup, restoreBackup } from "@/services/v3";
import type { BackupExportSection, BackupRestoreSummary } from "@/type/v3";

const { Text, Title } = Typography;

const DEFAULT_SECTIONS: BackupExportSection[] = ["settings", "assets", "identities", "events", "observations"];
const SECTION_OPTIONS: Array<{ label: string; value: BackupExportSection }> = [
  { label: "设置", value: "settings" },
  { label: "资产台账", value: "assets" },
  { label: "设备匹配标识", value: "identities" },
  { label: "变更记录", value: "events" },
  { label: "电脑采集快照", value: "observations" },
];

const BACKUP_RESTORE_SECTION_LABELS: Record<keyof BackupRestoreSummary["available"], string> = {
  settings: "设置",
  assets: "资产台账",
  identities: "设备匹配标识",
  events: "变更记录",
  observations: "电脑采集快照",
};

const BACKUP_RESTORE_PLAN_LABELS: Record<keyof BackupRestoreSummary["planned"], string> = {
  settings: "设置恢复",
  assetsCreated: "新增资产",
  assetsUpdated: "更新资产",
  identitiesCreated: "新增设备匹配标识",
  identitiesExisting: "已存在设备匹配标识",
  observationsCreated: "新增电脑采集快照",
  observationsExisting: "已存在电脑采集快照",
  eventsCreated: "新增变更记录",
  eventsExisting: "已存在变更记录",
};

const downloadJsonFile = (filename: string, value: unknown) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const BackupManagementPanels = ({ onOpenImport }: { onOpenImport: () => void }) => {
  const [sections, setSections] = useState<BackupExportSection[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(false);

  const exportCurrentBackup = async () => {
    setLoading(true);
    try {
      const result = await exportBackup(sections);
      downloadJsonFile(`npcink-device-inventory-backup-${Date.now()}.json`, result.backup);
      message.success(`JSON 备份已导出（${Math.ceil(result.meta.bytes / 1024)} KB）`);
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        message.error(error instanceof Error ? error.message : "JSON 备份导出失败");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="npcink-v3-tool-panel">
        <div>
          <Title level={4}>JSON 备份导出</Title>
          <Text type="secondary">给管理员完整迁移或归档，默认导出全部业务数据；不会导出客户端令牌密钥。</Text>
          <Text type="secondary" className="npcink-v3-export-range-note">
            电脑采集快照用于保留客户端上报的硬件历史；日常台账表格导出不需要。
          </Text>
          <Checkbox.Group
            className="npcink-v3-checkbox-row"
            value={sections}
            onChange={(values) => setSections(values as BackupExportSection[])}
            options={SECTION_OPTIONS}
          />
        </div>
        <Button loading={loading} disabled={!sections.length} onClick={exportCurrentBackup}>导出 JSON 备份</Button>
      </div>
      <div className="npcink-v3-tool-panel">
        <div>
          <Title level={4}>JSON 备份导入</Title>
          <Text type="secondary">将本插件备份恢复到当前站点；导入前会校验文件并展示各区段数量。</Text>
          <Text type="secondary" className="npcink-v3-export-range-note">
            适合本地整理后迁移到正式站点；客户端令牌和站点 URL 相关设置需重新配置。
          </Text>
        </div>
        <Button danger onClick={onOpenImport}>导入 JSON 备份</Button>
      </div>
    </>
  );
};

interface BackupRestoreModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export const BackupRestoreModal = ({ open, onClose, onImported }: BackupRestoreModalProps) => {
  const [rawText, setRawText] = useState("");
  const [backup, setBackup] = useState<unknown>(null);
  const [summary, setSummary] = useState<BackupRestoreSummary | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const previewMutation = useMutation(
    async (text: string) => {
      const parsed = JSON.parse(text);
      const result = await restoreBackup(parsed, true);
      return { parsed, summary: result.summary };
    },
    {
      onSuccess: (result) => {
        setBackup(result.parsed);
        setSummary(result.summary);
        setRestoreConfirmed(false);
        message.success("备份文件校验通过");
      },
      onError: (error) => {
        setBackup(null);
        setSummary(null);
        setRestoreConfirmed(false);
        if (!axios.isAxiosError(error)) {
          message.error(error instanceof SyntaxError ? "JSON 格式不正确，请检查备份文件是否完整" : error instanceof Error ? error.message : "备份文件校验失败");
        }
      },
    }
  );
  const restoreMutation = useMutation(
    async () => {
      if (!backup) {
        throw new Error("请先校验备份文件");
      }
      return restoreBackup(backup, false);
    },
    {
      onSuccess: (result) => {
        setSummary(result.summary);
        message.success("JSON 备份导入完成");
        setRawText("");
        setBackup(null);
        setSummary(null);
        setRestoreConfirmed(false);
        onImported();
        onClose();
      },
      onError: (error) => {
        setRestoreConfirmed(false);
        if (!axios.isAxiosError(error)) {
          message.error(error instanceof Error ? error.message : "JSON 备份导入失败");
        }
      },
    }
  );

  useEffect(() => {
    if (!open) {
      setRawText("");
      setBackup(null);
      setSummary(null);
      setRestoreConfirmed(false);
      previewMutation.reset();
      restoreMutation.reset();
    }
  }, [open]);

  const parseSource = (text = rawText) => {
    if (!text.trim()) {
      message.warning("请选择或粘贴 JSON 备份文件");
      return;
    }
    previewMutation.mutate(text);
  };

  const availableRows = summary
    ? Object.entries(summary.available).map(([key, value]) => ({
      key,
      label: BACKUP_RESTORE_SECTION_LABELS[key as keyof BackupRestoreSummary["available"]],
      count: value,
    }))
    : [];
  const planRows = summary
    ? Object.entries(summary.planned).map(([key, value]) => ({
      key,
      label: BACKUP_RESTORE_PLAN_LABELS[key as keyof BackupRestoreSummary["planned"]],
      count: value,
    })).filter((item) => item.count > 0)
    : [];
  const skipRows = summary
    ? Object.entries(summary.skipped).map(([key, value]) => ({
      key,
      label: BACKUP_RESTORE_SECTION_LABELS[key as keyof BackupRestoreSummary["skipped"]],
      count: value,
    })).filter((item) => item.count > 0)
    : [];
  const hasConflicts = Boolean(summary?.conflicts.length);

  return (
    <Modal
      title="导入 JSON 备份"
      open={open}
      onCancel={onClose}
      width={860}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="preview" loading={previewMutation.isLoading} onClick={() => parseSource()}>
          校验并预览
        </Button>,
        <Button
          key="restore"
          type="primary"
          danger
          disabled={!backup || !summary || hasConflicts || !restoreConfirmed}
          loading={restoreMutation.isLoading}
          onClick={() => restoreMutation.mutate()}
        >
          导入备份
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} className="npcink-v3-detail-stack">
        <Alert
          type="warning"
          showIcon
          message="导入采用合并/更新策略"
          description="会按资产 UUID 或资产编号更新/新增插件业务数据，不会清空正式站点现有数据。客户端令牌和上传基础 URL 不会恢复。"
        />
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const text = String(reader.result || "");
              setRawText(text);
              setBackup(null);
              setSummary(null);
              setRestoreConfirmed(false);
              parseSource(text);
            };
            reader.readAsText(file);
          }}
        />
        <Input.TextArea
          rows={7}
          value={rawText}
          onChange={(event) => {
            setRawText(event.target.value);
            setBackup(null);
            setSummary(null);
            setRestoreConfirmed(false);
          }}
          placeholder="粘贴从本插件“JSON 备份导出”生成的备份内容"
        />
        {summary ? (
          <Space direction="vertical" size={10} className="npcink-v3-detail-stack">
            <div>
              <Text strong>备份信息</Text>
              <Text type="secondary" className="npcink-v3-export-range-note">
                {summary.exportedAt ? `导出时间：${summary.exportedAt}` : "未记录导出时间"}
              </Text>
            </div>
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={availableRows}
              columns={[
                { title: "数据区段", dataIndex: "label" },
                { title: "可导入数量", dataIndex: "count", width: 140 },
              ]}
            />
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={planRows}
              locale={{ emptyText: "没有需要创建或更新的数据" }}
              columns={[
                { title: "导入计划", dataIndex: "label" },
                { title: "数量", dataIndex: "count", width: 140 },
              ]}
            />
            {skipRows.length ? (
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={skipRows}
                columns={[
                  { title: "跳过区段", dataIndex: "label" },
                  { title: "跳过数量", dataIndex: "count", width: 140 },
                ]}
              />
            ) : null}
            {hasConflicts ? (
              <Alert
                type="error"
                showIcon
                message="发现导入冲突"
                description={(
                  <Space direction="vertical" size={4}>
                    {summary.conflicts.map((conflict) => (
                      <Text key={conflict} type="danger">
                        {conflict}
                      </Text>
                    ))}
                  </Space>
                )}
              />
            ) : null}
            <div className="npcink-v3-checkbox-row">
              {summary.warnings.map((warning) => (
                <Tag color="orange" key={warning}>
                  {warning}
                </Tag>
              ))}
            </div>
            <Checkbox
              checked={restoreConfirmed}
              disabled={hasConflicts}
              onChange={(event) => setRestoreConfirmed(event.target.checked)}
            >
              我确认会按预览计划合并/更新正式站点数据，且已保留当前站点备份
            </Checkbox>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择或粘贴 JSON，再校验预览" />
        )}
      </Space>
    </Modal>
  );
};

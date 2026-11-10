import { lazy } from "react";
import { DeferredPanel } from "@/components/DeferredPanel";
import { BackupManagementPanels, BackupRestoreModal } from "@/components/backup-management";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Typography } from "antd";
import { useState } from "react";

const { Text, Title } = Typography;

const AssetImportModal = lazy(() => import("@/pages/assets/AssetImportModal").then((module) => ({ default: module.AssetImportModal })));

export const DataToolsWorkspace = () => {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [backupImportModalOpen, setBackupImportModalOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>数据工具</Title>
          <Text type="secondary">批量导入资产和备份恢复；日常表格导出请使用资产列表。</Text>
        </div>
      </div>
      <div className="npcink-v3-data-tools">
        <div className="npcink-v3-tool-panel">
          <div>
            <Title level={4}>资产表格导入</Title>
            <Text type="secondary">下载标准模板后填写，可按资产编号新增或更新资产、财务字段和手动硬件字段。</Text>
          </div>
          <Button type="primary" onClick={() => setImportModalOpen(true)}>
            导入资产表格
          </Button>
        </div>
        <BackupManagementPanels onOpenImport={() => setBackupImportModalOpen(true)} />
      </div>
      <DeferredPanel open={importModalOpen}>
      <AssetImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries(["v3-assets"]);
          queryClient.invalidateQueries(["v3-assets-import-index"]);
        }}
      />
      </DeferredPanel>
      <BackupRestoreModal
        open={backupImportModalOpen}
        onClose={() => setBackupImportModalOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries(["v3-assets"]);
          queryClient.invalidateQueries(["v3-assets-import-index"]);
          queryClient.invalidateQueries(["v3-events"]);
          queryClient.invalidateQueries(["v3-observations"]);
          queryClient.invalidateQueries(["v3-analysis-observations"]);
          queryClient.invalidateQueries(["v3-analysis-collection-trends"]);
          queryClient.invalidateQueries(["v3-settings"]);
        }}
      />
    </div>
  );
};

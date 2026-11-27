import { Tabs } from "antd";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { WORKSPACE_TAB_STORAGE_KEY } from "@/pages/shared/options";
import { loadStoredTab, saveStoredTab } from "@/pages/shared/storage";

const AssetWorkspace = lazy(() => import("./assets/AssetWorkspace").then((module) => ({ default: module.AssetWorkspace })));
const AnalysisWorkspace = lazy(() => import("./analysis/AnalysisWorkspace").then((module) => ({ default: module.AnalysisWorkspace })));
const ChangeWorkspace = lazy(() => import("./events/ChangeWorkspace").then((module) => ({ default: module.ChangeWorkspace })));
const SettingsWorkspace = lazy(() => import("./settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })));
const DataToolsWorkspace = lazy(() => import("./tools/DataToolsWorkspace").then((module) => ({ default: module.DataToolsWorkspace })));

export const WORKSPACE_TAB_KEYS = ["computer", "custom", "events", "analysis", "tools", "settings"] as const;
type WorkspaceKey = (typeof WORKSPACE_TAB_KEYS)[number];

const WORKSPACE_ITEMS = [
  { key: "computer", label: "电脑设备", children: <AssetWorkspace initialScope="computer" title="电脑资产" /> },
  { key: "custom", label: "自定义设备", children: <AssetWorkspace initialScope="other" title="自定义资产" /> },
  { key: "events", label: "变更数据", children: <ChangeWorkspace /> },
  { key: "analysis", label: "分析", children: <AnalysisWorkspace /> },
  { key: "tools", label: "数据工具", children: <DataToolsWorkspace /> },
  { key: "settings", label: "设置", children: <SettingsWorkspace /> },
] satisfies { key: WorkspaceKey; label: string; children: ReactNode }[];

const workspaceKey = (value: string) => WORKSPACE_TAB_KEYS.find((tab) => tab === value) ?? "computer";

export const InventoryAdmin = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceKey>(() =>
    loadStoredTab(WORKSPACE_TAB_STORAGE_KEY, WORKSPACE_TAB_KEYS, "computer")
  );
  const openWorkspaceTab = (tab: WorkspaceKey) => {
    setActiveTab(tab);
    saveStoredTab(WORKSPACE_TAB_STORAGE_KEY, tab);
  };
  return (
    <div className="npcink-v3-app">
      <Suspense fallback={<div role="status">正在加载工作区…</div>}>
        <div className="npcink-v3-workspace-switcher">
          <select aria-label="切换工作区" value={activeTab} onChange={(event) => openWorkspaceTab(workspaceKey(event.target.value))}>
            {WORKSPACE_ITEMS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <Tabs
          activeKey={activeTab}
          className="npcink-v3-workspace-tabs"
          tabBarGutter={18}
          onChange={(key) => openWorkspaceTab(workspaceKey(key))}
          items={WORKSPACE_ITEMS}
        />
      </Suspense>
    </div>
  );
};

export default InventoryAdmin;

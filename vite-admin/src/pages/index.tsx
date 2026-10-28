import { Tabs } from "antd";
import { lazy, Suspense, useState } from "react";
import { WORKSPACE_TAB_STORAGE_KEY } from "@/pages/shared/options";
import { loadStoredTab, saveStoredTab } from "@/pages/shared/storage";

const AssetWorkspace = lazy(() => import("./assets/AssetWorkspace").then((module) => ({ default: module.AssetWorkspace })));
const AnalysisWorkspace = lazy(() => import("./analysis/AnalysisWorkspace").then((module) => ({ default: module.AnalysisWorkspace })));
const ChangeWorkspace = lazy(() => import("./events/ChangeWorkspace").then((module) => ({ default: module.ChangeWorkspace })));
const SettingsWorkspace = lazy(() => import("./settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })));
const DataToolsWorkspace = lazy(() => import("./tools/DataToolsWorkspace").then((module) => ({ default: module.DataToolsWorkspace })));

export const WORKSPACE_TAB_KEYS = ["computer", "custom", "events", "analysis", "tools", "settings"] as const;

export const InventoryAdmin = () => {
  const [activeTab, setActiveTab] = useState<(typeof WORKSPACE_TAB_KEYS)[number]>(() =>
    loadStoredTab(WORKSPACE_TAB_STORAGE_KEY, WORKSPACE_TAB_KEYS, "computer")
  );
  const openWorkspaceTab = (tab: (typeof WORKSPACE_TAB_KEYS)[number]) => {
    setActiveTab(tab);
    saveStoredTab(WORKSPACE_TAB_STORAGE_KEY, tab);
  };
  return (
    <div className="npcink-v3-app">
      <Suspense fallback={<div role="status">正在加载工作区…</div>}>
        <Tabs
          activeKey={activeTab}
          className="npcink-v3-workspace-tabs"
          onChange={(key) => {
            const nextKey = WORKSPACE_TAB_KEYS.includes(key as (typeof WORKSPACE_TAB_KEYS)[number])
              ? (key as (typeof WORKSPACE_TAB_KEYS)[number])
              : "computer";
            openWorkspaceTab(nextKey);
          }}
          items={[
            {
              key: "computer",
              label: "电脑设备",
              children: <AssetWorkspace initialScope="computer" title="电脑资产" />,
            },
            {
              key: "custom",
              label: "自定义设备",
              children: <AssetWorkspace initialScope="other" title="自定义资产" />,
            },
            {
              key: "events",
              label: "变更数据",
              children: <ChangeWorkspace />,
            },
            {
              key: "analysis",
              label: "分析",
              children: <AnalysisWorkspace />,
            },
            {
              key: "tools",
              label: "数据工具",
              children: <DataToolsWorkspace />,
            },
            {
              key: "settings",
              label: "设置",
              children: <SettingsWorkspace />,
            },
          ]}
        />
      </Suspense>
    </div>
  );
};

export default InventoryAdmin;

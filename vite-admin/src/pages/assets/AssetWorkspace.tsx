import { lazy } from "react";
import { DeferredPanel } from "@/components/DeferredPanel";
import { archiveAsset, batchAssets, createAsset, getAssets, getSettings, updateAsset } from "@/services/v3";
import type { Asset, AssetInput, AssetType } from "@/type/v3";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { AssetCard } from "@/pages/assets/AssetCard";
import { AssetLayoutMode, bulkUpdateChanges, countStatus } from "@/pages/shared/assets";
import { initialAssetsForParams, readCachedAssetList, writeCachedAssetList } from "@/pages/shared/cache";
import { normalizeDepartmentList } from "@/pages/shared/departments";
import { assetUpdateDateText, isComputerAsset } from "@/pages/shared/finance";
import {
  ASSET_LAYOUT_MODE_STORAGE_KEY,
  ASSET_SCOPE_OPTIONS,
  ASSET_TYPES,
  AssetScope,
  COMPUTER_DEVICE_TYPE_OPTIONS,
  CUSTOM_PURCHASE_PLATFORM_OPTIONS,
  DEFAULT_CUSTOM_CATEGORIES,
  FINANCIAL_DATA_STATUS_OPTIONS,
  FinancialDataStatus,
  STATUS_OPTIONS,
  SavedAssetFilter,
} from "@/pages/shared/options";
import {
  assetTypeLabel,
  computerDeviceType,
  fieldText,
  highlightText,
  statusColor,
  statusLabel,
} from "@/pages/shared/presentation";
import { loadSavedFilters, loadStoredTab, saveFilters, saveStoredTab } from "@/pages/shared/storage";

const { Text } = Typography;

const AssetExportModal = lazy(() => import("@/pages/assets/AssetExportModal").then((module) => ({ default: module.AssetExportModal })));
const AssetFormModal = lazy(() => import("@/pages/assets/AssetFormModal").then((module) => ({ default: module.AssetFormModal })));
const BulkEditModal = lazy(() => import("@/pages/assets/BulkEditModal").then((module) => ({ default: module.BulkEditModal })));
const DetailDrawer = lazy(() => import("@/pages/assets/DetailDrawer").then((module) => ({ default: module.DetailDrawer })));

export interface AssetWorkspaceProps {
  initialScope?: AssetScope;
  title?: string;
}

export const AssetWorkspace = ({
  initialScope = "computer",
  title,
}: AssetWorkspaceProps) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const assetScope = initialScope;
  const [assetType, setAssetType] = useState<AssetType | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [purchasePlatform, setPurchasePlatform] = useState<string | undefined>();
  const [financialDataStatus, setFinancialDataStatus] = useState<FinancialDataStatus | undefined>();
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [assetLayoutMode, setAssetLayoutMode] = useState<AssetLayoutMode>(() =>
    loadStoredTab(ASSET_LAYOUT_MODE_STORAGE_KEY, ["compact", "spacious"] as const, "spacious")
  );
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const [savedFilters, setSavedFilters] = useState<SavedAssetFilter[]>(loadSavedFilters);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const queryParams = useMemo(
    () => ({
      page,
      pageSize,
      search,
      assetScope,
      assetType: assetScope === "computer" ? undefined : assetType,
      status,
      category: assetScope !== "all" ? category : undefined,
      purchasePlatform: assetScope === "other" ? purchasePlatform : undefined,
      financialDataStatus: assetScope === "other" ? undefined : financialDataStatus,
      sortBy: "latestObserved" as const,
    }),
    [assetScope, assetType, category, financialDataStatus, page, pageSize, purchasePlatform, search, status]
  );
  const initialAssetsData = useMemo(
    () => initialAssetsForParams(queryParams) || readCachedAssetList(queryParams),
    [queryParams]
  );
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const assetsQuery = useQuery(["v3-assets", queryParams], () => getAssets(queryParams), {
    initialData: initialAssetsData,
    keepPreviousData: true,
    onSuccess: (result) => {
      if (result) {
        writeCachedAssetList(queryParams, result);
      }
    },
  });

  useEffect(() => {
    setSelectedUuids(new Set());
  }, [assetScope, assetType, category, financialDataStatus, page, pageSize, purchasePlatform, search, status]);

  useEffect(() => {
    if (!batchMode) {
      setSelectedUuids(new Set());
    }
  }, [batchMode]);

  const createMutation = useMutation(createAsset, {
    onSuccess: (asset) => {
      setAssetModalOpen(false);
      setEditingAsset(null);
      setSelectedUuid(asset.uuid);
      queryClient.invalidateQueries(["v3-assets"]);
      message.success("资产已创建");
    },
  });
  const updateMutation = useMutation(
    ({ uuid, input }: { uuid: string; input: AssetInput }) => updateAsset(uuid, input),
    {
      onSuccess: (asset) => {
        setAssetModalOpen(false);
        setEditingAsset(null);
        setSelectedUuid(asset.uuid);
        queryClient.invalidateQueries(["v3-assets"]);
        queryClient.invalidateQueries(["v3-asset", asset.uuid]);
        queryClient.invalidateQueries(["v3-asset-events", asset.uuid]);
        message.success("资产已更新");
      },
    }
  );
  const archiveMutation = useMutation(archiveAsset, {
    onSuccess: (asset) => {
      queryClient.invalidateQueries(["v3-assets"]);
      queryClient.invalidateQueries(["v3-asset", asset.uuid]);
      queryClient.invalidateQueries(["v3-asset-events", asset.uuid]);
      message.success("资产已归档");
    },
  });
  const batchArchiveMutation = useMutation(
    async (uuids: string[]) => {
      return batchAssets("archive", uuids, undefined, {
        source: "asset_batch_archive",
        message: "批量归档资产",
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["v3-assets"]);
        setSelectedUuids(new Set());
        setBatchMode(false);
        message.success("已归档所选资产");
      },
    }
  );
  const batchUpdateMutation = useMutation(
    async ({ targets, input }: { targets: Asset[]; input: AssetInput }) => {
      const changedTargets = targets
        .map((asset) => ({ asset, changes: bulkUpdateChanges(asset, input) }))
        .filter((item) => item.changes.length > 0);

      if (!changedTargets.length) {
        message.warning("没有字段发生变化");
        return 0;
      }

      const labels = Array.from(new Set(changedTargets.flatMap(({ changes }) => changes.map((change) => change.label))));
      const result = await batchAssets(
        "update",
        changedTargets.map(({ asset }) => asset.uuid),
        input,
        { source: "asset_batch_edit", message: `批量修改：${labels.join("、")}` }
      );
      return result.updated;
    },
    {
      onSuccess: (changedCount) => {
        if (changedCount === 0) {
          return;
        }
        queryClient.invalidateQueries(["v3-assets"]);
        queryClient.invalidateQueries(["v3-events"]);
        queryClient.invalidateQueries(["v3-analysis-observations"]);
        setBulkModalOpen(false);
        setSelectedUuids(new Set());
        setBatchMode(false);
        message.success(`已批量修改 ${changedCount} 条资产并写入变更记录`);
      },
    }
  );

  const assets = assetsQuery.data?.data || [];
  const pagination = assetsQuery.data?.pagination;
  const departmentOptions = useMemo(
    () => normalizeDepartmentList(settingsQuery.data?.departments || []),
    [settingsQuery.data?.departments]
  );
  const selectedCount = selectedUuids.size;
  const allSelected = assets.length > 0 && assets.every((asset) => selectedUuids.has(asset.uuid));
  const compactLayout = assetLayoutMode === "compact";
  const activeCount = countStatus(assets, "active");
  const maintenanceCount = countStatus(assets, "maintenance");
  const activeScopeLabel =
    title || ASSET_SCOPE_OPTIONS.find((item) => item.value === assetScope)?.label || "资产";
  const workspaceSavedFilters = savedFilters.filter((filter) => filter.assetScope === initialScope);
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set([...DEFAULT_CUSTOM_CATEGORIES, ...assets.map((asset) => asset.category).filter(Boolean)]))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [assets]
  );

  const toggleSelect = (uuid: string) => {
    setSelectedUuids((previous) => {
      const next = new Set(previous);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUuids(new Set());
      return;
    }
    setSelectedUuids(new Set(assets.map((asset) => asset.uuid)));
  };

  const selectedAssets = assets.filter((asset) => selectedUuids.has(asset.uuid));
  const bulkCategoryMode = selectedAssets.length > 0 && selectedAssets.every(isComputerAsset)
    ? "computer"
    : selectedAssets.length > 0 && selectedAssets.every((asset) => !isComputerAsset(asset))
      ? "custom"
      : "mixed";
  const selectedAsset = selectedUuid ? assets.find((asset) => asset.uuid === selectedUuid) || null : null;

  const applySavedFilter = (id: string) => {
    const filter = savedFilters.find((item) => item.id === id);
    if (!filter || filter.assetScope !== initialScope) {
      message.error("这个筛选属于其他资产工作区，无法在当前页面应用");
      return;
    }
    setAssetType(filter.assetType);
    setStatus(filter.status);
    setCategory(filter.category);
    setPurchasePlatform(filter.purchasePlatform);
    setFinancialDataStatus(filter.financialDataStatus);
    setSearch(filter.search || "");
    setSearchDraft(filter.search || "");
    setPage(1);
  };

  const saveCurrentFilter = () => {
    const name = window.prompt("筛选名称", activeScopeLabel);
    if (!name) {
      return;
    }
    const next = [
      ...savedFilters.filter((item) => item.name !== name),
      {
        id: `${Date.now()}`,
        name,
        assetScope: initialScope,
        assetType,
        status,
        search,
        category,
        purchasePlatform,
        financialDataStatus,
      },
    ];
    setSavedFilters(next);
    saveFilters(next);
    message.success("筛选已保存");
  };

  const columns: ColumnsType<Asset> = [
    {
      title: "资产编号",
      dataIndex: "assetNumber",
      width: 170,
      render: (value: string) => <Text code>{highlightText(value, search, true)}</Text>,
    },
    {
      title: "资产名称",
      dataIndex: "name",
      render: (value: string, asset) => (
        <Button
          type="link"
          className="npcink-v3-link"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedUuid(asset.uuid);
          }}
        >
          {highlightText(value || "未命名资产", search)}
        </Button>
      ),
    },
    {
      title: "资产类型",
      dataIndex: "assetType",
      width: 120,
      render: assetTypeLabel,
    },
    { title: "使用人", dataIndex: "ownerName", width: 120, render: (value) => highlightText(value, search) },
    { title: "部门", dataIndex: "department", width: 140, render: (value) => highlightText(value, search) },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={statusColor[value] || "default"}>{statusLabel(value)}</Tag>
      ),
    },
    {
      title: assetScope === "computer" ? "类型" : assetScope === "other" ? "分类" : "类型 / 分类",
      dataIndex: "category",
      width: 130,
      render: (value: string, asset) => fieldText(isComputerAsset(asset) ? computerDeviceType(value) : value),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (_value, asset) => assetUpdateDateText(asset),
    },
    {
      title: "操作",
      width: 96,
      render: (_, asset) => (
        <Button
          type="link"
          className="npcink-v3-link"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedUuid(asset.uuid);
          }}
        >
          查看
        </Button>
      ),
    },
  ];

  const submitAsset = async (values: AssetInput) => {
    if (editingAsset) {
      await updateMutation.mutateAsync({ uuid: editingAsset.uuid, input: values });
      return;
    }
    await createMutation.mutateAsync(values);
  };

  const openCreateModal = () => {
    setEditingAsset(null);
    setAssetModalOpen(true);
  };

  const submitSearch = () => {
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const updateSearchDraft = (value: string) => {
    setSearchDraft(value);
    if (!value && search) {
      setPage(1);
      setSearch("");
    }
  };

  const confirmArchive = (asset: Asset) => {
    Modal.confirm({
      title: "归档这台资产？",
      content: (
        <div>
          <p>{asset.assetNumber || asset.uuid} 将退出日常资产管理。</p>
          <p>归档后不参与列表、统计、分析和资产表格导出；历史数据与资产编号仍会保留。</p>
          <p><strong>归档后可通过“已归档”筛选找到资产，并在详情设置中把状态恢复为在用。</strong></p>
        </div>
      ),
      okText: "确认归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => archiveMutation.mutateAsync(asset.uuid),
    });
  };

  const confirmBatchArchive = () => {
    if (selectedCount === 0) {
      message.warning("请先选择要归档的资产");
      return;
    }
    const targets = Array.from(selectedUuids);
    Modal.confirm({
      title: "归档所选资产？",
      content: (
        <div>
          <p>已选 {selectedCount} 条资产，将统一退出日常资产管理。</p>
          <p>归档后不参与列表、统计、分析和资产表格导出；历史数据与资产编号仍会保留。</p>
          <p><strong>归档后可通过“已归档”筛选找到资产，并在详情设置中恢复状态。</strong></p>
        </div>
      ),
      okText: "确认归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => batchArchiveMutation.mutateAsync(targets),
    });
  };

  const handleTableChange = (nextPagination: TablePaginationConfig) => {
    setPage(nextPagination.current || 1);
    setPageSize(nextPagination.pageSize || 20);
  };

  const toggleAssetLayoutMode = () => {
    setAssetLayoutMode((value) => {
      const next = value === "compact" ? "spacious" : "compact";
      saveStoredTab(ASSET_LAYOUT_MODE_STORAGE_KEY, next);
      return next;
    });
  };

  return (
    <div className={`npcink-v3-section${viewMode === "card" && compactLayout ? " is-compact-card-layout" : ""}`}>
      <div className="npcink-v3-toolbar-shell is-plain">
        <div className="npcink-v3-toolbar-title">
          <Text strong>{activeScopeLabel}</Text>
          <Text type="secondary">
            共 {pagination?.totalItems ?? "-"} 条，当前页在用 {activeCount}，维护 {maintenanceCount}
          </Text>
        </div>
        <div className="npcink-v3-toolbar">
          <Select
            allowClear
            placeholder={assetScope === "other" ? "设备状态" : "状态"}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            className="npcink-v3-filter"
          />
          {assetScope === "other" ? (
            <>
              <Select
                allowClear
                placeholder="分类"
                options={categoryOptions}
                value={category}
                onChange={(value) => {
                  setPage(1);
                  setCategory(value);
                }}
                className="npcink-v3-filter"
              />
              <Select
                allowClear
                placeholder="采购平台"
                options={CUSTOM_PURCHASE_PLATFORM_OPTIONS}
                value={purchasePlatform}
                onChange={(value) => {
                  setPage(1);
                  setPurchasePlatform(value);
                }}
                className="npcink-v3-filter"
              />
            </>
          ) : assetScope === "computer" ? (
            <Select
              allowClear
              placeholder="类型"
              options={COMPUTER_DEVICE_TYPE_OPTIONS}
              value={category}
              onChange={(value) => {
                setPage(1);
                setCategory(value);
              }}
              className="npcink-v3-filter"
            />
          ) : (
            <Select
              allowClear
              placeholder="资产类型"
              options={ASSET_TYPES}
              value={assetType}
              onChange={(value) => {
                setPage(1);
                setAssetType(value);
              }}
              className="npcink-v3-filter"
            />
          )}
          {assetScope !== "other" ? (
            <Select
              allowClear
              placeholder="财务资料"
              options={FINANCIAL_DATA_STATUS_OPTIONS}
              value={financialDataStatus}
              onChange={(value) => {
                setPage(1);
                setFinancialDataStatus(value);
              }}
              className="npcink-v3-filter"
            />
          ) : null}
          <div className="npcink-v3-toolbar-search">
            <Input
              allowClear
              value={searchDraft}
              placeholder={assetScope === "other" ? "搜索姓名、订单号、产品名称" : "搜索编号、名称、使用人、部门"}
              onChange={(event) => updateSearchDraft(event.target.value)}
              onPressEnter={submitSearch}
            />
            <Button
              aria-label="搜索资产"
              icon={<SearchOutlined />}
              onClick={submitSearch}
            />
          </div>
          <Space.Compact>
            <Button
              type={viewMode === "card" ? "primary" : "default"}
              onClick={() => setViewMode("card")}
            >
              卡片
            </Button>
            <Button
              type={viewMode === "table" ? "primary" : "default"}
              onClick={() => setViewMode("table")}
            >
              列表
            </Button>
          </Space.Compact>
          {assetScope === "other" ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新增
            </Button>
          ) : null}
          <Dropdown
            menu={{
              items: [
                { key: "export", label: "导出表格" },
                { key: "save-filter", label: "保存筛选" },
                { key: "batch", label: batchMode ? "退出批量模式" : "批量模式" },
                ...(viewMode === "card"
                  ? [{ key: "layout", label: compactLayout ? "舒展模式" : "紧凑模式" }]
                  : []),
                ...workspaceSavedFilters.map((filter) => ({
                  key: `filter:${filter.id}`,
                  label: `筛选：${filter.name}`,
                })),
              ],
              onClick: ({ key }) => {
                if (key === "export") {
                  setExportModalOpen(true);
                } else if (key === "save-filter") {
                  saveCurrentFilter();
                } else if (key === "batch") {
                  setBatchMode((value) => !value);
                } else if (key === "layout") {
                  toggleAssetLayoutMode();
                } else if (key.startsWith("filter:")) {
                  applySavedFilter(key.replace("filter:", ""));
                }
              },
            }}
          >
            <Button>更多</Button>
          </Dropdown>
        </div>
      </div>
      {batchMode ? (
        <div className="npcink-v3-batch-actions">
          <Space wrap>
            <Text type="secondary">已选 {selectedCount} 条</Text>
            <Button onClick={toggleSelectAll} disabled={!assets.length}>
              {allSelected ? "取消全选" : "全选当前页"}
            </Button>
            <Button
              danger
              disabled={selectedCount === 0}
              loading={batchArchiveMutation.isLoading}
              onClick={confirmBatchArchive}
            >
              归档已选
            </Button>
            <Button disabled={selectedCount === 0} onClick={() => setBulkModalOpen(true)}>
              批量修改
            </Button>
            <Button disabled={selectedCount === 0} onClick={() => setExportModalOpen(true)}>
              导出已选
            </Button>
            <Button onClick={() => setBatchMode(false)}>退出批量</Button>
          </Space>
        </div>
      ) : null}

      {assetsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={`${activeScopeLabel}加载失败`}
          description="当前页面不能判断是否真的没有资产，也不会开放批量操作。"
          action={<Button onClick={() => assetsQuery.refetch()}>重试</Button>}
        />
      ) : null}

      {!assetsQuery.isError && viewMode === "card" ? (
        <div className="npcink-v3-card-surface">
          {assetsQuery.isLoading && !assets.length ? (
            <Table loading pagination={false} showHeader={false} />
          ) : assets.length ? (
            <div className="npcink-v3-card-grid">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.uuid}
                  asset={asset}
                  searchKeyword={search}
                  onOpen={() => setSelectedUuid(asset.uuid)}
                  selectable={batchMode}
                  selected={selectedUuids.has(asset.uuid)}
                  onSelect={() => toggleSelect(asset.uuid)}
                />
              ))}
            </div>
          ) : (
            <div className="npcink-v3-empty-state">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  assetScope === "other"
                    ? "暂无自定义资产，可新增自定义资产或在数据工具中导入标准表格"
                    : "暂无电脑资产，可在数据工具中导入标准表格或等待客户端采集"
                }
              />
            </div>
          )}
          <div className="npcink-v3-card-pagination">
            <Text type="secondary">共 {pagination?.totalItems || 0} 条资产</Text>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={pagination?.totalItems || 0}
              showSizeChanger
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              }}
            />
          </div>
        </div>
      ) : !assetsQuery.isError ? (
        <Table
          rowKey="uuid"
          size="middle"
          columns={columns}
          dataSource={assets}
          loading={assetsQuery.isLoading && !assets.length}
          onChange={handleTableChange}
          rowSelection={
            batchMode
              ? {
                  selectedRowKeys: Array.from(selectedUuids),
                  onChange: (keys) => setSelectedUuids(new Set(keys.map(String))),
                }
              : undefined
          }
          onRow={(asset) => ({
            onClick: () => {
              if (batchMode) {
                toggleSelect(asset.uuid);
                return;
              }
              setSelectedUuid(asset.uuid);
            },
          })}
          scroll={{ x: 1110 }}
          pagination={{
            current: page,
            pageSize,
            total: pagination?.totalItems || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条资产`,
          }}
          locale={{ emptyText: <Empty description="暂无资产" /> }}
        />
      ) : null}

      <DeferredPanel open={Boolean(selectedUuid)}>
      <DetailDrawer
        uuid={selectedUuid}
        open={Boolean(selectedUuid)}
        initialAsset={selectedAsset}
        departmentOptions={departmentOptions}
        onClose={() => setSelectedUuid(null)}
        onArchive={confirmArchive}
      />
      </DeferredPanel>
      <DeferredPanel open={assetModalOpen}>
      <AssetFormModal
        asset={editingAsset}
        open={assetModalOpen}
        departmentOptions={departmentOptions}
        onClose={() => setAssetModalOpen(false)}
        onSubmit={submitAsset}
      />
      </DeferredPanel>
      <DeferredPanel open={bulkModalOpen}>
      <BulkEditModal
        open={bulkModalOpen}
        count={selectedCount}
        loading={batchUpdateMutation.isLoading}
        categoryMode={bulkCategoryMode}
        departmentOptions={departmentOptions}
        onClose={() => setBulkModalOpen(false)}
        onSubmit={async (input) => {
          await batchUpdateMutation.mutateAsync({ targets: selectedAssets, input });
        }}
      />
      </DeferredPanel>
      <DeferredPanel open={exportModalOpen}>
      <AssetExportModal
        open={exportModalOpen}
        currentScopeLabel={activeScopeLabel}
        currentQueryParams={queryParams}
        currentTotal={pagination?.totalItems}
        selectedAssets={selectedAssets}
        onClose={() => setExportModalOpen(false)}
      />
      </DeferredPanel>
    </div>
  );
};

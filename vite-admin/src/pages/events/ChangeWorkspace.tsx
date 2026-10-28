import { getEvents } from "@/services/v3";
import type { AssetEvent } from "@/type/v3";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import {
  changeActorName,
  changeAssetLabelParts,
  changeContentText,
  changeTypeLabel,
} from "@/pages/shared/events";
import { formatDate } from "@/pages/shared/presentation";

const { Text } = Typography;

export const ChangeWorkspace = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [eventMode, setEventMode] = useState<"manual" | "auto">("auto");
  const [hideNames, setHideNames] = useState(false);
  const queryParams = useMemo(
    () => ({ page, pageSize, search, eventMode }),
    [eventMode, page, pageSize, search]
  );
  const eventsQuery = useQuery(["v3-events", queryParams], () => getEvents(queryParams), {
    keepPreviousData: true,
  });
  const events = eventsQuery.data?.data || [];
  const pagination = eventsQuery.data?.pagination;
  const typeFilters = useMemo(
    () =>
      Array.from(new Set(events.map((event) => changeTypeLabel(event)).filter((value) => value && value !== "-")))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ text: value, value })),
    [events]
  );

  const columns: ColumnsType<AssetEvent> = [
    {
      title: "序号",
      width: 96,
      render: (_value, _event, index) => {
        const total = pagination?.totalItems || 0;
        return total ? total - ((page - 1) * pageSize + index) : index + 1;
      },
    },
    {
      title: "姓名",
      width: 160,
      render: (_, event) => (
        <span>{hideNames ? "已隐藏" : changeActorName(event)}</span>
      ),
    },
    {
      title: "类型",
      width: 140,
      filters: typeFilters,
      onFilter: (value, event) => changeTypeLabel(event) === value,
      render: (_, event) => changeTypeLabel(event),
    },
    {
      title: "内容",
      render: (_, event) => <Text className="npcink-v3-change-content">{changeContentText(event)}</Text>,
    },
    {
      title: "设备",
      width: 260,
      render: (_, event) => {
        const asset = changeAssetLabelParts(event.asset);
        return (
          <span>
            <span>{hideNames && asset.name !== "-" ? "已隐藏" : asset.name}</span>
            {asset.suffix ? ` _ ${asset.suffix}` : ""}
          </span>
        );
      },
    },
    {
      title: "日期",
      dataIndex: "createdAt",
      width: 190,
      defaultSortOrder: "descend",
      sorter: (a, b) =>
        new Date(a.createdAt.replace(" ", "T")).getTime() - new Date(b.createdAt.replace(" ", "T")).getTime(),
      render: formatDate,
    },
  ];

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-change-layout">
        <div className="npcink-v3-change-actions">
          <Button
            onClick={() => {
              setPage(1);
              setEventMode((value) => (value === "manual" ? "auto" : "manual"));
            }}
          >
            {eventMode === "manual" ? "手动变更数据" : "自动变更数据"}
          </Button>
          <Button onClick={() => setHideNames((value) => !value)}>
            {hideNames ? "显示姓名" : "隐藏姓名"}
          </Button>
        </div>
        <div className="npcink-v3-change-filters">
          <Input.Search
            allowClear
            placeholder="搜索资产、字段或说明"
            onSearch={(value) => {
              setPage(1);
              setSearch(value);
            }}
            className="npcink-v3-search"
          />
        </div>
      </div>
      {eventsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="变更记录加载失败"
          description="当前内容不是空数据，请重试获取真实记录。"
          action={<Button onClick={() => eventsQuery.refetch()}>重试</Button>}
        />
      ) : null}
      <Table
        rowKey="id"
        size="middle"
        className="npcink-v3-change-table"
        columns={columns}
        dataSource={eventsQuery.isError ? [] : events}
        loading={eventsQuery.isLoading || eventsQuery.isFetching}
        scroll={{ x: 980 }}
        pagination={{
          current: page,
          pageSize,
          total: pagination?.totalItems || 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条变更记录`,
        }}
        onChange={(nextPagination) => {
          setPage(nextPagination.current || 1);
          setPageSize(nextPagination.pageSize || 20);
        }}
        locale={{ emptyText: eventsQuery.isError ? null : <Empty description="暂无变更数据" /> }}
      />
    </div>
  );
};

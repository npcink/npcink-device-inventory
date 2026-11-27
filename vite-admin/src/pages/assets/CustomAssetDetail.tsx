import type { Asset } from "@/type/v3";
import { Alert, Button, Empty, Table, Tabs, Typography } from "antd";
import { CustomAssetSettingsPanel } from "@/pages/assets/AssetSettingsPanel";
import { customAssetInfo } from "@/pages/shared/assets";
import { AutoChangeRow } from "@/pages/shared/events";
import { fieldText, formatDate } from "@/pages/shared/presentation";

export interface CustomAssetDetailProps {
  asset: Asset;
  autoRecordRows: AutoChangeRow[];
  onUpdated: (asset: Asset) => void;
  onArchive: (asset: Asset) => void;
  readOnly?: boolean;
  recordsLoading?: boolean;
  recordsError?: boolean;
  recordsTruncated?: boolean;
  onRetryRecords?: () => void;
}

export const CustomAssetDetail = ({
  asset,
  autoRecordRows,
  onUpdated,
  onArchive,
  readOnly = false,
  recordsLoading = false,
  recordsError = false,
  recordsTruncated = false,
  onRetryRecords,
}: CustomAssetDetailProps) => {
  const info = customAssetInfo(asset);
  const productLink = /^https?:\/\//i.test(info.link) ? info.link : "";
  const infoItem = (label: string, value: unknown, tone: "default" | "primary" | "status" = "default") => (
    <div className={`npcink-v3-custom-info-item is-${tone}`}>
      <span>{label}</span>
      <strong>{fieldText(value)}</strong>
    </div>
  );

  return (
    <Tabs
      defaultActiveKey="info"
      items={[
        {
          key: "info",
          label: "设备信息",
          children: (
            <div className="npcink-v3-custom-detail">
              <div className="npcink-v3-custom-detail-head">
                <h3>{info.title}</h3>
                {productLink ? (
                  <a href={productLink} target="_blank" rel="noreferrer">
                    {info.shopName || info.title}
                  </a>
                ) : (
                  <span>{info.shopName || "-"}</span>
                )}
              </div>
              <div className="npcink-v3-custom-detail-body">
                <div className="npcink-v3-custom-info-card">
                  <h4>设备信息</h4>
                  <div>
                    {infoItem("采购数量", info.quantityText)}
                    {infoItem("采购总价", info.priceText, "primary")}
                    {infoItem("当前状态", info.status, "status")}
                    {infoItem("设备分类", info.category)}
                  </div>
                </div>
                <div className="npcink-v3-custom-info-card">
                  <h4>采购信息</h4>
                  <div>
                    {infoItem("采购人员", info.purchaser)}
                    {infoItem("设备编号", info.number, "primary")}
                    {infoItem("使用人 / 责任人", info.usage, "primary")}
                    {infoItem("部门", asset.department)}
                    {infoItem("设备用途", info.purpose)}
                  </div>
                </div>
                <div className="npcink-v3-custom-info-card is-wide">
                  <h4>订单信息</h4>
                  <div className="npcink-v3-custom-order-grid">
                    {infoItem("采购单号", info.orderNo)}
                    {infoItem("下单时间", formatDate(info.orderTime))}
                    {infoItem("采购平台", info.platform)}
                    {infoItem("支付方式", info.payMethod)}
                  </div>
                </div>
              </div>
            </div>
          ),
        },
        {
          key: "records",
          label: "自动记录",
          children: (
            <>
            {recordsError ? <Alert type="error" showIcon message="变更记录加载失败" action={<Button onClick={onRetryRecords}>重试</Button>} /> : null}
            {recordsTruncated ? <Typography.Text type="secondary">此处展示最近 30 条记录中的自动变更；更多历史请到“变更数据”查看。</Typography.Text> : null}
            <Table
              loading={recordsLoading}
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
              dataSource={recordsError ? [] : autoRecordRows}
              pagination={{ defaultPageSize: 10, responsive: true, hideOnSinglePage: true }}
              locale={{ emptyText: recordsError ? null : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无自动变更记录" /> }}
            />
            </>
          ),
        },
        ...(!readOnly ? [{
          key: "settings",
          label: "信息修改",
          children: (
            <CustomAssetSettingsPanel
              asset={asset}
              onUpdated={onUpdated}
              onArchive={onArchive}
            />
          ),
        }] : []),
      ]}
    />
  );
};

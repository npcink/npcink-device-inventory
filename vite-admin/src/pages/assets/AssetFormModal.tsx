import { getSettings } from "@/services/v3";
import type { Asset, AssetInput } from "@/type/v3";
import { getRecord } from "@/utils/hardwareAudit";
import { useQuery } from "@tanstack/react-query";
import { Form, Input, InputNumber, Modal, Radio, Select } from "antd";
import { useEffect, useMemo } from "react";
import { customAssetInfo } from "@/pages/shared/assets";
import {
  DEFAULT_DEPARTMENT,
  departmentSelectOptions,
  isAllowedDepartment,
  normalizeDepartmentList,
} from "@/pages/shared/departments";
import {
  FinancialResidualMode,
  calculateFinancialResidualValue,
  financialResidualMode,
  isComputerAsset,
} from "@/pages/shared/finance";
import { ASSET_TYPES, COMPUTER_DEVICE_TYPE_OPTIONS, EDITABLE_STATUS_OPTIONS } from "@/pages/shared/options";
import { computerDeviceType, formatMoney } from "@/pages/shared/presentation";

export interface AssetFormModalProps {
  asset: Asset | null;
  open: boolean;
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

export type AssetFormValues = Omit<AssetInput, "metadata"> & {
  financialResidualMode?: FinancialResidualMode;
  purpose?: string;
  numbers?: number;
  purchaser?: string;
  shopName?: string;
  link?: string;
  order?: string;
  orderTime?: string;
  platform?: string;
  payMethod?: string;
};

export const assetFormValuesToInput = (values: AssetFormValues, asset: Asset | null): AssetInput => {
  const metadata = getRecord(asset?.metadata);
  const existingPurchase = getRecord(metadata.purchase);
  const existingFinance = getRecord(metadata.finance);
  return {
    assetType: values.assetType,
    assetNumber: values.assetNumber,
    name: values.name,
    ownerName: values.ownerName,
    department: values.department,
    status: values.status,
    category: values.category,
    purchasePrice: Number(values.purchasePrice || 0),
    secondHandMarketValue: Number(values.secondHandMarketValue || 0),
    financialResidualValue: Number(values.financialResidualValue || 0),
    metadata: {
      ...metadata,
      purpose: values.purpose || "",
      purchase: {
        ...existingPurchase,
        title: values.name || "",
        total: Number(values.purchasePrice || 0),
        numbers: Number(values.numbers || 0),
        purchaser: values.purchaser || "",
        shop_name: values.shopName || "",
        link: values.link || "",
        order: values.order || "",
        order_time: values.orderTime || "",
        platform: values.platform || "",
        pay_method: values.payMethod || "",
      },
      finance: {
        ...existingFinance,
        financial_residual_mode: values.financialResidualMode || "auto",
      },
    },
  };
};

export const AssetFormModal = ({ asset, open, departmentOptions = [], onClose, onSubmit }: AssetFormModalProps) => {
  const [form] = Form.useForm<AssetFormValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const customInfo = useMemo(() => (asset ? customAssetInfo(asset) : null), [asset]);
  const showCustomFields = !asset || !isComputerAsset(asset);
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      Number(watchedPurchasePrice || 0),
      String(watchedPurchaseDate || asset?.createdAt || ""),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset?.createdAt, settingsQuery.data, watchedPurchaseDate, watchedPurchasePrice]);

  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      assetType: asset?.assetType || "custom",
      assetNumber: asset?.assetNumber || "",
      name: asset?.name || "",
      ownerName: asset?.ownerName || "",
      department: asset?.department || DEFAULT_DEPARTMENT,
      category: asset && isComputerAsset(asset) ? computerDeviceType(asset.category) : asset?.category || "",
      status: asset?.status || "active",
      purchasePrice: asset?.purchasePrice || 0,
      secondHandMarketValue: asset?.secondHandMarketValue || 0,
      financialResidualValue: asset?.financialResidualValue || 0,
      financialResidualMode: financialResidualMode(asset),
      purpose: customInfo?.purpose || "",
      numbers: Number(customInfo?.quantity || 1) || 1,
      purchaser: customInfo?.purchaser || "",
      shopName: customInfo?.shopName || "",
      link: customInfo?.link || "",
      order: customInfo?.orderNo || "",
      orderTime: customInfo?.orderTime || "",
      platform: customInfo?.platform || "",
      payMethod: customInfo?.payMethod || "",
    });
  }, [asset, customInfo, form, open]);

  return (
    <Modal
      title={asset ? "编辑资产" : "采购信息录入"}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={asset ? "保存" : "确认录入"}
      cancelText="取消"
      destroyOnClose
      width={760}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(assetFormValuesToInput(values, asset))}
        preserve={false}
        className="npcink-v3-asset-form"
      >
        {showCustomFields ? (
          <Form.Item name="assetType" hidden>
            <Input />
          </Form.Item>
        ) : null}
        <div className="npcink-v3-asset-form-section">
          <h4>设备信息</h4>
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: "请输入设备名称" }]}>
            <Input placeholder="例如：科沃顿 UPS C3K" />
          </Form.Item>
          {showCustomFields ? (
            <Form.Item name="purpose" label="设备用途">
              <Input placeholder="例如：机房备用电源" />
            </Form.Item>
          ) : null}
          <div className="npcink-v3-asset-form-grid">
            <Form.Item name="assetNumber" label="设备编号">
              <Input placeholder="留空自动生成" />
            </Form.Item>
            {!showCustomFields ? (
              <Form.Item name="assetType" label="资产类型">
                <Select options={ASSET_TYPES} />
              </Form.Item>
            ) : null}
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item
              name="department"
              label="部门"
              extra="只能选择设置中维护的部门；未选择时会归入未分配。"
              rules={[
                {
                  validator: async (_, value) => {
                    if (!isAllowedDepartment(normalizedDepartmentOptions, value)) {
                      throw new Error("请选择设置中已有的部门");
                    }
                  },
                },
              ]}
            >
              <Select
                showSearch
                options={departmentSelectOptions(normalizedDepartmentOptions)}
                placeholder="选择部门"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
            <Form.Item name="category" label={showCustomFields ? "分类" : "设备类型"}>
              {showCustomFields ? (
                <Input placeholder="例如：显卡、手机、机房设备" />
              ) : (
                <Select
                  allowClear
                  options={COMPUTER_DEVICE_TYPE_OPTIONS}
                  placeholder="选择设备类型"
                  popupMatchSelectWidth={false}
                />
              )}
            </Form.Item>
            <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
          </div>
        </div>

        {showCustomFields ? (
          <>
            <div className="npcink-v3-asset-form-section">
              <h4>采购信息</h4>
              <div className="npcink-v3-asset-form-grid">
                <Form.Item name="numbers" label="数量">
                  <InputNumber min={0} precision={0} className="npcink-v3-number" addonAfter="个" />
                </Form.Item>
                <Form.Item name="purchasePrice" label="总计">
                  <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
                <Form.Item name="purchaser" label="采购人员">
                  <Input placeholder="负责购买此设备的人" />
                </Form.Item>
                <Form.Item name="secondHandMarketValue" label="二手市场价">
                  <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
                <Form.Item name="financialResidualMode" label="账面净值方式">
                  <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
                </Form.Item>
                <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
                  <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
                </Form.Item>
              </div>
            </div>

            <div className="npcink-v3-asset-form-section">
              <h4>订单信息</h4>
              <Form.Item name="shopName" label="店铺名称">
                <Input />
              </Form.Item>
              <Form.Item name="link" label="商品链接">
                <Input />
              </Form.Item>
              <div className="npcink-v3-asset-form-grid">
                <Form.Item name="order" label="单号">
                  <Input />
                </Form.Item>
                <Form.Item name="orderTime" label="时间">
                  <Input placeholder="例如：2026-06-26" />
                </Form.Item>
                <Form.Item name="platform" label="平台">
                  <Input placeholder="例如：淘宝、京东、闲鱼" />
                </Form.Item>
                <Form.Item name="payMethod" label="支付">
                  <Input placeholder="例如：支付宝、微信" />
                </Form.Item>
              </div>
            </div>
          </>
        ) : (
          <div className="npcink-v3-asset-form-grid">
            <Form.Item name="purchasePrice" label="购置价值">
              <InputNumber min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="secondHandMarketValue" label="二手市场价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="financialResidualMode" label="账面净值方式">
              <Radio.Group options={[{ label: "自动计算", value: "auto" }, { label: "手动设置", value: "manual" }]} />
            </Form.Item>
            <Form.Item name="financialResidualValue" label={watchedFinancialResidualMode === "manual" ? "手动账面净值" : "自动账面净值"}>
              <InputNumber disabled={watchedFinancialResidualMode !== "manual"} min={0} precision={2} className="npcink-v3-number" />
            </Form.Item>
          </div>
        )}
        <div className="npcink-v3-finance-summary">
          <span>
            系统估算账面净值：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}
          </span>
          <span>当前方式：{watchedFinancialResidualMode === "manual" ? "手动设置" : "自动计算"}</span>
        </div>
      </Form>
    </Modal>
  );
};

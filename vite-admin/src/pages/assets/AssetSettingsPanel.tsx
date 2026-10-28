import { getSettings, updateAsset } from "@/services/v3";
import type { Asset, AssetInput } from "@/type/v3";
import { assetHardwareContext, firstText, getRecord } from "@/utils/hardwareAudit";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Radio, Select, Tooltip, message } from "antd";
import dayjs from "dayjs";
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
  assetPurchaseDateText,
  calculateFinancialResidualValue,
  financialResidualMode,
} from "@/pages/shared/finance";
import {
  COMPUTER_DEVICE_TYPE_OPTIONS,
  DEFAULT_CUSTOM_CATEGORIES,
  EDITABLE_STATUS_OPTIONS,
} from "@/pages/shared/options";
import { computerDeviceType, formatDateInput, formatMoney } from "@/pages/shared/presentation";

export interface AssetSettingsPanelProps {
  asset: Asset;
  departmentOptions?: string[];
  onUpdated: (asset: Asset) => void;
  onArchive: (asset: Asset) => void;
}

export type AssetSettingsValues = AssetInput & {
  orderTime?: string;
  financialResidualMode?: FinancialResidualMode;
};

export const AssetSettingsPanel = ({ asset, departmentOptions = [], onUpdated, onArchive }: AssetSettingsPanelProps) => {
  const [form] = Form.useForm<AssetSettingsValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const settingsHardware = assetHardwareContext(asset);
  const primaryIp = firstText(settingsHardware.extracted.primaryIp, settingsHardware.manualHardware.ip);
  const normalizedDepartmentOptions = useMemo(
    () => normalizeDepartmentList(departmentOptions),
    [departmentOptions]
  );
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualValue = Form.useWatch("financialResidualValue", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const financialResidualValue = Number(watchedFinancialResidualValue ?? asset.financialResidualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((financialResidualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      purchasePrice,
      String(watchedPurchaseDate || asset.createdAt),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset.createdAt, purchasePrice, settingsQuery.data, watchedPurchaseDate]);
  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);
  const updateMutation = useMutation(
    (values: AssetSettingsValues) => {
      const metadata = getRecord(asset.metadata);
      const existingPurchase = getRecord(metadata.purchase);
      const existingFinance = getRecord(metadata.finance);
      return updateAsset(asset.uuid, {
        assetNumber: values.assetNumber,
        name: values.name ?? asset.name,
        ownerName: values.ownerName,
        department: values.department,
        status: values.status,
        category: values.category,
        purchasePrice: Number(values.purchasePrice || 0),
        secondHandMarketValue: Number(values.secondHandMarketValue || 0),
        financialResidualValue: Number(values.financialResidualValue || 0),
        metadata: {
          ...metadata,
          purchase: {
            ...existingPurchase,
            order_time: values.orderTime || "",
            total: Number(values.purchasePrice || 0),
          },
          finance: {
            ...existingFinance,
            financial_residual_mode: values.financialResidualMode || "auto",
          },
        },
      });
    },
    {
      onSuccess: (updated) => {
        onUpdated(updated);
        message.success("资产设置已保存");
      },
    }
  );

  useEffect(() => {
    form.setFieldsValue({
      assetNumber: asset.assetNumber,
      name: asset.name,
      ownerName: asset.ownerName,
      department: asset.department || DEFAULT_DEPARTMENT,
      status: asset.status,
      category: computerDeviceType(asset.category),
      purchasePrice: asset.purchasePrice,
      secondHandMarketValue: asset.secondHandMarketValue,
      financialResidualValue: asset.financialResidualValue,
      financialResidualMode: financialResidualMode(asset),
      orderTime: formatDateInput(assetPurchaseDateText(asset)),
    });
  }, [asset, form]);

  return (
    <div className="npcink-v3-settings-panel npcink-v3-detail-settings">
      <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
        <div className="npcink-v3-settings-section">
          <h4>基础信息</h4>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item name="assetNumber" label="编号">
              <Input />
            </Form.Item>
            <Form.Item label="IP 地址">
              <Input value={primaryIp} readOnly placeholder="暂无采集 IP" />
            </Form.Item>
          </div>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item
              name="department"
              label={(
                <span className="npcink-v3-form-label-with-help">
                  部门
                  <Tooltip title="只能选择设置中维护的部门；未选择时会归入未分配。">
                    <InfoCircleOutlined tabIndex={0} aria-label="部门填写说明" />
                  </Tooltip>
                </span>
              )}
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
            <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="category" label="设备类型">
              <Select
                allowClear
                options={COMPUTER_DEVICE_TYPE_OPTIONS}
                placeholder="选择设备类型"
                popupMatchSelectWidth={false}
              />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-settings-section">
          <h4>财务参数</h4>
          <div className="npcink-v3-settings-grid npcink-v3-settings-grid-three">
            <Form.Item name="purchasePrice" label="采购价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
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
            <Form.Item
              name="orderTime"
              label="购置日期"
              normalize={(value) => value ? value.format("YYYY-MM-DD") : ""}
              getValueProps={(value) => {
                const date = value ? dayjs(value) : null;
                return { value: date?.isValid() ? date : null };
              }}
            >
              <DatePicker
                format="YYYY-MM-DD"
                placeholder="选择购置日期"
                allowClear
                className="npcink-v3-date-picker"
              />
            </Form.Item>
          </div>
          <div className="npcink-v3-finance-summary">
            <span>折旧率：{depreciationRate}%</span>
            <span>账面净值：{formatMoney(financialResidualValue)}</span>
            <span>账面净值率：{residualRate}%</span>
            <span>系统估算：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}</span>
            <span>当前采用：{watchedFinancialResidualMode === "manual" ? "手动值" : "系统估算值"}</span>
          </div>
        </div>

        <div className="npcink-v3-settings-actions">
          <Button type="primary" htmlType="submit" loading={updateMutation.isLoading}>
            保存设置
          </Button>
          <Button danger type="text" onClick={() => onArchive(asset)}>
            归档设备
          </Button>
        </div>
      </Form>
    </div>
  );
};

export interface CustomAssetSettingsValues {
  name?: string;
  assetNumber?: string;
  category?: string;
  status?: string;
  ownerName?: string;
  purpose?: string;
  purchasePrice?: number;
  secondHandMarketValue?: number;
  financialResidualValue?: number;
  financialResidualMode?: FinancialResidualMode;
  numbers?: number;
  purchaser?: string;
  platform?: string;
  order?: string;
  payMethod?: string;
  orderTime?: string;
  link?: string;
}

export const CUSTOM_PLATFORM_EDIT_OPTIONS = ["京东", "淘宝", "闲鱼", "微信", "支付宝", "其他"].map((value) => ({
  label: value,
  value,
}));

export const CustomAssetSettingsPanel = ({ asset, onUpdated, onArchive }: AssetSettingsPanelProps) => {
  const [form] = Form.useForm<CustomAssetSettingsValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const info = useMemo(() => customAssetInfo(asset), [asset]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualValue = Form.useWatch("financialResidualValue", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const purchasePrice = Number(watchedPurchasePrice ?? asset.purchasePrice ?? 0);
  const financialResidualValue = Number(watchedFinancialResidualValue ?? asset.financialResidualValue ?? 0);
  const residualRate = purchasePrice > 0 ? Math.round((financialResidualValue / purchasePrice) * 100) : 0;
  const depreciationRate = purchasePrice > 0 ? Math.max(0, 100 - residualRate) : 0;
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      purchasePrice,
      String(watchedPurchaseDate || asset.createdAt),
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [asset.createdAt, purchasePrice, settingsQuery.data, watchedPurchaseDate]);
  useEffect(() => {
    if (watchedFinancialResidualMode === "auto" && estimatedFinancialResidual !== null) {
      form.setFieldValue("financialResidualValue", estimatedFinancialResidual);
    }
  }, [estimatedFinancialResidual, form, watchedFinancialResidualMode]);
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set([...DEFAULT_CUSTOM_CATEGORIES, asset.category].map((item) => String(item || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((value) => ({ label: value, value })),
    [asset.category]
  );
  const updateMutation = useMutation(
    (values: CustomAssetSettingsValues) => {
      const metadata = getRecord(asset.metadata);
      const existingPurchase = getRecord(metadata.purchase);
      const existingFinance = getRecord(metadata.finance);
      return updateAsset(asset.uuid, {
        name: values.name,
        assetNumber: values.assetNumber,
        ownerName: values.ownerName,
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
            platform: values.platform || "",
            order: values.order || "",
            pay_method: values.payMethod || "",
            order_time: values.orderTime || "",
            link: values.link || "",
          },
          finance: {
            ...existingFinance,
            financial_residual_mode: values.financialResidualMode || "auto",
          },
        },
      });
    },
    {
      onSuccess: (updated) => {
        onUpdated(updated);
        message.success("资产信息已保存");
      },
    }
  );

  useEffect(() => {
    form.setFieldsValue({
      name: info.title,
      assetNumber: info.number,
      category: info.category,
      status: asset.status,
      ownerName: info.usage,
      purpose: info.purpose,
      purchasePrice: Number(info.total || asset.purchasePrice || 0),
      secondHandMarketValue: asset.secondHandMarketValue,
      financialResidualValue: asset.financialResidualValue,
      financialResidualMode: financialResidualMode(asset),
      numbers: Number(info.quantity || 0) || undefined,
      purchaser: info.purchaser,
      platform: info.platform,
      order: info.orderNo,
      payMethod: info.payMethod,
      orderTime: info.orderTime,
      link: info.link,
    });
  }, [asset, form, info]);

  return (
    <div className="npcink-v3-custom-settings-panel">
      <Form form={form} layout="vertical" onFinish={(values) => updateMutation.mutate(values)}>
        <div className="npcink-v3-custom-settings-section">
          <h4>基础信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="name" label="资产名称">
              <Input placeholder="例如：科沃顿UPS C3K" />
            </Form.Item>
            <Form.Item name="assetNumber" label="设备编号">
              <Input placeholder="设备编号" />
            </Form.Item>
            <Form.Item name="category" label="设备分类">
              <Select
                showSearch
                allowClear
                options={categoryOptions}
                placeholder="选择或输入分类"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
                onSearch={(value) => {
                  if (value.trim()) {
                    form.setFieldValue("category", value.trim());
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="status" label="当前状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item name="purpose" label="设备用途">
              <Input placeholder="例如：机房备用电源" />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-custom-settings-section">
          <h4>采购信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="purchasePrice" label="采购总价">
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
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
            <Form.Item name="numbers" label="采购数量">
              <InputNumber min={0} precision={0} className="npcink-v3-number" />
            </Form.Item>
            <Form.Item name="purchaser" label="采购人员">
              <Input placeholder="采购同事" />
            </Form.Item>
          </div>
          <div className="npcink-v3-finance-summary">
            <span>折旧率：{depreciationRate}%</span>
            <span>账面净值：{formatMoney(financialResidualValue)}</span>
            <span>账面净值率：{residualRate}%</span>
            <span>系统估算：{estimatedFinancialResidual === null ? "需要采购价和购置日期" : formatMoney(estimatedFinancialResidual)}</span>
            <span>当前采用：{watchedFinancialResidualMode === "manual" ? "手动值" : "系统估算值"}</span>
          </div>
        </div>

        <div className="npcink-v3-custom-settings-section">
          <h4>订单信息</h4>
          <div className="npcink-v3-custom-settings-grid">
            <Form.Item name="order" label="采购单号">
              <Input placeholder="订单号" />
            </Form.Item>
            <Form.Item name="platform" label="采购平台">
              <Select
                showSearch
                allowClear
                options={CUSTOM_PLATFORM_EDIT_OPTIONS}
                placeholder="选择或输入平台"
                popupMatchSelectWidth={false}
                filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
                onSearch={(value) => {
                  if (value.trim()) {
                    form.setFieldValue("platform", value.trim());
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="payMethod" label="支付方式">
              <Input placeholder="例如：支付宝" />
            </Form.Item>
            <Form.Item name="orderTime" label="下单时间">
              <Input placeholder="例如：2024-12-27" />
            </Form.Item>
            <Form.Item name="link" label="商品链接" className="npcink-v3-custom-settings-wide">
              <Input placeholder="商品链接或备注" />
            </Form.Item>
          </div>
        </div>

        <div className="npcink-v3-settings-actions npcink-v3-custom-settings-actions">
          <Button type="primary" htmlType="submit" loading={updateMutation.isLoading}>
            保存信息
          </Button>
          <Button danger type="text" onClick={() => onArchive(asset)}>
            归档设备
          </Button>
        </div>
      </Form>
    </div>
  );
};

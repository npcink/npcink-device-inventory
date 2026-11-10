import { HelpLabel } from "@/components/HelpLabel";
import { getSettings } from "@/services/v3";
import type { AssetInput } from "@/type/v3";
import { useQuery } from "@tanstack/react-query";
import { Form, Input, InputNumber, Modal, Radio, Select } from "antd";
import { useEffect, useMemo } from "react";
import { assetFormValuesToInput, type AssetFormValues } from "@/pages/shared/assetForm";
import {
  DEFAULT_DEPARTMENT,
  departmentSelectOptions,
  isAllowedDepartment,
  normalizeDepartmentList,
} from "@/pages/shared/departments";
import {
  calculateFinancialResidualValue,
} from "@/pages/shared/finance";
import { EDITABLE_STATUS_OPTIONS } from "@/pages/shared/options";
import { formatMoney } from "@/pages/shared/presentation";

const INITIAL_ASSET_VALUES: AssetFormValues = {
  assetType: "custom", department: DEFAULT_DEPARTMENT, status: "active",
  purchasePrice: 0, secondHandMarketValue: 0, financialResidualValue: 0,
  financialResidualMode: "auto", numbers: 1,
};

export interface AssetFormModalProps {
  open: boolean;
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

export const AssetFormModal = ({ open, departmentOptions = [], onClose, onSubmit }: AssetFormModalProps) => {
  const [form] = Form.useForm<AssetFormValues>();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { staleTime: 60_000 });
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);
  const watchedPurchasePrice = Form.useWatch("purchasePrice", form);
  const watchedPurchaseDate = Form.useWatch("orderTime", form);
  const watchedFinancialResidualMode = Form.useWatch("financialResidualMode", form);
  const purchaseDate = String(watchedPurchaseDate || "");
  const estimatedFinancialResidual = useMemo(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return null;
    }
    return calculateFinancialResidualValue(
      Number(watchedPurchasePrice || 0),
      purchaseDate,
      settings.depreciationPeriodMonths,
      settings.defaultResidualRate
    );
  }, [settingsQuery.data, purchaseDate, watchedPurchasePrice]);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.resetFields();
  }, [form, open]);

  return (
    <Modal
      title="采购信息录入"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认录入"
      cancelText="取消"
      destroyOnHidden
      width={760}
    >
      <Form
        form={form}
        initialValues={INITIAL_ASSET_VALUES}
        layout="vertical"
        onFinish={(values) => onSubmit(assetFormValuesToInput(values, null, settingsQuery.data))}
        preserve={false}
        className="npcink-v3-asset-form"
      >
        <Form.Item name="assetType" hidden>
          <Input />
        </Form.Item>
        <div className="npcink-v3-asset-form-section">
          <h4>设备信息</h4>
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: "请输入设备名称" }]}>
            <Input placeholder="例如：科沃顿 UPS C3K" />
          </Form.Item>
          <Form.Item name="purpose" label="设备用途">
            <Input placeholder="例如：机房备用电源" />
          </Form.Item>
          <div className="npcink-v3-asset-form-grid">
            <Form.Item name="assetNumber" label="设备编号">
              <Input placeholder="留空自动生成" />
            </Form.Item>
            <Form.Item name="ownerName" label="使用人 / 责任人">
              <Input placeholder="姓名或工号" />
            </Form.Item>
            <Form.Item
              name="department"
              label={<HelpLabel label="部门" description="只能选择设置中维护的部门；未选择时会归入未分配。" />}
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
            <Form.Item name="category" label="分类">
              <Input placeholder="例如：显卡、手机、机房设备" />
            </Form.Item>
            <Form.Item
              name="status"
              label={<HelpLabel label="状态" description="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。" />}
            >
              <Select options={EDITABLE_STATUS_OPTIONS} />
            </Form.Item>
          </div>
        </div>

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
            <Form.Item name="financialResidualValue" label="手动账面净值" hidden={watchedFinancialResidualMode !== "manual"}>
              <InputNumber min={0} precision={2} className="npcink-v3-number" addonAfter="¥" />
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

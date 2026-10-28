import type { AssetInput } from "@/type/v3";
import { Alert, Form, Input, Modal, Select } from "antd";
import { useEffect, useMemo } from "react";
import {
  departmentSelectOptions,
  isAllowedDepartment,
  normalizeDepartmentList,
} from "@/pages/shared/departments";
import { COMPUTER_DEVICE_TYPE_OPTIONS, EDITABLE_STATUS_OPTIONS } from "@/pages/shared/options";

export interface BulkEditModalProps {
  open: boolean;
  count: number;
  loading: boolean;
  categoryMode: "computer" | "custom" | "mixed";
  departmentOptions?: string[];
  onClose: () => void;
  onSubmit: (values: AssetInput) => Promise<void>;
}

export const BulkEditModal = ({ open, count, loading, categoryMode, departmentOptions = [], onClose, onSubmit }: BulkEditModalProps) => {
  const [form] = Form.useForm<AssetInput>();
  const normalizedDepartmentOptions = useMemo(() => normalizeDepartmentList(departmentOptions), [departmentOptions]);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [form, open]);

  return (
    <Modal
      title="批量修改资产"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="确认修改"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
      width={560}
    >
      <Alert
        type="info"
        showIcon
        className="npcink-v3-secret"
        message={`将修改 ${count} 条已选资产`}
        description="留空字段不会覆盖原值；发生变化的资产会写入一条批量修改记录。"
      />
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(values) => {
          const input = Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== undefined && value !== "")
          ) as AssetInput;
          onSubmit(input);
        }}
      >
        <Form.Item
          name="department"
          label="部门"
          extra={normalizedDepartmentOptions.length ? "只能选择设置中维护的部门；留空表示不修改。" : "请先到设置 > 部门管理添加部门。"}
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
            allowClear
            showSearch
            options={departmentSelectOptions(normalizedDepartmentOptions)}
            placeholder={normalizedDepartmentOptions.length ? "统一修改部门" : "暂无可选部门"}
            popupMatchSelectWidth={false}
            disabled={!normalizedDepartmentOptions.length}
            filterOption={(input, option) => String(option?.label || "").toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="ownerName" label="使用人 / 责任人">
          <Input placeholder="统一修改使用人 / 责任人" />
        </Form.Item>
        <Form.Item name="status" label="状态" extra="选择报废后，将保留采购价，并把二手市场价和账面净值调整为 0。">
          <Select allowClear options={EDITABLE_STATUS_OPTIONS} placeholder="统一修改状态" />
        </Form.Item>
        {categoryMode === "computer" ? (
          <Form.Item name="category" label="设备类型" extra="留空表示不修改。">
            <Select
              allowClear
              options={COMPUTER_DEVICE_TYPE_OPTIONS}
              placeholder="统一修改设备类型"
              popupMatchSelectWidth={false}
            />
          </Form.Item>
        ) : categoryMode === "custom" ? (
          <Form.Item name="category" label="分类" extra="留空表示不修改。">
            <Input placeholder="统一修改分类" />
          </Form.Item>
        ) : (
          <Form.Item label="设备类型 / 分类" extra="电脑与自定义资产含义不同，请按同一资产类型分批修改。">
            <Input disabled placeholder="混合选择时不可修改" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

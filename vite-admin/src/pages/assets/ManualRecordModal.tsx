import type { Asset, AssetEventInput } from "@/type/v3";
import { Form, Input, Modal } from "antd";
import { useEffect } from "react";

export interface ManualRecordFormProps {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
  onSubmit: (values: AssetEventInput) => Promise<unknown>;
  loading?: boolean;
}

export interface ManualRecordFormValues {
  operatorName: string;
  changeItem: string;
  changeDescription: string;
}

export const ManualRecordModal = ({ open, asset, onClose, onSubmit, loading }: ManualRecordFormProps) => {
  const [form] = Form.useForm<ManualRecordFormValues>();

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [form, open]);

  return (
    <Modal
      title="添加记录"
      open={open}
      okText="添加记录"
      cancelText="取消"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      width={560}
      className="npcink-v3-manual-record-modal"
    >
      <div className="npcink-v3-manual-record-form">
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ flex: "92px" }}
        wrapperCol={{ flex: "1 1 auto" }}
        colon={false}
        preserve={false}
        requiredMark
        onFinish={async (values) => {
          await onSubmit({
            eventType: "manual_change",
            message: values.changeDescription.trim(),
            payload: {
              assetNumber: asset?.assetNumber || "",
              operatorName: values.operatorName.trim(),
              changeItem: values.changeItem.trim(),
            },
          });
          form.resetFields();
        }}
      >
        <Form.Item
          name="operatorName"
          label="变更人"
          rules={[{ required: true, whitespace: true, message: "请输入变更人" }]}
        >
          <Input placeholder="操作变更同事的名字" />
        </Form.Item>
        <Form.Item
          name="changeItem"
          label="变更项目"
          rules={[{ required: true, whitespace: true, message: "请输入变更项目" }]}
        >
          <Input placeholder="变更的项目，例如硬盘、内存条等" />
        </Form.Item>
        <Form.Item
          name="changeDescription"
          label="变更说明"
          rules={[{ required: true, whitespace: true, message: "请输入变更说明" }]}
        >
          <Input.TextArea rows={3} placeholder="变更内容详情" />
        </Form.Item>
      </Form>
      </div>
    </Modal>
  );
};

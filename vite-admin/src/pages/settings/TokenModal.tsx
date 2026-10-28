import { createClientToken, deleteClientToken, getSettings, updateClientToken } from "@/services/v3";
import type { ClientToken, CreatedClientToken } from "@/type/v3";
import { RestUrl } from "@/utils/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import {
  buildClientImportConfig,
  buildClientSubmitCommand,
  buildClientTokenValue,
  buildClientUploadEndpoint,
} from "@/pages/shared/client";
import { DESKTOP_RELEASE_URL } from "@/pages/shared/departments";
import { formatDate } from "@/pages/shared/presentation";

const { Text } = Typography;

export interface TokenModalProps {
  open: boolean;
  onClose: () => void;
}

export const TokenModal = ({ open, onClose }: TokenModalProps) => {
  const [form] = Form.useForm<{ name: string }>();
  const [createdToken, setCreatedToken] = useState<CreatedClientToken | null>(null);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(["v3-settings"], getSettings, { enabled: open });
  const createMutation = useMutation(createClientToken, {
    onSuccess: (token) => {
      setCreatedToken(token);
      form.resetFields();
      queryClient.invalidateQueries(["v3-settings"]);
      message.success("令牌已创建，请立即保存完整授权码");
    },
  });
  const deleteMutation = useMutation(deleteClientToken, {
    onSuccess: () => {
      queryClient.invalidateQueries(["v3-settings"]);
      message.success("令牌已删除");
    },
  });
  const tokenStatusMutation = useMutation(
    ({ id, enabled }: { id: string; enabled: boolean }) => updateClientToken(id, enabled),
    {
      onSuccess: (token) => {
        queryClient.invalidateQueries(["v3-settings"]);
        message.success(token.enabled ? "令牌已启用" : "令牌已停用");
      },
    }
  );
  const tokens = settingsQuery.data?.clientTokens || [];
  const uploadEndpoint = buildClientUploadEndpoint(settingsQuery.data?.clientUploadBaseUrl || RestUrl);

  const columns: ColumnsType<ClientToken> = [
    { title: "名称", dataIndex: "name" },
    { title: "Token ID", dataIndex: "id", width: 160 },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 120,
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
      ),
    },
    {
      title: "启停",
      dataIndex: "enabled",
      width: 110,
      render: (enabled: boolean, token) => (
        <Switch
          size="small"
          checked={enabled}
          checkedChildren="启用"
          unCheckedChildren="关闭"
          loading={tokenStatusMutation.isLoading && tokenStatusMutation.variables?.id === token.id}
          onChange={(checked) => tokenStatusMutation.mutate({ id: token.id, enabled: checked })}
        />
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 180,
      render: formatDate,
    },
    {
      title: "操作",
      width: 90,
      render: (_, token) => (
        <Space size={8}>
          <Button
            size="small"
            danger
            onClick={() =>
              Modal.confirm({
                title: "确认删除这个客户端令牌？",
                content: (
                  <Space direction="vertical" size={4}>
                    <Text>删除后，使用该令牌的客户端将无法继续上传数据。</Text>
                    <Text type="secondary">Token ID：{token.id}</Text>
                  </Space>
                ),
                okText: "确认删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => deleteMutation.mutateAsync(token.id),
              })
            }
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="客户端接入"
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
    >
      <div className="npcink-v3-token-endpoint">
        <div>
          <Text strong>客户端上传地址</Text>
          <Text type="secondary">授权码可供多台可信设备提交采集信息和验证连接，不授予台账读取或管理权限。请妥善保管。</Text>
        </div>
        <Text copyable code>
          {uploadEndpoint}
        </Text>
      </div>
      <Alert
        type="info"
        showIcon
        message="先下载客户端，再导入配置"
        description={
          <Space direction="vertical" size={4}>
            <Text>支持 Windows x64 和 macOS Apple Silicon。安装包尚未完成平台代码签名，仅建议在可信内部环境使用。</Text>
            <Button type="link" href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">打开客户端下载页</Button>
          </Space>
        }
      />
      <Form
        form={form}
        className="npcink-v3-token-form"
        onFinish={({ name }) => createMutation.mutate(name)}
      >
        <div className="npcink-v3-token-create-row">
          <Form.Item
            name="name"
            label="令牌备注"
            rules={[{ required: true, message: "请输入令牌备注" }]}
          >
            <Input placeholder="例如：财务部采集客户端" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createMutation.isLoading}>
            创建令牌
          </Button>
        </div>
      </Form>
      {createdToken ? (
        <Alert
          className="npcink-v3-secret"
          type="warning"
          showIcon
          message="密钥只在创建后显示一次"
          description={
            <Space direction="vertical" size={8} className="npcink-v3-client-snippet">
              <Text type="secondary">请立即复制桌面客户端导入配置；关闭窗口后无法再次读取密钥。</Text>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">桌面客户端导入配置</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientImportConfig(createdToken, uploadEndpoint)}
                </Text>
              </div>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">完整授权码</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientTokenValue(createdToken)}
                </Text>
              </div>
              <div className="npcink-v3-client-snippet-item">
                <Text type="secondary">命令行验收</Text>
                <Text copyable code className="npcink-v3-client-snippet-code">
                  {buildClientSubmitCommand(createdToken, uploadEndpoint)}
                </Text>
              </div>
            </Space>
          }
        />
      ) : null}
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={tokens}
        loading={settingsQuery.isLoading}
        pagination={false}
      />
    </Modal>
  );
};

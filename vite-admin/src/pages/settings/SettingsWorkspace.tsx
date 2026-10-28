import { cleanupObservations, getSettings, updateSettings } from "@/services/v3";
import type { InventorySettings } from "@/type/v3";
import { RestUrl } from "@/utils/index";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { TokenModal } from "@/pages/settings/TokenModal";
import {
  departmentSelectOptions,
  departmentTagRender,
  normalizeDepartmentList,
} from "@/pages/shared/departments";

const { Text, Title } = Typography;

export const SettingsWorkspace = () => {
  const [form] = Form.useForm<InventorySettings>();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(["v3-settings"], getSettings);
  const settingsMutation = useMutation(updateSettings, {
    onSuccess: (settings) => {
      queryClient.setQueryData(["v3-settings"], settings);
      setHasUnsavedChanges(false);
      message.success("设置已保存");
    },
  });
  const cleanupMutation = useMutation(cleanupObservations, {
    onSuccess: (result) => {
      queryClient.invalidateQueries(["v3-observations"]);
      queryClient.invalidateQueries(["v3-analysis-observations"]);
      queryClient.invalidateQueries(["v3-analysis-collection-trends"]);
      message.success(result.deleted ? `已清理 ${result.deleted} 条过期采集快照` : "没有需要清理的过期快照");
    },
  });

  const addDepartment = () => {
    const department = newDepartment.trim().slice(0, 80);
    if (!department) {
      message.warning("请输入部门名称");
      return;
    }
    const departments = normalizeDepartmentList(form.getFieldValue("departments") || []);
    if (departments.includes(department)) {
      message.info("该部门已经存在");
      setNewDepartment("");
      return;
    }
    form.setFieldValue("departments", normalizeDepartmentList([...departments, department]));
    setNewDepartment("");
  };

  useEffect(() => {
    if (settingsQuery.data) {
      form.setFieldsValue({
        ...settingsQuery.data,
        departments: normalizeDepartmentList(settingsQuery.data.departments),
      });
      setHasUnsavedChanges(false);
    }
  }, [form, settingsQuery.data]);

  return (
    <div className="npcink-v3-section">
      <div className="npcink-v3-section-header">
        <div>
          <Title level={3}>设置</Title>
          <Text type="secondary">管理采集客户端、部门和卸载清理策略。</Text>
        </div>
      </div>
      {settingsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="设置加载失败"
          description="为避免覆盖现有配置，加载成功前不能保存设置或管理客户端令牌。"
          action={<Button onClick={() => settingsQuery.refetch()}>重试</Button>}
        />
      ) : null}
      <div className="npcink-v3-settings-panel">
        <Form
          form={form}
          className="npcink-v3-global-settings-form"
          layout="vertical"
          onValuesChange={() => setHasUnsavedChanges(true)}
          onFinish={(values) =>
            settingsMutation.mutate({
              ...values,
              departments: normalizeDepartmentList(values.departments),
            })
          }
        >
          <div className="npcink-v3-settings-section">
            <div className="npcink-v3-settings-section-head">
              <Title level={4}>客户端接入</Title>
              <Button disabled={settingsQuery.isError || settingsQuery.isLoading} onClick={() => setTokenModalOpen(true)}>管理客户端令牌</Button>
            </div>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="clientUploadBaseUrl"
                label="外部访问地址"
                extra="留空使用当前站点 REST 地址；反向代理、内网穿透或 HTTPS 域名不一致时再填写。"
                className="npcink-v3-settings-wide"
              >
                <Input placeholder={RestUrl} />
              </Form.Item>
            </div>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>采集快照保留</Title>
            <Text type="secondary">设置原始硬件快照的自动保留期。0 表示不自动删除；清理时始终保留每台资产的最新快照。</Text>
            <div className="npcink-v3-settings-grid">
              <Form.Item name="observationRetentionDays" label="保留天数" extra="保存设置后每日自动清理；建议先完成 JSON 备份。">
                <InputNumber min={0} max={3650} precision={0} addonAfter="天" />
              </Form.Item>
            </div>
            <Button
              loading={cleanupMutation.isLoading}
              disabled={settingsQuery.isError || settingsQuery.isLoading || Number(settingsQuery.data?.observationRetentionDays || 0) <= 0}
              onClick={() => Modal.confirm({
                title: "立即清理过期采集快照？",
                content: "将按当前已保存的保留天数删除历史快照，并保留每台资产的最新快照。此操作不可撤销。",
                okText: "确认清理",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => cleanupMutation.mutateAsync(),
              })}
            >立即清理</Button>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>账面净值估算</Title>
            <Text type="secondary">
              使用直线折旧法：采购价减去预计最终残值后，按月平均折旧。默认使用系统实时估算的账面净值；特殊设备可在编辑页切换为手动账面净值。
            </Text>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="depreciationPeriodMonths"
                label="折旧年限"
                extra="普通电脑通常采用 3 年或 5 年；请以公司会计政策为准。"
              >
                <InputNumber min={1} max={240} precision={0} addonAfter="个月" />
              </Form.Item>
              <Form.Item
                name="defaultResidualRate"
                label="预计残值率"
                extra="折旧期满后的预计残值占采购价的比例，常见为 3%–5%。"
              >
                <InputNumber min={0} max={100} precision={1} addonAfter="%" />
              </Form.Item>
            </div>
            <Space wrap>
              <Text type="secondary">快捷设置：</Text>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 36)}>3 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 60)}>5 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("depreciationPeriodMonths", 96)}>8 年</Button>
              <Button size="small" onClick={() => form.setFieldValue("defaultResidualRate", 3)}>残值率 3%</Button>
              <Button size="small" onClick={() => form.setFieldValue("defaultResidualRate", 5)}>残值率 5%</Button>
            </Space>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>更新候选规则</Title>
            <Text type="secondary">分析页只根据这些阈值列出候选，不会自动修改状态或归档设备。</Text>
            <div className="npcink-v3-settings-grid npcink-v3-settings-grid-four">
              <Form.Item name="renewalAgeYears" label="使用年限阈值（年）" extra="有购置日期且达到该年限时进入候选。">
                <InputNumber min={1} max={20} precision={0} addonAfter="年" />
              </Form.Item>
              <Form.Item name="renewalMinMemoryGb" label="最低内存（GB）" extra="已采集内存低于该容量时进入候选。">
                <InputNumber min={1} max={512} precision={0} addonAfter="GB" />
              </Form.Item>
              <Form.Item name="renewalMinDiskGb" label="最低硬盘（GB）" extra="已采集硬盘容量低于该值时进入候选。">
                <InputNumber min={1} max={8192} precision={0} addonAfter="GB" />
              </Form.Item>
              <Form.Item name="renewalMaxResidualRate" label="低账面净值率阈值（%）" extra="采购价和当前有效账面净值均存在时参与判断。">
                <InputNumber min={0} max={100} precision={0} addonAfter="%" />
              </Form.Item>
            </div>
          </div>
          <div className="npcink-v3-settings-section">
            <Title level={4}>部门管理</Title>
            <div className="npcink-v3-settings-grid">
              <Form.Item
                name="departments"
                label="部门列表"
                extra="未分配是系统兜底部门，不能删除；设备详情、批量修改和表格导入只能选择这里维护的部门。"
                className="npcink-v3-settings-wide"
              >
                <Select
                  mode="multiple"
                  showSearch
                  options={departmentSelectOptions(form.getFieldValue("departments") || [])}
                  tagRender={departmentTagRender}
                  onChange={(value) => form.setFieldValue("departments", normalizeDepartmentList(value))}
                  placeholder="已维护的部门"
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
              <div className="npcink-v3-settings-wide npcink-v3-department-add-row">
                <Input
                  value={newDepartment}
                  maxLength={80}
                  placeholder="输入新部门名称，例如：财务部"
                  onChange={(event) => setNewDepartment(event.target.value)}
                  onPressEnter={addDepartment}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={addDepartment}>
                  添加部门
                </Button>
              </div>
            </div>
          </div>
          <div className="npcink-v3-settings-section npcink-v3-danger-section">
            <Title level={4}>危险操作</Title>
            <div className="npcink-v3-settings-grid">
              <div className="npcink-v3-setting-switch-row">
                <div>
                  <Text strong>卸载时删除数据</Text>
                  <Text type="secondary">开启后，删除插件时会清理插件数据表和设置。</Text>
                </div>
                <Form.Item name="deleteDataOnUninstall" valuePropName="checked" noStyle>
                  <Switch checkedChildren="删除" unCheckedChildren="保留" />
                </Form.Item>
              </div>
            </div>
          </div>
          <div className="npcink-v3-settings-actions">
            {hasUnsavedChanges ? <Text type="warning">有未保存的更改</Text> : null}
            <Button type="primary" htmlType="submit" disabled={settingsQuery.isError || settingsQuery.isLoading} loading={settingsMutation.isLoading}>
              {hasUnsavedChanges ? "保存设置（含部门变更）" : "保存设置"}
            </Button>
          </div>
        </Form>
      </div>
      <TokenModal open={tokenModalOpen} onClose={() => setTokenModalOpen(false)} />
    </div>
  );
};

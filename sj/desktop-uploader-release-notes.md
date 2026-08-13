# Desktop Uploader Release Notes

日期：2026-06-21
同步更新：2026-07-15

本文档单独说明 `Npcink Device Agent` 桌面上传软件，供 WordPress.org 审核问询、官网发布页、客户交付说明使用。桌面软件不是 WordPress 插件 zip 的一部分。

## 软件定位

`Npcink Device Agent` 是配套桌面上传工具，用于在管理员授权后采集本机硬件信息，并提交到已安装 `Npcink Device Inventory` 的 WordPress 网站。

桌面软件负责：

- 采集本机硬件摘要和设备身份信号。
- 本地显示当前设备身份；服务端从上传快照重新计算身份，识别同一台设备。
- 使用管理员在 WordPress 后台生成的上传授权码发送 HMAC 签名请求。
- 将采集结果提交到 `/wp-json/npcink-device-inventory/v1/device-observations`。

桌面软件不负责：

- 不创建 WordPress 管理员账号。
- 不绕过 WordPress 后台权限。
- 不上传到 Npcink 或第三方云服务。
- 不替代站点管理员的资产审核和数据治理。

## 当前版本边界

- 客户端目录：`ele-rs/`
- 技术栈：Rust + Tauri
- 上传接口：`/wp-json/npcink-device-inventory/v1/device-observations`
- 授权方式：WordPress 后台生成的客户端授权码 + HMAC 请求签名
- 数据契约：v3 observation 资产快照；资产模型见 `docs/asset-data-model.md`，身份规则见 `docs/identity-contract.md`

当前阶段是 Rust/Tauri 版本的第一阶段发布资料，重点验证 Windows 和 macOS 的采集字段、设备合并逻辑、授权上传流程。

## 面向用户的发布说明

### 新增

- 新增本机硬件采集预览。
- 新增一键导出硬件反馈 JSON，便于在真实机器上反馈采集和设备识别问题；文件仅保存在本机且不包含上传授权码。
- 新增稳定设备 ID 展示，用于服务端识别重复上传。
- 新增 WordPress v3 observation 上传接口支持。
- 新增可选使用人字段，用于在后台使用人为空时补齐人员姓名；不要填写部署批次、工位或设备用途。
- 新增 HMAC 签名上传流程，不再使用明文共享密码。

### 需要管理员准备

1. 在 WordPress 后台安装并启用 `Npcink Device Inventory`。
2. 打开 `Plugins > Device Inventory > Settings`。
3. 生成一个启用状态的客户端授权码。
4. 将站点上传地址和授权码发给需要上传设备信息的用户。

上传地址格式：

```text
https://example.com/wp-json/npcink-device-inventory/v1/device-observations
```

### 用户使用流程

1. 打开 `Npcink Device Agent`。
2. 填写 WordPress v3 observation 上传接口地址。
3. 填写管理员提供的上传授权码。
4. 可选填写使用人姓名；不要填写工位号、部门或设备用途。
5. 查看本机硬件采集预览。
6. 点击上传。
7. 管理员在 WordPress 后台的电脑设备列表中确认记录。

## 构建命令

桌面应用：

```bash
cd ele-rs
npm install
npm run build
npm run tauri:build
```

开发调试：

```bash
cd ele-rs
npm run tauri:dev
```

CLI 验证：

```bash
cd ele-rs
cargo run -- inspect --pretty
cargo run -- device-id
cargo run -- submit --site "https://example.com/wp-json/npcink-device-inventory/v1/device-observations" --token "后台生成的上传授权码" --note "张三"
```

## 发布前检查

- 确认 WordPress 插件已通过 Plugin Check。
- 确认服务端 `/device-observations` 未签名请求返回 `401`。
- 确认管理员可在后台生成、禁用、删除客户端授权码。
- 确认 Windows 样机上传后不会重复创建同一设备。
- 确认 macOS 样机上传后不会重复创建同一设备。
- 确认使用人不会参与设备合并判断，只会在后台使用人为空时补齐。
- 确认发布包不包含测试 token、站点私有地址或本地 `.env`。

## 隐私说明

桌面上传软件会采集设备资产管理所需的硬件和系统信息。数据只会发送到用户填写的 WordPress 站点接口。站点管理员应在内部资产管理制度或员工隐私告知中说明采集范围、用途和保留周期。

## 已知限制

- 当前阶段优先覆盖 Windows 和 macOS 样机。
- 不保证虚拟机、极简系统、权限受限环境能采集完整硬件字段。
- Linux 桌面分发包未作为首发重点。
- WordPress 插件目录提交包不包含桌面软件二进制文件。

# Npcink Device Inventory

Npcink Device Inventory 是一个 WordPress 设备资产管理插件，用于小型团队维护设备资产、采集快照、身份匹配和事件时间线。

当前产品范围、开发约束和发布入口见
[`docs/development-playbook.md`](docs/development-playbook.md)。硬件身份以
[`docs/identity-contract.md`](docs/identity-contract.md) 为准；历史 v1 身份
文档不代表当前上传行为。

## 组成

- `npcink-device-inventory.php`：WordPress 插件入口。
- `admin/`：后台菜单、REST API、数据表读写、导入导出和设置。
- `includes/`：插件加载器、激活/停用、数据库建表和增量迁移。
- `vite-admin/`：后台 React 管理端，构建产物由插件后台加载。
- `ele-rs/`：Rust/Tauri 设备采集与上传客户端。
- `docs/`：数据模型、发布流程、验证记录和历史归档。
- `scripts/`：发布包、桌面更新清单和本地备份恢复验证脚本。
- `tests/`：离线夹具和回归验证脚本。
- `sj/`：WordPress.org 提交资料、展示素材和审核沟通文案归档。

设备上传客户端以 `ele-rs/` 为准。
各平台硬件字段的实际覆盖、已知限制和补齐顺序见
[`docs/hardware-collection-coverage.md`](docs/hardware-collection-coverage.md)。

## 数据模型

v3 使用统一资产模型，详细契约见 `docs/asset-data-model.md`。插件运行时使用 WordPress 数据库前缀加以下表名：

- `npcink_assets`：资产主表。
- `npcink_asset_identities`：资产身份与匹配信号。
- `npcink_asset_observations`：客户端采集、导入或人工录入的资产快照。
- `npcink_asset_events`：统一事件和审计时间线。

设备上传使用 schema 5 硬件事实。服务端会独立计算系统 UUID、主板序列号和永久 PCI MAC 三类 v2 身份；多条证据互相指向不同资产时返回 409，不自动合并。v1 身份只用于升级时定位已有资产，详见 [`docs/identity-contract.md`](docs/identity-contract.md)。

主要 REST 入口：

- `POST /wp-json/npcink-device-inventory/v1/device-observations`：软件端上传采集事实。
- `GET|POST /wp-json/npcink-device-inventory/v1/assets`：管理资产列表与新增资产。
- `POST /wp-json/npcink-device-inventory/v1/assets/batch`：在一个事务中批量新增、更新或归档资产。
- `GET|PATCH|DELETE /wp-json/npcink-device-inventory/v1/assets/{uuid}`：资产详情、更新、软删除。
- `GET|POST /wp-json/npcink-device-inventory/v1/assets/{uuid}/identities`：资产身份。
- `GET /wp-json/npcink-device-inventory/v1/assets/{uuid}/observations`：资产采集快照。
- `GET|POST /wp-json/npcink-device-inventory/v1/assets/{uuid}/events`：资产事件时间线。
- `GET|PATCH /wp-json/npcink-device-inventory/v1/settings`：插件设置。
- `POST /wp-json/npcink-device-inventory/v1/client-tokens`：创建软件端授权码。
- `PATCH|DELETE /wp-json/npcink-device-inventory/v1/client-tokens/{id}`：启停或删除软件端授权码。
- `GET /wp-json/npcink-device-inventory/v1/backup`：在一个数据库一致性快照中导出所选备份区段。
- `POST /wp-json/npcink-device-inventory/v1/backup-restore`：校验、预览或导入 JSON 备份。

插件设置保存在 `npcink_device_inventory_v3_options`。卸载时仅当设置中允许删除数据时，才会删除插件表和设置项。

## JSON 备份恢复契约

后台“JSON 备份导出/导入”用于同版本插件之间迁移或归档业务数据。导出由服务端在同一个数据库一致性快照中完成，避免前端逐页请求得到跨时点数据；导入接口接受 `npcink-device-inventory/v3-admin-export` schema，默认先用 `dryRun: true` 生成预览摘要，再由管理员确认后执行实际导入。

- 备份 JSON 最大 50 MiB，恢复请求包装层最大 51 MiB；每个数据区段最多 10000 行，`identities` 会按嵌套身份明细展开计数。导出和恢复使用同一组限制。
- dry-run 会返回 `available`、`planned`、`skipped`、`conflicts` 和 `warnings`；即使存在冲突也返回成功预览，前端会阻止继续导入。
- 非 dry-run 导入如果存在冲突会返回 409；schema 不匹配返回 422；体积或行数超限返回 413。
- 资产按 UUID 和资产编号合并。UUID 与资产编号命中不同资产时视为冲突；仅资产编号命中时会更新资产字段但保留正式站点原 UUID。
- 资产缺少 UUID 时会在实际导入时生成新 UUID 并在预览中提示；资产缺少 `createdAt` 或 `updatedAt` 时会使用导入时的当前时间。
- 设备匹配标识按 `identity_type + identity_value` 全局去重；同一标识属于其他资产时视为冲突，备份内重复项会跳过并提示。
- 电脑采集快照和变更记录要求备份内时间有效；缺失或无效时间不会被替换为当前时间，而是跳过并提示。
- 设置只恢复保留天数、资产编号前缀、折旧参数、统计口径和卸载删除开关。上传授权码和客户端上传基础 URL 不会从备份恢复。
- 导入会先保存原设置；如果表数据写入失败，会回滚表事务并恢复原设置。

## 认证与接口

REST namespace 为 `npcink-device-inventory/v1`。

- 管理端接口需要当前用户具备 `manage_options` 权限，并通过 WordPress REST nonce。
- 设备上传使用 `/wp-json/npcink-device-inventory/v1/device-observations`，必须使用后台生成的完整授权码。客户端会用 timestamp、nonce、body hash 和 HMAC 签名提交。
- 新建授权码时只显示一次完整密钥和桌面导入 JSON；之后只能启停或删除，服务端不提供密钥回读。
- 软件端可填写站点首页、`/wp-json`、`/wp-json/npcink-device-inventory/v1` 或完整上传 endpoint，客户端会自动归一化到 v3 上传接口。

## 本地验证

PHP 与 WordPress 插件检查：

```bash
composer install
composer run phpstan
composer run phpcs
```

后台管理端：

```bash
cd vite-admin
npm ci
npm run build
```

统一版本、PHP 离线夹具和桌面质量门：

```bash
npm run check:versions
npm run check:fixtures
npm run check:desktop-quality
```

桌面质量门包含 `cargo fmt`、Clippy、Rust 测试，以及两个 Cargo lockfile 的 RustSec 漏洞审计。
首次运行前需要安装审计命令：`cargo install cargo-audit --locked`。

已启动本地 WordPress 站点后，可执行真实迁移演练。该脚本会创建 `RESTORE-E2E-*` 临时资产，验证 dry-run、导入、重复导入预览、冲突 409，并在结束时清理演练数据：

```bash
WP_PATH="/path/to/wordpress" \
bash scripts/verify-local-backup-restore.sh
```

也可以用一次性 Docker 环境完成发布包验收：

```bash
npm run check:docker
```

该命令构建并核对字节一致的 release/submission ZIP 与 submission manifest，在独立 Compose project 中启动 MariaDB 11、WordPress PHP 8.3 和 WP-CLI，安装 release ZIP，运行固定版本的官方 Plugin Check 与真实备份恢复演练。默认不暴露宿主端口；成功或失败都会删除本次容器、网络和数据卷，不会复用或清理其他 Docker 项目。首次运行需要联网拉取镜像和 Plugin Check。

需要验证其他兼容组合时可覆盖镜像或 Plugin Check 版本：

```bash
NPCINK_DOCKER_WORDPRESS_IMAGE="wordpress:php8.3-apache" \
NPCINK_DOCKER_DB_IMAGE="mariadb:11" \
NPCINK_DOCKER_CLI_IMAGE="wordpress:cli-php8.3" \
NPCINK_PLUGIN_CHECK_VERSION="2.0.0" \
npm run check:docker
```

Rust/Tauri 上传器：

```bash
cd ele-rs
npm ci
cargo test
npm run build
```

本地端到端 HMAC 验收需要已安装并启用插件的 WordPress 站点：

```bash
WP_PATH="/path/to/wordpress" \
SITE_URL="https://example.local" \
DEVICE_NOTE="验收设备" \
bash .github/scripts/verify-local-e2e.sh
```

HMAC 验收会先拒绝覆盖身份相同的已有资产；对于本次明确创建的数据，退出时会清理临时授权码、资产、身份、快照和事件，避免默认保留本机硬件信息。终端只显示最小验收摘要，不输出完整硬件响应。

## 发布打包

生成 WordPress 插件 zip：

```bash
cd /path/to/npcink-device-inventory
npm ci --prefix vite-admin
npm run build:release
npm run check:release
```

输出文件：

```text
release/npcink-device-inventory.zip
```

默认发布构建只保留 `release/npcink-device-inventory.zip`。如果需要生成 WordPress.org 提交目录中的同名 zip，显式运行：

```bash
npm run build:submission
npm run check:submission
```

插件包只包含 WordPress 运行文件、语言文件、许可证/README 和 `vite-admin/dist` 构建产物；不会包含 `ele-rs/`、`node_modules`、Rust `target` 或本地发布缓存。

GitHub Actions 的 `Build preview packages` 可生成预览包；推送 `v*` tag 会触发正式 release workflow。

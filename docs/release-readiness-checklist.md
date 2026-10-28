# 发布前检查清单

## 目标

这份清单用于每次发布 `Npcink Device Inventory` 前做最后验收。它覆盖代码静态检查、前端构建、发布包结构、桌面更新清单和本地后台冒烟测试。

tag 构建只创建不可覆盖的草稿候选；人工验收后发布同一批制品。完整流程及正式自动更新的后置验收边界见 `github-release.md`。

## 自动检查

在仓库根目录运行：

```bash
cargo install cargo-audit --locked # 首次运行一次
npm run check:release
```

该命令面向日常 GitHub release 包，只检查 `release/npcink-device-inventory.zip`，并要求仓库中不存在陈旧的 `sj/npcink-device-inventory.zip`。它会依次执行：

- `npm run check:release-tools`：命令超时/子进程、版本递增及制品完整性回归。
- `npm run check:versions`，确认插件、README、桌面 Node/Tauri/Cargo 版本契约一致；tag release 还要求 tag 与插件版本一致。
- `npm run check:release-scope`，验证插件与桌面发布范围判定规则。
- 后台硬件盘点 fixture、ESLint 和生产构建。
- WordPress.org 人工审核规则检查。
- `npm run check:fixtures`，集中执行备份恢复、搜索、资产写入、上传边界、当前 schema、当前身份契约、身份占用和采集事务等 PHP 回归夹具。
- PHPStan 与 PHPCS。
- `npm run check:desktop-quality`，执行桌面前端构建、两个 Rust crate 的 fmt、Clippy、测试和 Cargo lockfile 漏洞审计。
- `git diff --check`，检查空白字符问题。
- 发布 zip 结构和 WordPress.org 规则检查，并逐文件对比 zip 内后台构建产物，避免发布旧资源。

如果 zip 不存在，先运行：

```bash
npm run build:release
```

再重新执行 `npm run check:release`。

如果本次要提交 WordPress.org，并且开发机可用 Docker，按以下顺序运行：

```bash
npm run check:docker
npm run check:submission
```

Docker 门禁会构建本次最终的 release/submission ZIP；随后 submission 检查会验证这两个不再重建的制品，并对比 SHA-256，确认提交包和 Docker 实测通过的 release 包完全一致。

其中 `check:docker` 是每个发布候选的独立真实环境门。它先构建并核对字节一致的 release/submission ZIP 与 submission manifest，再使用一次性 MariaDB 11、WordPress PHP 8.3 和 WP-CLI 环境安装当前 release ZIP，运行固定版本的官方 Plugin Check，并执行真实备份恢复演练。它没有并入 `check:release`，以免无 Docker 环境的日常检查或 CI 被基础设施条件误伤；发布候选记录中应单独保存其结果。

## Eval Lab 对抗式质量门

发布前可以运行本地只读 eval-lab 质量门：

```bash
composer eval:project:quality-gate
```

该命令通过 `scripts/eval-lab.sh` 调用相邻的 `npcink-eval-lab` checkout，或使用 `NPCINK_EVAL_LAB_PATH` 指向其它位置。它只生成本地评估报告，不写 WordPress，不进入插件发布包，不替代 `npm run check:release`、GitHub Actions 或真实机器 smoke。

## WordPress.org 人工审核规则

2026-06-26 的插件审核反馈说明：PCP / Plugin Check 通过不代表人工审核规则全部覆盖。发布前必须额外确认：

- 不得在源码或构建产物中硬编码 `/wp-admin/admin-ajax.php` 或 `/api/wp-admin/admin-ajax.php`。如果确实需要 Ajax endpoint，必须在 PHP 中使用 `admin_url('admin-ajax.php')` 计算地址，再通过 `wp_localize_script()` 或等价方式传给 JS。
- `wp_localize_script()` 暴露到 `window` 的对象名必须使用插件唯一前缀。当前约定是 `npcinkDeviceInventoryData`，不得使用 `dataLocal` 这类泛名。
- 不要从旧调试文档或历史构建产物中恢复 `dataLocal`、静态 `admin-ajax.php` 路径、`vite-search` 旧发布说明。

这些规则已经固化在：

```bash
node scripts/check-wordpress-org-review-rules.mjs
node scripts/check-wordpress-org-review-rules.mjs release/npcink-device-inventory.zip
```

如果这个检查失败，先修源码并重新 `npm run build:release`，不要只手改 `dist` 或 zip。WordPress.org submission 发布前由 `npm run check:submission` 额外检查 `sj/npcink-device-inventory.zip`。

## 桌面更新清单检查

只有桌面范围的 tag release 才会生成新的 `latest.json` 和
`latest-desktop.json`，随后执行：

```bash
npm run check:desktop-manifests -- artifacts
```

该检查会确认：

- `ele-rs/package.json` 和 `ele-rs/src-tauri/tauri.conf.json` 的桌面端版本一致。
- `latest.json` 和 `latest-desktop.json` 的版本号与桌面端版本一致。
- `latest.json` 同时包含 `darwin-aarch64` 和 `windows-x86_64` 平台。
- updater 平台条目都有签名。
- 下载地址和 release 地址都是 GitHub Release URL。
- URL 中不得出现空格或 `%20`，避免 GitHub Release 资产名空格变点号后下载失败。

纯插件 release 不构建桌面制品，但会把上一份 `latest.json` 和
`latest-desktop.json` 原样带到新 Release。这样 `releases/latest/download/`
仍能为现有桌面客户端提供最后一次桌面发布的更新信息；不要在插件
release 中重新生成或手动修改这两个文件。

正式桌面更新发布前，还要人工确认本机安装的是上一版正式 Release 包，而不是本地开发构建包；不要复用相同桌面版本号发布不同内容。

以下预检仅支持 macOS，不代表 Windows 升级验收。在真实 GUI 更新 smoke 前，可以先用上一版 app bundle 和本次 release 资产做升级路径预检：

```bash
npm run check:desktop-update-transition -- --previous-app="/path/to/Npcink Device Agent.app" --artifacts="/path/to/downloaded/release-assets"
```

该检查确认上一版 app 的 `CFBundleShortVersionString` 小于本次 `latest.json` / `latest-desktop.json` 版本，并确认 macOS Tauri updater 包、签名和 DMG 下载地址都指向 GitHub Release。它不能替代真实 app 内“检查更新 / 下载安装并重启”的 GUI smoke。

## 本地后台冒烟

在本地 WordPress 后台打开：

```text
http://device.local/wp-admin/plugins.php?page=npcink_device_inventory_settings
```

至少确认：

- 页面能进入 `电脑设备`，资产卡片正常显示。
- 资产详情弹窗能打开，并显示 `硬件信息`、`详细信息`、`自动记录`、`手动记录`、`设置`。
- 搜索资产编号能过滤出目标资产。
- `数据工具` 中的标准资产表格导入能下载模板、生成预览并按资产编号新增或更新。
- `卡片` / `列表` 视图能切换。
- `批量模式` 能进入和退出。
- `硬件盘点` 页面能显示摘要、硬件概览和问题面板。
- 浏览器控制台没有新的 error。

## REST 权限检查

未登录状态下确认：

```text
GET  /wp-json/npcink-device-inventory/v1/assets                 -> 403
GET  /wp-json/npcink-device-inventory/v1/settings               -> 403
POST /wp-json/npcink-device-inventory/v1/device-observations    -> 401
```

## 干净安装检查

当前开发站点通常是源码软链接挂载。正式提交前仍应额外准备一个干净 WordPress，上传 `release/npcink-device-inventory.zip`，确认：

- `npm run check:docker` 已通过，证明 ZIP 可在一次性环境安装、启用，并通过官方 Plugin Check 和真实恢复演练。
- 插件可启用，无 fatal error。
- 后台菜单出现。
- 首次进入后台页面无 JS 错误。
- REST 路由注册成功。
- 插件停用再启用后数据表和设置仍正常。

## 桌面上传器冒烟

发布桌面包前至少确认：

- GitHub Actions preview 能分别构建 `macos` 和 `windows` 桌面包。
- macOS 安装包仍标注为内部测试；正式外部分发前必须补 Apple Developer ID 签名和公证。
- Windows 普通用户和管理员分别完成采集，源代码烟测明确列出 skipped/manual，不能当作安装包通过。
- Windows 最终候选 exe 可在干净机器安装、启动、采集并向独立 HTTPS 站点上传；检查 WebView2、中文路径、配置与 Credential Manager 凭据保留、卸载保留策略。
- 从正式 Agent 0.4.4 用候选安装包升级，核对版本递增、配置保留和失败恢复。
- Tauri updater 签名与 Windows Authenticode 分别记录；当前无 Authenticode，只用于信任的内部环境。
- 插件 3.2.4 与 Agent 0.4.5 配套使用签名v2；旧客户端会被拒绝，授权码无需重发。
- 私有草稿不能被上一版固定 latest endpoint 发现。发布前验证签名/manifest及手动安装升级；人工发布已验草稿后，在测试安装上补真实自动更新 smoke，再向工作设备推广。
- 设置页“软件更新”和原生菜单“检查更新”都能触发同一套更新检查。
- 从上一版正式 Release 包升级到新版，版本号、下载地址和安装进度显示正常。

每次 release candidate 使用 `docs/release-candidate-verification-template.md` 记录本地命令、GitHub Actions preview、tagged release artifacts、桌面更新和上传冒烟结果。

## 提交前确认

- 不提交本地旧数据备份目录。
- 不提交临时截图；`sj/assets/screenshot-1.png` 到 `screenshot-5.png` 是明确标记为不得发布的历史对照文件，3.0 界面冻结后重新采集。
- 不提交 `node_modules`、`vendor`、`.release-build` 或额外 zip。
- 日常 GitHub release 使用 `release/npcink-device-inventory.zip`。
- 上传 WordPress.org 前运行 `npm run check:docker`（会构建最终双 ZIP）和 `npm run check:submission`；随后直接使用该哈希对应的 `sj/npcink-device-inventory.zip`，不再次构建。
- 记录候选 commit、版本、ZIP/exe/manifest 哈希、Windows实机结果；未提交的源码不属于远端候选。
- 正式发布只发布已验草稿，不覆盖现有版本资产；发布后检查 `Verify published candidate` 并完成官方更新入口 smoke。

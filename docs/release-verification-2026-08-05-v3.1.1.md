# Release Verification 2026-08-05 v3.1.1

## 发布对象

- Git tag：[`v3.1.1`](https://github.com/npcink/npcink-device-inventory/releases/tag/v3.1.1)
- 提交：`d958fb9`
- WordPress 插件：3.1.1
- Device Agent：0.3.2
- GitHub Actions：[`30972130261`](https://github.com/npcink/npcink-device-inventory/actions/runs/30972130261)

本次是针对真实设备试点的收敛修复：WordPress 增加旧 v1 → v2 迁移冲突保护；Agent 修复 Windows 物理网卡查询重试、JSON 数组处理和 PowerShell UTF-8 输出。未纳入完整在线观测面板。

## 修复范围

- 旧身份命中资产后，对比目标最近观测与本次上传的 v2 证据；完全不相交时返回 `409 legacy_identity_migration_conflict`。
- Windows 物理网卡查询先使用 `-IncludeHidden`，失败时退回兼容查询。
- 统一按 JSON 数组语义处理单个或多个网卡结果。
- PowerShell 子进程显式输出无 BOM UTF-8，避免中文“以太网”等名称导致 Agent 解码失败。

## 验证结果

本地和 CI 均通过：

- PHP fixture、PHPCS、PHPStan；
- React 管理端 lint 与构建；
- Rust collector 与 Tauri fmt、Clippy、测试和平台构建；
- 版本契约：插件 3.1.1、Agent 0.3.2；
- 发布 ZIP 边界与解包检查；
- RustSec 审计，仅保留既有允许的传递依赖警告；
- Docker WordPress 7.0.2、PHP 8.3、MariaDB 11；
- 官方 Plugin Check 2.0.0：`Success: Checks complete. No errors found.`；
- Docker 备份恢复演练；
- Windows 安装程序复下载后识别为有效 PE32/NSIS 包；
- `latest.json` 与 `latest-desktop.json` 均声明 Agent 0.3.2，下载地址指向 `v3.1.1`。

## 生产部署与实机结果

正式 WordPress 站点已通过后台上传 ZIP，将插件从 3.1.0 替换为 3.1.1。升级后插件保持启用，设备管理页正常加载，浏览器控制台无错误。

实机结果：

- 35 正确上传并定位到资产 35；
- 133 在中文网卡名称环境下可采集永久 PCI MAC 并正常上传；
- 103、174 正常上传；
- 32/35 历史身份和观测归属已经受控修复并复核。

## 公开制品

- [WordPress 插件 ZIP](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.1/npcink-device-inventory.zip)
  - SHA-256：`6fca4df442578983c34c2390ed36691e5d2f5200bed2a7c798d3c0f346b1d42a`
- [Windows x64 安装程序](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.1/Npcink.Device.Agent_0.3.2_x64-setup.exe)
  - SHA-256：`9ef4323aae14a4cb17b0306d901605c7c77d31b1e1fe3165b247d4c163417dd8`
- [macOS Apple Silicon DMG](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.1/Npcink.Device.Agent_0.3.2_aarch64.dmg)
- [桌面更新清单](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.1/latest-desktop.json)
- [官方 Plugin Check 结果](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.1/plugin-check-results.txt)

## 发布结论与后续边界

3.1.1 已完成开发、验证、生产部署和公开制品复核，可以作为当前运行基线。后续允许继续更新设备管理信息并让 Agent 上传硬件观测。

不因本次事故扩建完整在线观测平台。运行排障遵循 [`device-upload-troubleshooting-and-operations.md`](device-upload-troubleshooting-and-operations.md)，待全部存量资产至少完成一次 v2 上传后，再评估删除 v1 过渡查询。

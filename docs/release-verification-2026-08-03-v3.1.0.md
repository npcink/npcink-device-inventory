# Release Verification 2026-08-03 v3.1.0

## 发布对象

- Git tag：[`v3.1.0`](https://github.com/npcink/npcink-device-inventory/releases/tag/v3.1.0)
- 提交：`10ad644bae5f3e15926ba06a24a4fe029ad5ea0a`
- WordPress 插件：3.1.0
- Device Agent：0.3.0
- 发布时间：2026-08-03 10:15 UTC

本次发布实现硬件身份 v2。详细行为见
[`identity-contract.md`](identity-contract.md) 与
[`ADR-004`](decisions/ADR-004-hardware-identity-v2.md)。

## 发布前与 CI 验收

本地发布门禁已覆盖版本契约、PHP fixture、静态检查、前端构建、Rust fmt/Clippy/test、依赖审计和发布包规则。tag 推送后的 [GitHub Actions #30803510577](https://github.com/npcink/npcink-device-inventory/actions/runs/30803510577) 最终为 `success`：

- 发布范围和版本契约通过；Rust 依赖审计通过。
- WordPress 插件 ZIP：PHP 语法、PHPCS、PHPStan、回归 fixture、后台构建和 Plugin Check 全部通过。
- macOS 与 Windows Device Agent：Rust 采集器、Tauri shell、桌面前端、更新签名检查和平台打包全部通过。
- Release job 生成并校验双平台更新清单及签名。

## 公开制品复核

公开 Release 已包含插件 ZIP、macOS DMG/App archive、Windows NSIS 安装程序、更新清单和签名。独立复下载确认 Windows 文件为有效 NSIS PE 安装程序，版本为 0.3.0；公开摘要为：

```text
Npcink.Device.Agent_0.3.0_x64-setup.exe
SHA-256: 5ef13913665fe52e889445d54db4d1095672fcc5eef5445069b76295d338168e
```

直接下载：

- [WordPress 插件 ZIP](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.0/npcink-device-inventory.zip)
- [Windows x64 安装程序](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.0/Npcink.Device.Agent_0.3.0_x64-setup.exe)
- [macOS Apple Silicon DMG](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.0/Npcink.Device.Agent_0.3.0_aarch64.dmg)
- [桌面更新清单](https://github.com/npcink/npcink-device-inventory/releases/download/v3.1.0/latest-desktop.json)

## 部署与后续观察

先升级 WordPress 插件 3.1.0，再部署 Device Agent 0.3.0。升级后观察旧 v1 资产的第一次上传：应唯一匹配既有资产并原子补写 v2 身份；多个证据命中不同资产时应返回 409，不能自动合并。

该发布已经完成。后续工作仅基于真实使用中重复出现、可验收的问题开展，避免重新扩张产品范围。

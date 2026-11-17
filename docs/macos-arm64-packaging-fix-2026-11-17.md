# Mac M 系列安装包“已损坏”修复（2026-11-17）

> 本文保留签名问题的根因与早期本地修复证据。当前交付已使用包含后续精简和上传修正的 CI 构建，安装包、校验和及验收范围见[最新实施与交接](simplification-implementation-2026-11-17.md)。下述本地包不再作为最新安装包推荐。

用户要求按当前代码重打 Apple Silicon 安装包，并处理 Agent 0.4.4 的安装提示。客户端当前版本为 0.4.6，本次保持版本号和应用标识，交付为本地重新构建的内部安装包，不发布正式版本或自动更新清单。

## 根因证据

从 GitHub 正式发布 v3.2.3 下载 `Npcink.Device.Agent_0.4.4_aarch64.dmg`，其 SHA256 为 `af8cd157558dc24d18c375dc656b24896d646075cbac8942c5a979d12f86fde3`，与发布的校验和一致，`hdiutil verify` 通过。

镜像内 App 没有 `Contents/_CodeSignature/CodeResources`，只保留链接器的临时二进制签名；签名显示 `Info.plist=not bound`、`Sealed Resources=none`。完整包的 `codesign --verify --deep --strict` 和 `spctl` 均失败，报 `code has no resources but signature indicates they must be present`。11 月 10 日的本地 0.4.6 预览包也有同样问题。因此已确认发布包存在完整 App 签名缺失，而非镜像文件传输损坏；未检查用户设备上那份下载文件。

## 修改

- macOS 构建默认使用 `signingIdentity: "-"` 对完整 App 做 ad-hoc 签名，绑定应用标识、Info.plist 和资源。
- 增加 `tauri:build:macos` 命令，固定 Apple Silicon 目标，使用锁定依赖生成 App 和 DMG。
- 增加 `verify-macos-bundle.mjs`，只读挂载镜像，检查校验和、版本、标识、arm64、资源签名和完整包签名；单独输出 Gatekeeper 判定，不能把 ad-hoc 完整性校验说成 Apple 自动信任。
- 预览和正式构建流程均加入镜像内 App 校验，预览制品路径同步到显式目标目录。配置了 Developer ID 的环境可通过 `APPLE_SIGNING_IDENTITY` 覆盖默认身份。

## 交付与验证

目录：`release-preview/macos-0.4.6-20261117/`。DMG 为 `Npcink Device Agent_0.4.6_aarch64.dmg`，SHA256：

`bae661a1abde9a10939dde6f0fe0829cee20a2ad8173874c5b42f146f2d23c17`

新镜像校验、完整包签名和 arm64 检查通过；新的校验脚本会拒绝旧 0.4.6 镜像。采集器 65 项、桌面 12 项测试通过，两个 crate 的 fmt / Clippy 通过，桌面 npm 审计为 0 漏洞，版本合同及 Actions 运行时检查通过。构建来源和源码摘要随包保存。

本机无可用 Developer ID 身份，也没有公证凭据。新包签名有效，但 Gatekeeper 评估仍为 rejected；首次启动需要用户在“隐私与安全性”允许打开。随包说明提供仅针对该 App 的隔离标记处理方法，不关闭 Gatekeeper。

本次没有修改本机已安装客户端、启动采集或上传真实设备数据，也没有验证覆盖安装、正式自动更新或发布到 GitHub。正式 updater 清单未生成，现有 `check:desktop-manifests` 因缺少 `artifacts/latest.json` 无法执行；不以本次内部 DMG 验证代替正式发布门禁。原始检查和构建日志留在 `.local-backups/macos-packaging-20261117/`。

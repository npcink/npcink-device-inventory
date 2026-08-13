# ADR-014: 将发布完整性与 Node.js 24 运行时作为强制门禁

## Status

Accepted

## Date

2026-08-13

## Context

v3.1.4 首次正式发布暴露了两个流程缺口：

1. PR 质量工作流没有执行 WordPress Plugin Check，因此一个固定 SHA 的转录错误
   直到正式 tag 发布才暴露；
2. 发布流程确认了 artifact 上传成功，却没有在上传后重新下载并验证签名、哈希和
   ZIP 可解压性。

同时 GitHub Actions 已将 Node.js 20 action 迁移到 Node.js 24。继续保留旧 revision
会产生警告和未来的不确定性。

## Decision

发布链路采用三层强制门禁：

1. 上传前验证 release manifest、资产命名、ZIP 结构、updater signature 与应用内
   public key 的密码学一致性；
2. 生成 `SHA256SUMS`，上传后从 GitHub Release 下载所有资产并逐文件比较；
3. 所有核心 GitHub Actions 固定到已确认使用 Node.js 24 的 revision，并由
   `check:action-runtimes` 防止旧 revision 回流。

发布脚本和 workflow 变更属于 desktop release scope。桌面 updater、项目 URL 和
白名单统一使用 canonical `npcink/npcink-device-inventory` 仓库地址。

## Alternatives Considered

### 只依赖 PR Quality CI

拒绝：发布专用 action、tag 条件和权限路径不会被普通 PR 工作流覆盖。

### 只检查 artifact 元数据

拒绝：上传成功不代表用户下载到的内容、签名或 manifest 引用一致。

### 在脚本中引入新的 Node/Rust 签名库

拒绝：CI 已可安装 `minisign`，项目已有 Tauri/minisign 兼容格式；标准工具更容易
审计、复现和跨环境维护。

### 继续使用旧仓库地址以兼容历史链接

拒绝：更新端点、URL 白名单和项目入口必须唯一；历史 Release 地址继续由 GitHub
重定向承担，不把运行时真相分成两套。

## Consequences

### 正面

- 固定 SHA 错误会在发布前或发布后立即失败，而不是静默产生坏 Release。
- updater 签名、manifest、下载文件和 ZIP 内容形成可审计证据链。
- Node.js 24 迁移有自动防回退机制。
- 发布 scope 能覆盖发布治理脚本，避免只发布插件而漏掉桌面发布风险。

### 成本与边界

- Release job 会增加 minisign 安装和二次下载时间。
- 网络不稳定时校验可能受下载路径影响；CI 使用重试，人工本地验证应显式配置
  代理或使用 CI 结果。
- updater signature 验证不等同于 macOS 公证或 Windows Authenticode；平台安装
  smoke 仍需人工完成。


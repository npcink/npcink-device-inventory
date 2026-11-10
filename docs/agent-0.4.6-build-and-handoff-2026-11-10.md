# Agent 0.4.6 构建与电脑更新交接（2026-11-10）

用户授权处理前述待办并提供最新安装包，由用户更新真实电脑数据。当前只推进依赖修复、联网审计、安装包构建及隔离验收，真实电脑采集结果以用户安装后的回执和硬件 JSON 为准。

## 源码与依赖处理

本次沿用分支 `codex/scope-simplification-closeout`。桌面冻结构建源码为 `6773974432edc065454398f6b77494ba2d5b3685`，插件最终源码为 `8944d7d1b3ff6abe2a55578865617bc21a9d70ef`；两提交的 `ele-rs/` 内容完全相同。为区别旧的 0.4.5 测试包，Agent 的 Node、Tauri、两个 Cargo manifest 及三个锁文件自有包版本统一升为 **0.4.6**；插件仍为 **3.2.4**。已将测试分支推送供 GitHub runner 构建，未合并 master、打 tag 或正式发布。

后台 10 项 moderate 均指向 minimatch 10 的 GHSA-g3hv-75wg-m249。核查时，最新 ESLint 和 TypeScript ESLint 仍声明依赖 minimatch 10，而该公告的修复版本为 11.0.1 及以上。针对 `minimatch@10` 精确 override 为 11.0.5，保留 ExcelJS 使用的旧 major，不降级 ESLint，不运行 `audit fix --force`，不增加审计忽略。

干净 `npm ci` 及后台完整依赖审计均为 0 漏洞。升级前后真实 ESLint 扫描的 55 个文件路径一致，错误 / 警告均为 0；构建、硬件 / 财务 / 保存 / 缓存回归及分析分页通过。minimatch 11.0.5 支持 Node 20 / >=22；项目 CI 使用 Node 24，本地使用 Node 22。待上游直接支持修复 major 后可评估移除 override，不需恢复旧漏洞版本。

RustSec 已经系统代理成功联网刷新至 `d9cb059f3217db87aeccd190b81eaffe8cc29cb9`（公告库最后更新 2026-11-09），检查两个 lockfile 均没有漏洞。仍有 5 条既有 informational 提示：proc-macro-error、zbus_names、zvariant、zvariant_derive 未维护及 glib unsound；无新增 ignore。桌面完整质量门通过：生产构建、fmt、Clippy、采集器 65 项及桌面 12 项测试、npm / RustSec 审计。

## 插件与完整门禁

在 M4 新建隔离测试目录，对最终插件源码执行完整 `npm run check:docker`，安装、官方 Plugin Check 2.2.0、真实 REST / 数据库回归、备份恢复及多站点均通过，测试容器 / 卷 / 网络自动清理。

将 Docker 实测的同一份 ZIP 复制为本地 release / submission / 交付包，没有再次重建。随后完整 `npm run check:submission` 通过，包含此前被 npm 审计阻断的全部后续检查、桌面联网质量门、包体和制品比对。

交付插件 ZIP SHA256：`32ec55d220d5d29992359ea628eeb75488009bdfb237c91c93c3795e5f844135`。包内 132 个对应本地文件逐一字节比较一致。Linux CI ZIP 的 SHA256 为 `2e3caba7ab3bf77f38638e9d1fb3a40441ea753464de406110ee4f8614e6296a`；两包 ZIP 元数据不同，但全部 132 个文件内容逐一比较一致。交付的是 M4 实测的 ZIP。

## 安装包构建

[GitHub preview run 42788533222](https://github.com/npcink/npcink-device-inventory/actions/runs/42788533222) 的 Windows / macOS 作业均成功。该 run 的插件作业失败于最新 Plugin Check 2.2.0 的新增规则：主 PHP 头部重复声明 Tested up to，以及后台内联 React。保留失败证据后，移除 PHP 中的重复字段，打包 manifest 改从 README 读取兼容版本；生产构建使用 WordPress 提供的 React / ReactDOM 和 wp.element.createRoot，并声明 wp-element 脚本依赖。独立 Vite 开发模式继续使用本地 React。构建期间检查所有模块，发现打入 react / react-dom 即失败，没有忽略 Plugin Check 规则。Docker 默认检查版本同步为 2.2.0。

修复后插件专用 [preview run 42790115312](https://github.com/npcink/npcink-device-inventory/actions/runs/42790115312) 成功，通过 Plugin Check 2.2.0。桌面源码未改变，沿用已经成功构建的同一批安装包。最终插件再次通过完整 check:submission，包括后台审计 0 漏洞、桌面联网门禁、包体与 manifest 比对。

真实 WordPress 页面加载复验：M4 隔离站点上的 WordPress 7.1.4 使用核心 React 18.3.1，六个工作区及自定义资产新增弹窗加载正常，浏览器 0 错误 / 0 警告；随后在同一临时站点改用最低支持版本 WordPress 6.5，确认使用核心 React 18.2.0、wp.element.createRoot 可用，六个工作区正常渲染，浏览器同样 0 错误 / 0 警告。测试账号为临时账号，全部操作均在隔离站点，没有操作真实资产。最低版本检查只覆盖后台加载，不扩展为该版本的完整数据库回归。

Windows preview 增加沿用现有脚本的无上传采集烟测，仅上传摘要，不上传完整硬件 JSON、客户端授权或凭据。摘要中的 hardware.inspect、hardware.upload-inspect、device-id 均 passed，上传与排障探针明确 skipped；构建和 Cargo 测试虽在烟测摘要中 skipped，但已由同一作业此前独立步骤完成。该烟测不验证安装、升级、真实上传或平台签名。

已通过 GitHub API 获取原始 artifact ZIP，按 API 的 SHA256 digest 校验后再解包。Windows NSIS 引导器为 PE32，实际内含桌面程序为 AMD64（PE machine 0x8664），版本资源包含 0.4.6、无 Authenticode 证书。macOS DMG 只读挂载核对版本 0.4.6 / arm64 后卸载，没有启动程序或改写用户配置。

| 制品 | SHA256 |
| --- | --- |
| Windows x64 `Npcink Device Agent_0.4.6_x64-setup.exe` | `f7c42c52e0cc23ea262cfc7f70c70ce7ca6c5322ccf85a8383d471b72fc4c62b` |
| macOS arm64 `Npcink Device Agent_0.4.6_aarch64.dmg` | `fe93972f2059992ded32bb40c56ebd7def15a53272fbfa8bfd1357e878cae0d9` |

交付目录：`release-preview/windows-0.4.6/`、`release-preview/macos-0.4.6/` 及 `release-preview/plugin-3.2.4-agent-0.4.6/`。Windows 目录包括电脑更新说明、可选编号探针、构建来源与校验和。完整证据留在忽略目录 `.local-backups/agent046-acceptance-2026-11-10/`。

便于转发的 Windows 合集：`release-preview/npcink-device-agent-0.4.6-windows-x64.zip`，SHA256 为 `99cc44f8df884ad6dbabe2ce6bcb825a700fb972f5809943609d9b5f1cbf9a2d`。安装包解出后与原 EXE 字节一致。各平台安装包及插件校验和另存于 `release-preview/agent-0.4.6-SHA256SUMS.txt`。

验收结束后已移除本次 M4 临时目录及专用 Compose 容器 / 卷 / 网络，关闭临时浏览器和 SSH 端口转发；源码和验收证据保留在本地工作区。未停止 M4 上的其他项目服务。

Preview 流程不生成 updater 签名，不是正式自动更新候选；真正的签名草稿和发布放行继续遵循 ADR-018，不能将本次手工安装包宣称为签名自动更新通过。

## 设备续办

用户安装新版后，先核对一台已有资产的采集、上传回执和后台快照，再逐台更新。42、66、87 需新的有效 v2 身份证据，161 需确认回执仍属于原资产。前序上传故障需本次实际状态 / 错误码 / 时间才能判断是否复现或已经消失，源码错误提示修复不能代替根因证据。

完整硬件 JSON 和真实设备数据不提交公开仓库。真实电脑上的普通用户 / 管理员采集、覆盖安装配置保留、最终签名候选及正式自动更新依旧分别记录，不能用 GitHub 虚拟机采集代替这些结果。

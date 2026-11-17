# 精简实施与安装包交接（2026-11-17）

本次落实[审计建议](remaining-work-and-redundancy-audit-2026-11-17.md)，收尾已有后台修改，不继续删除主功能。插件保持未正式发布的 3.2.4，Agent 保持内部预览版 0.4.6；通过日期、源码提交和 SHA256 区分制品。未操作真实站点数据，也未正式发布或更新 updater 清单。

## 已完成

- 删除无目标文件的 demoConfig 构建别名、无人消费的 locale / labels 注入链路、无调用参数工具、旧业务错误码映射和不可达错误分支。保留当前 REST 错误原文、状态回退、WordPress nonce 刷新和防重复提示。
- 删除只被旧测试维持的 collectionFreshness 包装，保留实际采集分级和 180 / 270 天阈值；删除 index_exists、get_loader 和未使用的 Loader filter 注册能力，保留 action 启动和 Activator 继承的表名属性。
- 在干净目录安装、构建并确认无 Less 后，删除直接依赖及其不再需要的锁文件条目。esbuild、autoprefixer 和 WordPress React 构建桥接继续保留。
- 退出隐藏的 metadata.audit.ignoredFields 分析规则。受控样本原本会隐藏 6 条重复 IP / 硬件缺失提醒，现在结果不再受旧忽略字段影响。现存本地 JSON 备份未检出该键，未据此推断真实站点也没有；不清空或改写历史 metadata。回归同时验证分析无写入。
- 电脑详情只有进入“调试”并展开对应面板才请求身份或采集历史；自定义资产不请求这两类资料。采集记录显示服务端总数，每页 20 条，可查看后续页；身份、采集请求失败显示内联错误和重试。切资产 / 重开详情重置面板、页码和搜索。
- 趋势查询限定在分析概览；保留当前单资产快照和分析接口。变更记录仍有最近 30 条的有界展示，并明确更多历史的查看入口。
- 收尾后台错误 / 加载状态、禁用无数据时的导出和批量操作、设置未保存内容保护、令牌创建期间关闭保护和关闭后清除 secret、日期选择器、缓存失效和中文分页；移除仅作用当前页却容易被当作全局的变更排序 / 筛选和资产局部计数。
- macOS 完整 App 签名校验进入 preview / release workflow，显式 arm64 预览路径。ad-hoc 包完整性和 Gatekeeper 信任分别报告，详见[打包修复](macos-arm64-packaging-fix-2026-11-17.md)。
- 另一聊天独立提交的[上传错误与有限重试](upload-network-resilience-2026-11-17.md)已包含在本次冻结源码。最终联网审计另外发现并更新 quinn-udp 0.5.15 → 0.5.16、rustix 1.1.4 → 1.1.6、撤回版本 async-executor 1.14.0 → 1.14.1。

## 验证

- 完整 `npm run check:submission` 通过：发布工具测试、后台 npm 审计、版本 / 范围合同、硬件审计 / 分析分页 fixture、ESLint、TypeScript / 生产构建、包体预算、全部 PHP fixture、PHPStan、PHPCS、桌面质量门与 ZIP / manifest 一致性。
- 桌面共享库 74 项、桌面工程 13 项测试通过，两个 crate fmt / Clippy 通过，后台和桌面 npm 审计均 0 漏洞。
- RustSec 数据库刷新到 2026-11-15 的 `02e2517f`；两个锁文件无漏洞错误。仍保留 5 项上游 informational 提示：proc-macro-error、zbus_names、zvariant、zvariant_derive 的维护提示和 glib 的 unsound 提示；没有增加忽略项。
- M4 隔离 Docker 最终包验收通过：WordPress 7.1.4、PHP 8.3、MariaDB 11、Plugin Check 2.2.0、真实 REST / 数据库、nonce 重放 / 限流、备份恢复和多站点升级。容器 / 数据卷在脚本结束后清理。
- M4 浏览器使用从已验 ZIP 安装的实际 WordPress 生产 React 运行时；用合成资产验证技术请求延迟、21 条历史的第 2 页、身份 / 采集错误及手动重试、切资产状态重置；自定义资产技术请求为 0、令牌创建期间不能关闭 / 关闭后密钥清除、重新查询设置保留未保存的 60 个月输入、导出预览失败禁用导出且重试恢复。故障注入使用本地 403 响应，浏览器对应 403 日志属于预期测试结果。
- 本地初建 ZIP 与 M4 部署 ZIP 的每一个文件内容 SHA256 完全相同。之后将 M4 实测 ZIP 原始字节同步到 release / sj，并再次通过完整 check:submission，交付包与两套门禁对应同一份字节。
- Windows 单独重跑成功：共享采集库 73 项、桌面工程 13 项测试通过，构建及无上传采集烟测通过。烟测的 hardware.inspect、hardware.upload-inspect、device-id 均 passed；构建和 Cargo 测试在烟测摘要中 skipped，但已由同一作业此前步骤完成。上传、安装、升级和平台信任不在该烟测验证范围内。

原始日志和环境证据保存于 `.local-backups/simplification-20261117/evidence/`；不将合成验证当作真实电脑安装 / 上传验收。

## 安装包

统一交付目录：`release-preview/final-20261117-ci/`，含更新说明、`build-info.json`、`SHA256SUMS`、各平台验证记录及 Windows 采集烟测摘要。M4 / 浏览器临时环境、容器与数据卷已清理。

插件（M4 实测原包）：`release-preview/final-20261117-ci/npcink-device-inventory-3.2.4-preview.zip`。

SHA256：`55f12e01abfa833edd47fcc57681fcd6a354f82a7ba3679190a8093e888fdaaf`。

release / sj 的最终 submission 门禁包同样为上述 SHA256。

产品实现提交：`87caaf4`；后续 `27463fa` 只延长 Windows 本地代理拒绝测试的等待时间，不改变生产实现。首轮 Windows 的 1 秒请求预算先于系统返回拒绝，导致测试把正确的可重试超时当成不可重试拒绝；已改为 5 秒并重跑 [Windows preview](https://github.com/npcink/npcink-device-inventory/actions/runs/44057127865)。远端全平台 preview：[run 44056324930](https://github.com/npcink/npcink-device-inventory/actions/runs/44056324930)。其中插件与 macOS job 已成功；首轮整体状态为 failure，原因是上述已单独重跑的 Windows fixture，不将它称为全平台通过。

macOS CI 原始安装包：`release-preview/final-20261117-ci/macos/Npcink Device Agent_0.4.6_aarch64.dmg`。SHA256：`373705c1a79ad65c8c755ac09d1e832c381321db80bc31cab18bed7b6ff1f868`。下载后在本地重新只读验包，镜像、版本 / identifier、arm64 和完整资源签名全部通过；仍为 ad-hoc，Gatekeeper rejected，首次打开需要用户在系统中允许。该包替代 11 月 10 日和 11 月 17 日早先本地构建；旧证据不删除。

Windows CI 原始安装包：`release-preview/final-20261117-ci/windows/Npcink Device Agent_0.4.6_x64-setup.exe`。SHA256：`5aa76e066a49a44863511686adeeaabaa7f1f47cdab25e03cd8e66cc28644eac`。[Windows 重跑](https://github.com/npcink/npcink-device-inventory/actions/runs/44057127865)整体 success，安装包与烟测摘要的原始 artifact ZIP 下载后均与 GitHub API 的 SHA256 digest 一致。安装引导器 PE 格式有效、无 Authenticode 证书；不在 macOS 上把文件检查当作 Windows 实机安装通过。

## 剩余事项

1. 用户在真实电脑覆盖安装、重采和 HTTPS 上传：核对原配置 / 授权保留、上传 receipt 与原资产归属。历史编号 42 / 66 / 87 / 161 仅作核对线索，不代表当前仍故障。
2. 正式候选冻结后，按 ADR-018 完成签名、candidate.json / manifest / 校验和与同一批字节人工验收，再决定正式发布。内测不等于 Apple Developer ID / 公证、Windows 平台信任或正式自动更新已验收。
3. 不为上游 5 项 informational 提示扩大到本轮 GUI 框架重构；未来随兼容的 Tauri / Linux GTK 依赖升级复查。原生 WMI、特殊存储 / 多显卡拓扑等增强等待真实样本，不作为新一轮无限排查清单。

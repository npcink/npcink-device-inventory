# 本地预览接入与历史兼容清理（2026-10-27）

## 范围与结果

按用户授权，将当前工作区接入 Local.app 的 `http://device.local/`，并删除历史兼容代码。所有改动留在本地，未提交、推送或发布。当前契约见 [ADR-017](decisions/ADR-017-remove-historical-compatibility.md)；历史发布和事故记录保留，不代表当前仍支持其中的兼容路径。

## 本地站点

- 站点目录：`/Users/muze/Local Sites/device/app/public`。
- 插件目录通过符号链接指向 `/Users/muze/gitee/npcink-device-inventory`，插件已启用，管理端生产资源已构建。
- 环境：WordPress 7.1、PHP 8.2.29、MySQL 8.4.0。接入前无插件业务表，接入后四表建立，资产数为 0，schema revision 为 `20261027_current_model`。
- 接入前数据库备份：`.local-backups/device-local-20261027/before-link.sql`；目录权限 0700，文件权限 0600，不进入发布包。
- 后台入口：`http://device.local/wp-admin/plugins.php?page=npcink_device_inventory_settings`。浏览器已打开，停在 WordPress 登录页，需使用原管理员账号登录。没有更改账号、创建新用户或加入演示资产；尚未完成登录后的浏览器界面验收。

## 已清理内容

| 内容 | 当前行为及收益 |
| --- | --- |
| 历史 schema 迁移链及数据修正 | 直接建立当前四表定义，不重放旧删除/类型改写/指针回填；激活仍验证必要列和唯一索引 |
| PHP/Rust v1 身份算法、过渡查询和补写 | 只使用三种 v2 身份，减少旧匹配路径；保留当前冲突、弱主板证据与归档保护 |
| `residualValue` 及旧备份/导入形态 | 当前字段负责写入；恢复允许忽略 3.2.3 导出附带的冗余旧字段，v1 身份明确计数并跳过；旧算法不恢复 |
| transient 认证后备与孤立测试兼容 | nonce 与限流只走原子实现；移除上传时无效的 transient 查询 |
| 每次上传的历史列探测 | 由当前 schema 基线保证列存在；观测指针 UPDATE 失败仍回滚 |
| 旧部门设置回填 | 部门校验和设置展示只读取当前设置，不再扫描资产表推断部门 |
| 旧一次性导入器、空壳类和版本后备 | 删除不可达或不再需要的维护入口 |

保留当前 REST 命名空间、内部目录名称、v2 身份和硬件查询降级；不把当前平台支持当成历史兼容删除。清理没有自动删除存量业务记录。

## 验证记录

日志目录：`/tmp/npcink-legacy-cleanup-20261027/`。

- PHP 全部 fixtures、本机 PHPCS、PHPStan level 1 通过；PHP 7.4 与 8.5 完整错误报告下 fixtures 通过。
- 管理端 TypeScript/生产构建及 lint 通过。
- Rust collector 36 项、macOS 桌面 14 项测试通过；collector 与桌面 Clippy `--all-targets -- -D warnings`、format 通过。
- 完整 `npm run check:docker` 通过：官方 Plugin Check、真实 REST 权限、上传/归档/时间/缓存/事务失败、原子防重放与限流、备份 SQL 失败注入和恢复、多站点当前基线。测试容器、网络与卷已清理。
- 最终 ZIP 结构、WordPress.org 规则、管理端体积预算、版本契约、Action runtime 检查及本地 E2E shell 语法通过。
- device.local 上当前 schema 已验证，空台账得到保留。静态 JS/CSS 返回 200；匿名资产接口返回 403，WP-CLI 中以原有管理员上下文执行的资产与设置只读 REST 请求返回 200。登录后的视觉及交互效果需在原管理员登录后查看。

Windows 实机采集、安装、签名更新和远端 CI 依用户安排留待后续。此前记录的 Rust 上游 5 条提示仍未闭环，本轮未改动依赖；不将本地验证视为正式发布或跨平台实机验收。


## 3.2.3 备份导入回归修正

用户反馈 3.2.3 导出备份被拒绝，错误为 `invalid_backup_field` / HTTP 422。此前的清理错误地把“附带旧字段”视为“只依赖旧字段”，没有保留已发布导出格式的可恢复性；这属于本次改动引入的回归。

截图对应备份包含 205 条资产，全部同时带有 `secondHandMarketValue` 与等值的 `residualValue`；另有 148 条停用 v1 身份。修复后恢复只读取当前价格字段，忽略冗余旧字段，v1 身份明确计数并跳过，不恢复旧算法或旧身份写入。新增回归检查覆盖新旧字段值不同、财务值独立、只含旧字段拒绝，以及预览和实际导入均不写入 v1 身份。备份页面的 HTTP 错误由统一拦截器显示，删除重复的 Axios 通用错误弹窗；本地 JSON 格式错误仍单独显示。

原文件在 device.local 以管理员 REST 上下文执行 `dryRun: true`，返回 200、无冲突：计划新增资产 205、v2 身份 303、观测 197、事件 1417；跳过 v1 身份 148、原有规则不导入的事件 1。其中 4 个资产身份组仅有停用 v1 身份，恢复资产后仍需人工核对硬件身份；不根据编号自动绑定。该验证未实际导入用户数据，原文件未改动。真实导入及价格/身份落库由隔离数据库中的合成备份演练验证。

修正验证包括完整 PHP fixtures、PHPCS/PHPStan、PHP 7.4/8.5 备份 fixture、管理端 lint/生产构建、最终 ZIP 规则与体积门禁，以及隔离数据库实际恢复演练。

本次修正日志位于 `/tmp/npcink-backup-323-fix/`；修复前回归失败记录为 `/tmp/npcink-backup-323-before.log`。

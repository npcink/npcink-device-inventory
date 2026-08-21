# 发布收尾与开发经验归纳（2026-08-21）

## 目的

本文记录 `3.2.2` 插件与 `0.4.2` Device Agent 的最终收尾过程，并把本轮“部门设置、轻量采集、快速上传、跨平台打包、GitHub 与 WordPress.org 发布”的经验固化为可复用规范。

## 本次交付结果

- WordPress 插件：`3.2.2`
- 桌面端：`0.4.2`
- GitHub commit：`411ba20`
- GitHub tag/release：`v3.2.2`
- WordPress.org SVN revision：`3658544`
- WordPress.org tag：`tags/3.2.2`
- WordPress.org API 已返回 `3.2.2` 及对应下载地址。

发布资产包括 macOS ARM64 DMG、Windows x64 安装包、更新清单、签名文件、SHA256 校验文件和插件 ZIP。正式发布前已完成 Plugin Check、Docker WordPress、上传安全边界、备份恢复、多站点迁移和制品哈希校验。

## 关键产品与工程决策

### 1. 日常上传采用轻量采集

上传场景只采集身份匹配和资产展示所需的稳定字段，优先复用内存中的最近快照，并使用短期快照缓存，避免每次打开软件都进行全量硬件扫描。完整扫描保留给排障、硬件审计和主动刷新功能。

优化原则是：先测量每个采集阶段，再缩小默认工作集；不要为了“数据更全”把排障成本强加给每次上传。

### 2. 添加部门与保存设置分为两个动作

“添加部门”是独立、直观的本地编辑动作；页面底部“保存设置”才将整个设置表单写入 WordPress。这样用户可以连续编辑、删除和排序，最后一次性提交，避免半成品配置写入服务端。界面必须明确展示“已添加但尚未保存”的状态。

### 3. 服务端是最终事实来源

客户端只提交硬件事实，不提交可直接信任的身份结论；WordPress 重新计算身份、处理冲突并在事务内写入观测与事件。冲突、权限不足、归档资产命中和签名失败都必须失败关闭，不能静默选择或合并。

### 4. 只读分析与生产诊断保持轻量

分析页面只读，写入动作回到资产、事件和设置的明确入口。生产诊断保留稳定错误码、脱敏 JSON 和可复现快照，不常驻全量命令输出；全量扫描和详细日志只在排障路径启用。

## 标准开发流程

1. **事实盘点**：检查分支、版本、工作区和已有契约；用真实样本或 fixture 复现问题。
2. **边界定义**：写清输入、信任边界、权限、失败行为、迁移和“不做什么”；涉及长期架构取舍时先补 ADR。
3. **契约优先**：先更新 REST/schema、fixture、版本契约和验收条件，再实现后端、桌面端和 UI。
4. **分阶段实现**：先完成服务端规则，再接 UI；采集器先完成跨平台归一化，再接上传；发布配置单独验证。
5. **分层验证**：运行受影响测试、Plugin Check、构建、Docker/隔离环境、签名和哈希检查；不能用单一绿灯替代完整发布验证。
6. **发布收尾**：合并 master 后打 annotated tag；上传后重新下载并核对制品；WordPress.org SVN 提交 trunk 与版本 tag；等待目录索引刷新后再验证 API。
7. **文档闭环**：记录版本、commit、tag、SVN revision、已验证项、未验证项和环境限制，并更新文档索引。

## 发布规范

### GitHub

```bash
git status --short --branch
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin master --follow-tags
```

发布前必须确认 workflow 能实际启动，固定 action SHA 可追溯，macOS/Windows 资产、更新清单、签名和 SHA256SUMS 彼此一致。

### WordPress.org SVN

只提交文件，不提交 ZIP：

```bash
svn update "$SVN_WC" --accept postpone
svn resolve --accept working --depth infinity "$SVN_WC/trunk"
svn status "$SVN_WC"
svn commit "$SVN_WC" -m "Release Npcink Device Inventory X.Y.Z" --non-interactive
```

提交前检查主插件 header、`README.txt` 的 `Stable tag` 和 `Tested up to`，并确认没有冲突标记。若提交超时导致工作副本加锁，先运行 `svn cleanup` 再重试；若 pre-commit 报 PHP 解析错误，优先搜索 `<<<<<<<`、`=======`、`>>>>>>>` 等残留标记。

提交后验证 `trunk`、版本 tag 和 WordPress.org API。目录 API 可能延迟刷新；在刷新前应报告“SVN 已提交、目录索引待更新”，不能误报未发布或已完全可见。

## 常见失败模式与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| GitHub 连接超时 | VPN/代理未传递到终端 | 先用 `git ls-remote` 验证路径，再重试发布；保留 CI 作为旁路 |
| SVN out-of-date | 远端在操作期间有新提交 | `svn update`，本地目标版本优先保留 working，再 resolve |
| SVN 工作副本 locked | 上一次提交被超时中断 | `svn cleanup` 后重试，避免并发提交 |
| WordPress.org pre-commit PHP 解析错误 | 冲突标记残留 | 全局搜索冲突标记，修复后重新提交 |
| 启动采集慢 | 默认路径执行全量扫描 | 将全量扫描移到排障/主动刷新，上传复用轻量快照 |

## 后续维护要求

- 每次发布都新增一份 release verification 记录，不覆盖旧记录。
- 版本号、README stable tag、桌面 manifest、GitHub tag 和 WordPress.org tag 必须一致。
- 新增采集字段前先分类为“身份强信号、展示字段、排障字段或观测字段”，默认不扩大日常上传工作集。
- 任何改变数据边界、身份算法、发布渠道或更新协议的变更，都要新增或更新 ADR。
- 文档中的历史记录解释来路，当前契约和最新 ADR 才是实施依据。

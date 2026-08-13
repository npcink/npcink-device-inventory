# 开发与发布治理总结（2026-08-13）

## 文档目的

本文把本项目从 v3 重建、身份治理、后台能力恢复、桌面采集器、发布加固到
v3.1.4 正式发布的经验收敛成一套可重复执行的规范。它补充具体功能文档，
重点回答三个问题：

1. 先确认什么事实，再决定改什么；
2. 如何把 WordPress、React、Rust/Tauri 和 GitHub Release 作为一条链验证；
3. 如何避免“本地看起来通过、正式发布才失败”。

## 一、项目演进主线

### 1. 从功能堆叠回到稳定边界

项目早期同时承载资产管理、公开查询、分析、导入导出、客户端上传和多个
历史身份模型，导致权限、数据语义和发布范围互相牵连。v3 阶段的核心做法是
先收窄边界，再恢复必要能力：

- 资产编号是业务标识；硬件身份是匹配证据；采集快照是事实记录；事件是审计历史。
- 归档资产保留可审计性，但从运营列表、统计、上传匹配和导出中排除。
- 分析优先保持只读，写入动作回到资产、事件和设置的明确入口。
- 桌面客户端只提交硬件事实，服务端重新计算身份，不信任客户端直接给出的合并结论。

对应的长期契约见 `docs/asset-data-model.md`、`docs/identity-contract.md` 和
`docs/decisions/` 下的 ADR。

### 2. 身份匹配从“方便合并”转向“证据不足即拒绝”

当前硬件身份 v2 使用彼此独立的强信号：系统 UUID、受保护的主板序列号、永久
PCI MAC。CPU ProcessorId、当前 MAC、USB 网卡、磁盘、内存和显卡等可替换或
不稳定字段不再用于自动合并。

当多条强证据指向不同资产时，服务端返回冲突（409），不自动选择一条记录。
旧 v1 身份只用于升级时定位已有资产，并且必须有最新硬件证据交集才能迁移。
这条原则同时提高了数据质量和故障可解释性：宁可要求人工确认，也不制造静默
重复或错误合并。

### 3. 管理端能力按业务闭环恢复

资产类型、归档、折旧、市场价值、导出、硬件库存和只读分析不是孤立页面，均按
“数据语义 → REST 契约 → 权限 → UI → 回归夹具 → 发布验证”顺序落地。历史中多次
出现的典型问题是页面先做出来、边界后补，最终导致统计口径、过滤条件和导出字段
不一致。现在要求先写契约和验收条件，再实现界面。

### 4. 桌面采集器采用跨端事实契约

Rust collector 负责平台差异化采集和归一化，Tauri shell 负责权限、更新、日志
脱敏和系统交互，WordPress REST 负责认证、身份匹配、快照和事件落库。三层之间
通过固定 JSON fixture 和跨端 UUID/身份测试约束，不以某一台开发机的输出作为唯一
事实来源。

## 二、已经验证过的失败模式与修复思路

### 1. 发布工作流固定 SHA 的单字符错误

v3.1.4 首次发布中，`wordpress/plugin-check-action` 的 SHA 少了一个 `0`，质量
工作流没有调用该 action，因此 PR 检查全绿，正式 tag 发布才在 Set up job 阶段失败。

修复方式：

- 通过官方仓库 `git ls-remote` 获取真实 revision；
- release 和 preview 两处同时修正；
- 删除没有生成 Release 的旧 tag，基于修复后的 master 重建 annotated tag；
- 重新运行完整发布，确认 WordPress、macOS、Windows 和 Release 汇总均成功。

经验：发布专用路径必须有独立的“可启动性”检查，不能只依赖普通 PR 质量工作流。
固定 SHA 要求来源可追溯，更新后必须在真实 workflow 中执行一次。

### 2. 本地 Rust 工具链和 GitHub 大文件下载受网络环境影响

Rust 1.96.0 工具链安装、GitHub Release 大文件下载和 crates/action 拉取都可能
受本机代理/VPN 是否继承到终端影响。现象包括超时、下载中断和误以为资产损坏。

处理原则：

- 先区分“工具链/代码错误”和“网络路径错误”；
- 检查系统代理，再显式设置 `HTTP_PROXY`、`HTTPS_PROXY`；
- 保留 Docker/CI 作为可重复的旁路验证环境；
- 下载大文件使用重试、断点续传或 GitHub Actions artifact，不把一次直连失败
  当成发布失败。

### 3. 旧仓库地址残留导致更新链路存在隐性风险

发布已迁移到 `npcink/npcink-device-inventory` 后，桌面 updater endpoint、项目
链接和 URL 白名单仍有旧 `muze-page` 字样。该问题不一定影响当前构建，却会让
自动更新、外链校验和用户看到的项目地址不一致。

经验：仓库迁移不能只改 CI；必须全局检索 owner/repository、下载 endpoint、URL
白名单、测试 fixture 和文档中的发布地址，并在测试中验证 canonical URL。

## 三、当前标准开发流程

### 阶段 A：事实盘点

1. 查看 `git status`、当前分支、版本文件和最近发布记录。
2. 读取相关 ADR、契约和历史验证记录，不从旧文档直接推断当前行为。
3. 用 `rg` 检索调用链、配置来源、workflow 引用和测试夹具。
4. 明确本次变更属于 plugin、desktop、release 或多条链路。

### 阶段 B：先定边界和验收

每个变更至少写清：

- 输入事实和信任边界；
- 数据/REST/CLI/UI 契约；
- 权限、冲突、空值、归档和回滚行为；
- 本地验证命令和 CI 验收条件；
- 是否改变 release scope。

### 阶段 C：实现与最小回归

- 后端先完成服务端校验和事务边界，再接 UI。
- 采集器先更新 fixture 和跨平台归一化，再改上传逻辑。
- 发布脚本优先使用标准库和现有工具，不为一次性校验引入重依赖。
- 变更保持单一目的；功能、重构和发布治理尽量拆开。

### 阶段 D：验证分层

本地最小门：

```bash
npm run check:versions
npm run check:fixtures
npm run check:action-runtimes
npm run check:release-scope
npm run check:desktop-quality
```

发布相关门：

```bash
npm run check:desktop-manifests -- artifacts
npm run check:release-assets -- artifacts
npm run build:release-checksums -- artifacts
TAG_NAME=v3.1.4 npm run check:published-release -- published-assets
```

其中 `check:release-assets` 会验证：

- `latest.json` 和 `latest-desktop.json` 的版本、URL 和平台条目；
- updater `.sig` 与 manifest 中的签名完全一致；
- 使用 `ele-rs/src-tauri/tauri.conf.json` 中的公钥验证 macOS/Windows 签名；
- WordPress ZIP 可以完整解压。

正式 release workflow 还会在上传后重新下载资产，按 `SHA256SUMS` 逐文件比较，
把“GitHub 接受上传”与“用户能够下载到正确文件”分开验证。

### 阶段 E：发布与收尾

1. PR 质量检查通过后合并 master。
2. tag 必须指向已合并且可复现的 master 提交；annotated tag 记录发布意图。
3. Release scope 先决定 plugin-only 或 desktop release。
4. 发布完成后检查 Release 资产、manifest、签名、哈希和 Plugin Check 结果。
5. 最后才做真实安装/升级 smoke；未执行的人工步骤必须明确记录，不能写成已完成。

## 四、发布资产和版本治理规范

- WordPress 插件版本、`Stable tag`、desktop package、Tauri config 和 release tag
  必须通过版本契约检查。
- `latest.json` 是 Tauri updater 的机器契约；`latest-desktop.json` 是管理端和
  人工下载入口的展示契约，两者都必须包含 macOS 与 Windows 条目。
- updater 签名验证和 Apple/Windows 平台安装签名是不同层次，前者不能替代后者。
- 所有 workflow action 固定到可追溯的 Node.js 24 revision；`check:action-runtimes`
  防止旧 Node.js 20 revision 回流。
- 发布工作流变更、桌面更新脚本、签名验证脚本都属于 desktop release scope。
- 旧 tag 或 Release 只有在核对“是否存在可保留资产”后才能重写；重写前必须记录
  原 commit、目标 commit 和 Release 状态。
- 旧历史 tag 若与当前发布无关，不擅自覆盖或删除。

## 五、当前项目状态与未完成事项

截至 2026-08-13：

- master 已包含 PR #2、PR #3、PR #4 的安全、发布和完整性治理。
- `v3.1.4` 正式 Release 已成功，WordPress ZIP、macOS/Windows 制品、签名和
  update manifests 均已验证。
- 合并后的 master Quality CI 已全绿。
- 尚未完成的最后一步是人工真实安装验证：WordPress 安装/激活、macOS DMG
  安装启动、Windows NSIS 安装启动，以及客户端内自动更新检查和安装。

真实安装验证完成后，应新增一份 `docs/release-verification-<date>-v3.1.4.md`
补充设备、系统版本、安装结果、更新前后版本和截图/日志摘要；不要把本地下载或
签名验证替代 GUI 安装验证。

## 六、给未来开发者和智能代理的工作约束

1. 先读当前契约和 ADR，再读历史；历史只解释来路，不自动代表现状。
2. 先找主矛盾和失败证据，再改代码；不要用大范围重构掩盖根因。
3. 不把客户端声明、旧身份或前端计算结果当作最终事实。
4. 不把 CI 绿灯当作 release 绿灯；发布路径必须单独启动和验证。
5. 不伪报安装、签名、发布或外部环境结果；明确区分“已验证”“未验证”和“被环境阻断”。
6. 每次修复都补一个可自动重复的门禁、fixture 或文档规则，避免同类问题只靠记忆。
7. 变更完成后做一次五轴 review：正确性、可读性、架构、安全和性能。


# Npcink Device Agent

Rust/Tauri 设备采集与上传客户端，负责采集本机硬件事实并提交到 WordPress 插件 v3 资产模型。

客户端上传到：

```text
POST /wp-json/npcink-device-inventory/v1/device-observations
```

上传 body 使用 v3 observation 合同，HTTP 请求外层为 `observation`：

```json
{
  "observation": {
    "_npcink_device": { "schema_version": 5, "observation_id": "cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e", "collector": { "name": "npcink-device-agent", "collected_at": "2026-10-27T00:00:00Z" } },
    "asset": {
      "upload": {},
      "summary": {},
      "hardware": {}
    },
    "raw": { "source": "npcink-device-agent-v5" }
  }
}
```

来源核查与原始问题见[采集系统审计](../docs/collector-and-ingest-audit-2026-10-27.md)，当前实施与验收以[整改记录](../docs/collector-remediation-2026-10-27.md)为准。

客户端只上传硬件事实。服务端从快照重新计算 `system_uuid_v2`、`baseboard_serial_v2` 和符合条件的 `pci_permanent_mac_v2`；不会信任客户端声明的身份哈希。CPU `ProcessorId`、USB/当前 MAC、硬盘、内存和显卡不参与自动匹配。

## 当前工作区：完整硬件采集

- 普通上传、本地检查、硬件 JSON 导出共用完整采集，不再维护功能较少的上传路径。
- 快照标记为 `npcink-hardware-inventory-v3`，旧轻量缓存需重新采集。上传 schema 保持 5。
- 保留规范化硬件事实、平台原始字段、查询状态；上传不再通过固定类别白名单丢弃新增字段。
- Windows 增补内存阵列、整机、OS、机箱、外设、存储健康及 Secure Boot/TPM 状态；macOS 分组查询硬件、存储和外设，支持 DIMM 与统一内存区分。
- 物理盘与文件系统卷独立上传。CPU 当前频率使用 MHz，内存电压新字段显式以 mV 命名。
- Windows 以 CIM 关联保留物理盘→分区→卷关系，健康记录按唯一 StorageUniqueId 对应 Get-PhysicalDisk 设备；关联缺失或冲突会明确标记，不按容量、型号或数组顺序补配。详见[部件关系与采集质量合同](../docs/component-relations-2026-10-27.md)。
- Windows 显存使用 DXGI 64 位专用显存并按唯一 PCI 标识匹配；32 位 AdapterRAM 只保留为待核实原值，共享系统内存独立标注。缺少新显存查询的 Windows 缓存需重采；DXGI 本身仍待实机验证。
- Windows 核心查询分两组并发（最多两个 PowerShell），核心阶段最多22秒；网卡降级共享8秒。可选总预算12秒，先以最多8秒执行设备/安全两组，再将剩余时间交给存储关系与健康查询；增加一次进程启动，最大并发仍为2，受剩余60秒外部查询预算限制。macOS 单命令最多12秒，外部查询共享60秒。逐条保留完整结果，失败、超时或截断后仍可用的记录标为partial。
- 每次采集生成 UUIDv4 `observation_id`；同快照重试使用新签名 nonce 和相同采集编号，服务端返回原始 receipt，不重复创建观测或事件。不同内容复用编号返回 409。仅接受包装请求与 schema 5。
- 上传仅 HTTPS 且禁止自动跳转；请求预检与接口规模限制一致，响应最多 64 KiB；原始硬件 JSON 字符不再被文本清洗。
- 成功快照缓存 600 秒，失败/部分成功快照缓存 60 秒。规范化内存速度明确单位：Windows 为 MT/s，macOS 保留系统原始单位。
- 规范结构、来源局限与验收见 [完整采集与展示说明](../docs/complete-hardware-inventory-2026-10-27.md)。Windows 实机、安装和签名更新按安排后续执行。

## 前序 Windows 身份采集修复

- 修复 0.4.2 普通上传的轻量采集跳过主板/处理器身份/永久网卡查询，导致有永久 PCI MAC 的电脑仍在上传前失败。
- 共用必要身份采集，增加不带 `-Physical` 的查询和直接 CIM 降级；返回非空但没有有效永久地址时继续查询。
- 硬件反馈及本地日志加入身份诊断；失败提示说明缺失项；失效旧版轻量缓存。
- 设备 135 回归覆盖轻量采集到上传转换，并与 PHP 服务端指纹校验对齐。尚需 Windows 实机验收后发布。

## 0.3.3 历史改进

- 修复中文 Windows PowerShell 5.1 在输出包含“以太网”等非 ASCII 名称时可能使用本地代码页、导致客户端无法按 UTF-8 解析物理网卡 JSON 的问题。
- 查询隐藏物理网卡失败或无结果时，自动重试可见物理网卡。这样类似 133 的设备可使用受主板与 CPU 描述约束的 PCI 永久 MAC 完成身份匹配。
- 补齐 Windows 显示器 EDID、机箱、物理硬盘、默认路由、DNS、DHCP、CPU 静态规格和电池信息采集。
- 补齐 macOS NVMe/SATA 物理硬盘、真实默认路由、DNS、DHCP、Apple 性能核/效率核和电池健康信息采集。
- 将电池信息加入 v3 observation，并保持显示器、硬盘、内存等可更换硬件不参与唯一设备身份。

请求必须携带后台生成的完整授权码对应的 HMAC 头。完整授权码形如：

```text
mda_<token-id>_<token-secret>
```

当前只接受请求签名v2，绑定方法、规范化REST路由、Token ID及原始请求体。旧客户端需与插件配套更新，授权码无需更换。精确原文与权限范围见[异常恢复与上传授权合同](../docs/collection-resilience-and-auth-2026-10-27.md)；后续目标平台验收见[Windows实机清单](../docs/windows-collection-acceptance-2026-10-27.md)。

## 命令

桌面客户端：

```bash
npm install
npm run build
npm run tauri:dev
npm run tauri:build
```

运行时导入：

1. 在 WordPress 后台创建新的客户端授权码。
2. 在只显示一次的创建结果中复制“桌面客户端导入配置”。
3. 打开桌面客户端，点击“导入配置”。
4. 粘贴复制到的 JSON 并导入。

导入后会预填站点地址和完整授权码，用户仍可填写本次上传备注。关闭 WordPress 后台创建结果后，完整密钥不能再次读取；丢失时应撤销旧授权码并创建新授权码。

安装包是通用构建，不嵌入站点地址或授权码。导入的上传配置只存放在当前操作系统用户的应用配置目录；Unix 系统会把目录权限收紧为 `0700`、文件权限收紧为 `0600`。需要分发客户端时，先分发通用安装包，再为每个客户端创建独立授权码并在目标设备运行时导入。

打包产物位置：

```text
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/dmg/*.dmg
```

命令行采集器：

```bash
cargo run -- inspect --pretty
cargo run -- runtime --pretty
cargo run -- device-id
cargo run -- submit --site "https://example.com" --token "后台生成的完整授权码" --note "张三"
```

`--site` 可以填写站点首页、`/wp-json`、`/wp-json/npcink-device-inventory/v1` 或完整 `/device-observations` endpoint；客户端会自动归一化到设备上传接口。

Windows 开发冒烟测试：

```bat
scripts\windows-smoke-test.bat -SkipSubmit
scripts\windows-smoke-test.bat -Site "https://example.com/wp-json/npcink-device-inventory/v1/device-observations" -Token "后台生成的完整授权码" -Note "Windows开发测试"
```

脚本会运行前端构建、Rust 测试、硬件采集、运行监控、device id 检查、可选上传，以及 Windows 诊断探针。BAT 保留当前调用者权限，不主动提权；普通用户先跑一轮，再另开管理员终端对照。脚本使用 Node 以原始字节保存 stdout/stderr，正常 stderr 不算执行失败；每个命令有超时和进程树清理。`-SkipSubmit` 必须显式传入，否则必须提供 HTTPS Site 与 Token。报告总状态 `completed` 仅指已请求的源码烟测结束，另列跳过、可选失败、手工步骤，安装、平台签名及自动更新始终待单独验收。报告输出到 `smoke-reports\windows-<时间>\windows-smoke-report.json`。采集烟测会检查 v2 身份、Windows/CPU/内存基础字段、完整上传结构和运行监控。CI 使用 `-SkipBuild -SkipCargoTest -SkipSubmit -SkipDiagnostics`，仅保存步骤摘要；不提交采集数据，不上传原始硬件和事件日志。托管 Windows runner 的结果不能替代真实设备安装和签名更新验收。

排障包会检测 WinDbg/cdb 是否已安装。已安装时会尝试分析 `C:\Windows\Minidump\*.dmp`；未安装时会生成 `DumpAnalysis\debugger-not-found.txt` 和 WinDbg 安装提示，不会自动安装系统组件。

## 桌面客户端结构

```text
ele-rs/
  src/                  # 共享 Rust 采集库 + CLI
  src-tauri/            # Tauri 桌面外壳
  src/main.ts           # 桌面 UI
  src/style.css         # 桌面 UI 样式
```

桌面 UI 当前提供：

- 运行时导入或手动填写站点地址、完整授权码和上传备注
- 本机硬件采集预览
- 当前设备身份类型和值展示
- 一键导出本次采集的硬件反馈 JSON；文件不包含站点地址、上传配置或授权码
- 提交到 `/device-observations`

## 本地环境

打包和运行 Tauri 需要先安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

安装后重新打开终端，再执行：

```bash
cd ele-rs
npm run tauri:dev
```

## 待验证样本

- Windows 台式机
- Windows 笔记本
- macOS Intel
- macOS Apple Silicon
- 同时存在 Wi-Fi、有线网、虚拟网卡的机器

## 0.4.5 候选验收

- rc.2 将概览合并到设置页本机信息：十项字段、两列布局，窄窗口切换单列；显卡和显示器支持多条换行。保留设置、运行、排障、技术详情四个 TAB。

- 普通采集、上传和硬件导出均使用完整硬件采集入口；导出重新采集且不改写上传缓存。
- 技术详情同时显示显卡和显示器，无有效电池字段时隐藏电池入口。
- 排障页提供身份自检、Windows 设备管理器/事件查看器/DirectX 诊断/可靠性监视器及 WinDbg 官方安装说明。工具参数在 Rust 中固定，不接收任意命令。
- 深度排障包增加身份检查摘要、硬件查询状态和工具说明。身份摘要使用脱敏前已计算的状态，不重新从脱敏标识推导身份。
- 本地外观与合成测试已完成，Windows实机尚待执行；正式制品先构建草稿候选，验收后人工发布同一批字节。详见[发布流程](../docs/github-release.md)。

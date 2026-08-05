# Npcink Device Agent

Rust/Tauri 设备采集与上传客户端，负责采集本机硬件事实并提交到 WordPress 插件 v3 资产模型。

客户端上传到：

```text
POST /wp-json/npcink-device-inventory/v1/device-observations
```

上传 body 使用 v3 observation 合同：

```json
{
  "observation": {
    "_npcink_device": {
      "schema_version": 5,
      "collector": {}
    },
    "asset": {
      "identity": {},
      "upload": {},
      "summary": {},
      "hardware": {}
    },
    "raw": {}
  }
}
```

客户端只上传硬件事实。服务端从快照重新计算 `system_uuid_v2`、`baseboard_serial_v2` 和符合条件的 `pci_permanent_mac_v2`；不会信任客户端声明的身份哈希。CPU `ProcessorId`、USB/当前 MAC、硬盘、内存和显卡不参与自动匹配。

## 待发布 0.3.3

- 修复中文 Windows PowerShell 5.1 在输出包含“以太网”等非 ASCII 名称时可能使用本地代码页、导致客户端无法按 UTF-8 解析物理网卡 JSON 的问题。
- 查询隐藏物理网卡失败或无结果时，自动重试可见物理网卡。这样类似 133 的设备可使用受主板与 CPU 描述约束的 PCI 永久 MAC 完成身份匹配。
- 补齐 Windows 显示器 EDID、机箱、物理硬盘、默认路由、DNS、DHCP、CPU 静态规格和电池信息采集。
- 补齐 macOS NVMe/SATA 物理硬盘、真实默认路由、DNS、DHCP、Apple 性能核/效率核和电池健康信息采集。
- 将电池信息加入 v3 observation，并保持显示器、硬盘、内存等可更换硬件不参与唯一设备身份。

请求必须携带后台生成的完整授权码对应的 HMAC 头。完整授权码形如：

```text
mda_<token-id>_<token-secret>
```

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

脚本会运行前端构建、Rust 测试、硬件采集、运行监控、device id 检查、可选上传，以及 Windows 诊断探针。BAT 会请求管理员权限，以便读取更完整的事件日志和 dump 信息。报告输出到 `smoke-reports\windows-<时间>\windows-smoke-report.json`。

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

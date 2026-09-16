# 设备 135：轻量上传跳过身份采集

## 已确认事实

设备 135（KOLOE H610M4-PLUS）运行客户端 0.4.2，在上传前报 `missing device identity; check system UUID, motherboard serial, or permanent PCI MAC data`。
2026-09-16 本机只读查询证实 UUID 是已知占位值、主板序列号为 `Default string`；但 `Get-NetAdapter -IncludeHidden` 和直接 `MSFT_NetAdapter` 查询都返回有效的 Realtek PCI 永久地址，且 `HardwareInterface=True`、`Virtual=False`。

服务端旧观测不能代表本次失败采集。该错误由 Rust `build_observation_v3` 的本地前置检查产生，尚未发出 HTTP 上传。此前“已上传后服务端丢弃”的判断不成立。

## 根因与边界

桌面 `collect_device_snapshot_inner` 使用 `collect_upload_data`。0.4.2 的这条路径只采集基础 sysinfo 和 UUID，完全没有执行 `platform::enrich` 中的主板、处理器身份和永久网卡查询。因此占位 UUID 设备无法产生任何 v2 身份；有效 UUID 设备也会丢失其他身份证据，以及旧 v1 匹配所需的主板事实。

历史完整采集已经包含 UTF-8 修复和永久地址转换。没有证据表明 135 的永久地址在 JSON 序列化中丢失。另一个已发现但不能认定为 135 主因的问题是：网卡查询收到非空但不可用的列表后会过早结束，且缺少用户验证成功的两种查询路径。

## 修复

普通上传和完整诊断共用必要的 Windows 身份查询；不恢复全部昂贵硬件清单。网卡查询支持四级降级，以有效永久 PCI 地址而非非空数组作为成功条件。保留查询状态和字段有效性诊断，上传失败提示“尚未上传”，避免继续误查服务端。旧轻量缓存失效。

保留现有服务端身份规则及冲突保护。MachineGuid、Agent ID 和当前 MAC 不用于自动绑定；全部可信路径失败时导出本地反馈进行人工核对。

## 回归与验收

`ele-rs/tests/fixtures/identity-135.json` 保存本次主板/网卡证据。CPU 名称使用代表性 CIM 测试值，未声称来自本次用户诊断文本。Rust 测试从轻量入口注入 Windows 查询结果，验证四条查询路径、中文/单对象/数组结果、全失败诊断与上传 JSON；PHP 使用同一 fixture 和期望摘要验证一致性。已有测试继续拒绝 USB、虚拟网卡、仅当前 MAC 和占位字段。桌面测试验证缓存失效。

本地模拟测试不代替 Windows 实机验证。发布前在 Windows 原生构建后，对 135 重新采集，确认 `identityDiagnostics` 的永久 PCI MAC 数量大于零、身份类型为 `pci_permanent_mac_v2`，并保留本次硬件反馈。服务端旧资产没有身份时，仍可能新建资产；须比较硬件事实后单独处理关联，不能承诺按编号自动找回历史记录。

## 本次本地验证结果

- 采集器 31 项测试、桌面端 11 项测试通过。
- 桌面前端构建、两套 Rust 格式检查和 Clippy 通过。
- PHP 身份契约、身份声明冲突和观测接收测试通过；Windows 诊断探针自测通过。
- 普通质量工作流增加 Windows 原生运行矩阵；当前本地运行平台为 macOS，尚未执行该 Windows CI。
- `check:desktop-quality` 在代码检查通过后，因 RustSec 漏洞库网络获取失败而停止；不能将完整门禁标为通过。依赖锁文件未修改。
- 本次仅修改工作区代码，没有发布客户端或改写生产资产数据。

## 0.4.3-rc.1 候选补验

- 桌面版本统一标为 `0.4.3-rc.1`，插件版本保持 3.2.2。
- 恢复 RustSec 获取后发现 RUSTSEC-2026-0285；两个 lockfile 的 rustls 升至 0.23.45，rustls-webpki 升至 0.103.15。
- 候选版本的 `check:desktop-quality` 完整通过，包括安全审计（仍有上游维护状态、unsound 和 yanked 的允许级别警告）；npm audit 无漏洞。
- 候选版本的身份契约、占用冲突、观测接收 fixture 与版本检查通过。
- 使用 preview 工作流构建 Windows 测试包；正式发布和历史数据整理等待设备 135、177 及一台正常 UUID 设备的真实重复上传验收。

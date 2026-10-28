# 部件关系与采集质量合同

本阶段不改变资产身份算法或 HTTP observation schema 5。库存快照升级为 `npcink-hardware-inventory-v3`，使缺少关系探针的旧缓存重新采集。

## 存储

`hardware.storage.topology` 保留 Windows 系统报告的物理盘设备路径、分区设备标识及逻辑卷关联。`Win32_DiskDriveToDiskPartition` 与 `Win32_LogicalDiskToPartition` 为关联来源；盘符按 Windows 路径语义匹配文件系统卷，不按容量、型号、数组顺序推断归属。一个卷可关联多块盘，一个盘可有多个分区/卷；这不改变物理盘容量统计。

关系状态区分 matched、unmapped、ambiguous；原始关联即使无法解析端点，也留在 platformData。分区/关系探针在可选阶段采集，沿用12秒阶段预算与最多两个 PowerShell 的并发限制。后续异常恢复阶段将存储隔离到独立进程，正常增加一次启动，详见[当前调度合同](collection-resilience-and-auth-2026-10-27.md)。

存储健康记录携带 Get-PhysicalDisk 返回的 UniqueId；只在唯一匹配时标出对应存储设备，不把 Get-PhysicalDisk.DeviceId 擅自等同于 Win32_DiskDrive.Index。没有盘符的卷、Storage Spaces/RAID、APFS 等不靠名称或容量补造关系。

## 图形与显示

显存按双侧唯一的 PCI vendor/device/subsystem 签名关联；没有唯一关联时记录 ambiguous/unmapped。显示器仅按规范化实例标识相等匹配，不能按前缀匹配相似序列号。控制器模式作为屏幕回退需唯一控制器和唯一显示器；多卡单屏不能使用第一个控制器。逐屏刷新率与同型号多卡的原生 LUID/PCI bus 映射仍与 Windows 验收衔接。

## 质量与展示

重要部件的查询失败原因在相应详情可见，空硬件字段仍默认隐藏。系统未报告、没有记录、权限不足、不支持、超时、预算用尽、输出超限与关联不唯一分别解释。关系事实展示在既有“存储”“图形与显示”分类，不新增顶层导航。全部采集到的原始来源字段继续可查。

## 实现与边界

- `storage.topology` 包含 partitions、diskPartitions、partitionVolumes、volumeMappings；状态为 complete/partial/unavailable。complete 仅表示关联来源成功且返回的端点可解析，不承诺覆盖 Windows 所有存储技术。空结果不证明硬件不存在。
- 每个分区只能归属一个物理盘；重复标识、相互冲突的分区归属均标为 ambiguous，卷的物理盘列表不输出猜测归属。跨盘卷以多条真实分区关联保留。
- `storage.healthMappings[].healthRecordIndex` 为原始 health 数组的零基索引，界面显示“第 N 条健康记录”；即使中间有空项，索引也不会偏移。只匹配唯一的 StorageUniqueId，不以 DeviceId/Index 或相同型号代替。
- 显卡输出 dxgiMatchStatus/Reason/Source；只有双侧均唯一的 PCI vendor/device/subsystem 签名才分配64位显存和 LUID。尚未新增原生 PCI bus/LUID 实例桥。
- 显示器实例只允许完整相等，或 WMI 在完整 PNP 实例后追加 `_数字`；不会剥掉 PNP 自身标识的后缀。多卡单屏、重复系统显示器实例不套用首张卡的模式；系统屏幕尺寸与控制器模式冲突时，不借用刷新率。
- 详情保留八类导航，新关系放在存储内；重要硬件分类显示对应查询状态。macOS 优先显示准确子类型状态，进程级成功不能覆盖子类型失败；没有子类型时仍显示失败组的证据。无诊断的旧观测缺失原因未知，占位提示随“显示空字段”开关查看。
- 所有已采集来源字段仍可查，0/false 保留，空字段默认隐藏。诊断条数包含组级和子查询记录，明确不是设备数。
- 三条 Windows 新查询仍在12秒可选阶段内。后续异常恢复阶段先运行设备/安全两组，再以剩余时间运行存储关系/健康查询，避免存储阻塞前者；增加一次启动，最大并发仍为2，真实取舍待 Windows 实测。
- macOS 沿用系统报告的物理盘字段；未按 BSD 设备名前缀推导 APFS 容器/卷归属。

## 本地验证

- 采集器57项、桌面14项测试，fmt、Clippy、桌面前端构建与依赖审计完成。关系回归覆盖同容量乱序盘、一盘多卷、跨盘卷、缺失来源、重复设备ID、相互冲突的分区归属、稀疏健康数组，以及相似显示器实例、多卡单屏、重复显示器和同型号显卡。
- 上传回归确认新 storage 字段完整保留、物理盘总容量不重复计入卷。
- 后台真实详情转换 fixture 覆盖关系中文说明、0/false、空类隐藏、无记录/权限/超时/不支持区别及 macOS 子查询失败。lint、分页fixture、TypeScript/生产构建通过。
- PHP fixtures、PHPStan、PHPCS 通过。隔离 WordPress 7.1.3 / PHP 8.3 / MariaDB 回归通过：新增 storage 关系与 graphics 匹配诊断真实入库、备份导出、恢复后逐值保真；receipt 重试幂等、读失败回滚、权限边界、备份恢复演练、多站点与卸载/重装均通过。官方 Plugin Check 无错误，测试容器和数据卷已清理；未向 device.local 写测试资产或观测。
- 新增备份断言最初误用了备份中不存在的数据库 id；已改为 observationId（采集 UUID）筛选，并重新跑完隔离验证。产品备份结构未因此改动。
- device.local 最新构建只读冒烟通过：已有资产可打开，详情分类切换正常，空字段开关默认关闭，存储保留卷与物理盘的区分。已有观测没有新来源时不会补造关系；新关系展示由合成详情 fixture 和隔离数据库验证。
- bundle budget、版本一致性、最终插件 ZIP 结构及 WordPress.org 静态规则检查通过；未发布或推送。
- 本机 macOS debug 只读完整采集一次：2,343 ms，紧凑库存 JSON 20,863字节，23条诊断（17成功、6无记录、0失败）。该次与此前900ms样本并非同条件基线，不能宣称性能改善或退化比例；不是 Windows 性能数据。
- 库存 marker 更新为 v3，旧缓存需重新采集才会出现新关系。HTTP schema5和身份算法保持原契约。

## 依赖警告评估

| 警告 | 已核对的引入链 | 本阶段处理 |
| --- | --- | --- |
| proc-macro-error 1.0.4 未维护（RUSTSEC-2024-0370） | GTK3 宏 / glib-macros → GTK/WebKit → Wry/Tauri 的 Linux UI | 稳定上游依赖链约束，未强行跨主版本 patch |
| glib 0.18.5 VariantStrIter unsoundness（RUSTSEC-2024-0429） | GTK 0.18.2 / webkit2gtk 2.0.2 → Wry 0.57.1 / Tauri 2.12.5 | 仍需上游 UI 栈升级，未列为已解决 |
| zbus_names / zvariant / zvariant_derive 未维护（RUSTSEC-2026-0371/0370/0372） | zbus 5.17.0 → tauri-plugin-opener 2.5.4 的 Linux/BSD D-Bus 路径 | 已查 zbus 6.1.0 为主版本升级；opener 稳定2.5.4，3.0.0-alpha.3为预发布，不直接替换 |

这5条警告仍由现有 audit 默认策略报告；未新增 ignore 或依赖来消除提示。当前 Windows/macOS 发行目标不编译上述 Linux UI/D-Bus 路径，锁文件扫描仍会报告。Linux 若纳入正式发行需独立解决并验收；本阶段没有承诺 Linux 完整采集/发行。

Windows 实机、原生 DisplayConfig/同型号多卡精确实例映射、安装/签名更新及远端 CI 按用户决定留到后续；本地合成样本不能替代目标平台验收。

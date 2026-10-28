# Test Fixtures And Regression Checks

This folder contains lightweight regression checks that can run without a full WordPress browser session.

- `backup-restore-fixtures.php`: JSON backup/restore dry-run and import behavior fixtures.
- `asset-search-fixtures.php`: asset search cost and extended-search guard fixtures.
- `asset-write-fixtures.php`: atomic batch asset updates, validation, audit, and rollback fixtures.
- `device-upload-boundary-fixtures.php`: observation payload size/shape and signed upload rate-limit fixtures, including depth-16 hardware preservation and depth/node rejection.
- `schema-fixtures.php`: current schema installation, completeness checks, idempotence and failure handling.
- `identity-contract-fixtures.php`: PHP/Rust current hardware identity golden vectors and invalid-signal exclusions.
- `identity-claim-fixtures.php`: atomic identity claim, idempotency, conflict, and failure fixtures.
- `observation-ingest-fixtures.php`: transaction rollback, concurrent identity ownership, and audit failure fixtures.
- `fixtures/device-observation-demo.json`: synthetic, sanitized hardware observation sample for documentation and parser experiments.

Run the root package scripts for the supported checks:

```bash
npm run check:backup-restore
npm run check:asset-search
npm run check:asset-writes
npm run check:device-upload
npm run check:schema
npm run check:identity
```

### 生命周期、最新指针与分析分页回归

- `npm run check:lifecycle`：默认保留数据、显式卸载清理、重装建表、旧修订残留缺表修复。
- `npm run check:observation-repository`：最新指针更新失败不可报告观测创建成功，旧观测零行更新仍成功。
- `npm run check:analysis-pagination --prefix vite-admin`：固定上界、空页继续、游标前进校验和取消请求。
- `npm run check:docker`：临时 WordPress/PHP 8.3/MariaDB 环境中的实际 REST 权限、最近两次观测排序及游标、数据库故障回滚、独立连接归档竞态、生命周期、备份恢复、多站点升级；结束自动删除测试容器和卷。测试脚本校验站点身份，禁止在正式站点执行 `tests/wordpress-integration.php`。
- PHP 7.4、8.5 fixture 运行已加入 CI；PHPStan 提高到 level 1。独立 fixture 不能替代真实数据库测试。

### 依赖及跨平台检查

- 管理端、桌面端 npm 全依赖审计（包括开发依赖）以 moderate 为阻断门限，纳入本地总检查、质量 CI 及构建/发布工作流。
- Windows CI 在单元测试后执行 `windows-smoke-test.ps1 -SkipBuild -SkipCargoTest -SkipSubmit -SkipDiagnostics`，校验 Windows/CPU/内存、v2 身份、完整采集和运行状态；artifact 仅保存步骤摘要。驱动差异、安装及签名自动更新仍需 Windows 实机验收。
- Rust 当前仍有 5 条兼容上游未解决提示，详见 `docs/project-remediation-2026-10-26.md`；不设置忽略规则。

### 事务缓存和主身份回归（2026-10-27）

- 观测仓库 fixture 使用真实内存缓存验证回滚后的 ID 查询不返回幽灵观测。
- 身份 fixture 覆盖主身份 UPDATE 失败与零行幂等更新；上传与管理员写入 fixture 校验提交／回滚后的缓存失效。
- WordPress 集成测试通过独立 MariaDB 连接共享缓存命名空间，在提交前缓存旧快照，提交后检查最新指针和观测／事件总数；另验证主身份更新失败不会新增观测／事件。

### 备份错误与配置重读回归（2026-10-27 续办）

- `check:backup-restore` 模拟 wpdb 查询失败返回空数组／null：四个导出分区必须拒绝假成功，五种恢复查询在预览及事务中失败时必须停止；正常空表仍允许导出。
- `check:docker` 在真实数据库注入导出、预览和导入查重错误，检查错误码，以及后续查询失败时此前资产更新是否已回滚。
- `cargo test --locked --manifest-path ele-rs/src-tauri/Cargo.toml` 包含配置缺失／JSON 损坏测试；Linux 额外覆盖文件授权码连续重读和私有文件权限。所有配置测试仅使用自动清理的临时路径，不接触用户配置或系统凭据。

### 完整硬件采集与详情回归（2026-10-27）

- `npm run check:hardware-audit --prefix vite-admin`：条数/容量组合/真实槽数、未知模块、统一内存、物理盘与卷、全部采集字段、查询失败、0/false、电压 V/mV。
- Rust 采集库覆盖普通上传与完整检查共用路径、所有硬件类别/未知类别保留、macOS DIMM/统一内存、Windows SMBIOS 类型与电压单位、旧快照拒绝。
- `check:docker` 的真实 MariaDB 回归确认深层 platformData、volumes、collection 以及 false/0 不被存储清理截断。此测试必须在隔离站点运行，不能在 device.local 注入测试资产。

### 显存来源回归

- Rust 模拟 8 GiB DXGI 与 32 位 WMI 截断值，校验唯一 PCI 标识匹配、双显卡顺序、重复/软件/无匹配设备，以及来源字段完整上传；桌面缓存拒绝缺少新显存查询的 Windows 旧快照。
- 前端回归校验 Windows 旧显存按精确字节显示为待核实、DXGI 8 GB 正常显示、共享系统内存独立标注，macOS 显存不受旧接口提示影响。
- Windows PowerShell/C# DXGI 执行仍需后续实机验收；本地跨平台单元测试不能替代此项。

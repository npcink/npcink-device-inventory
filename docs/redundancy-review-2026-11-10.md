# 后续冗余审查与实施结果

2026-11-10，用户授权“依次处理”，随后明确确认 `GET /observations` 没有外部调用，可以删除。7 项已全部落实。此前范围精简和提示样式改动完整保留；本轮没有数据库迁移或生产部署。

## 当前结果

| 项目 | 已落实 |
| --- | --- |
| 1. 通用编辑分支 | 移除不可达的已有资产 / 电脑编辑分支，弹窗仅新增自定义资产；详情编辑入口保留 |
| 2. 无效统计设置 | 删除默认值、写入、响应、备份和前端类型中的活动契约；旧备份键被忽略，其他设置正常恢复；不清整份已有 option |
| 3. 完整列表持久缓存 | 删除 localStorage 完整列表读写，启动仅清理 `npcinkDeviceInventoryAssetList:` 前缀；保留 React Query、后台首屏数据和保存筛选 / 布局偏好 |
| 4. 重复事实来源 | 展示、编辑统一使用主记录 `name` / `purchasePrice`，新增、编辑、导入停止镜像双写；历史 title / total 及独立采购字段继续保留 |
| 5. 全局快照查询 | 删除 `GET /observations`、处理方法、仓储全局查询及前端封装 / 类型；设备快照历史、分析、清理、上传与备份保留 |
| 6. 导出外观编辑器 | 删除拖动列顺序、逐状态调色、整行着色切换和默认配色保存及残留样式；保留格式、范围、字段、常用方案、分组选择与预览；Excel 固定只给状态格着色 |
| 7. 局部隐藏姓名 | 删除开关及局部替换，审计姓名、设备名称、旧值 / 新值正常显示 |

浏览器验收额外发现新增弹窗第二次打开会丢失默认值：`destroyOnHidden` 与 `preserve={false}` 下，命令式初始化早于字段重新挂载。已改为 Form `initialValues` 配合每次打开 reset，连续三轮关闭重开及随后提交验证通过，资产类型、数量、金额默认值正确，旧输入不残留。

## 验证结果

- 后台生产构建、ESLint、硬件 / 财务 / 保存 / 导入回归、分析分页、PHP 全套 fixture、PHPStan、PHPCS、版本契约、包体预算通过。
- 新增回归覆盖主记录优先、历史镜像及扩展字段保留、新建和导入不双写、旧缓存精确清理及存储不可用、旧备份键兼容、移除路由和保留路由。
- Playwright 使用真实前端和合成 REST 响应，核对新增、重复开关、编辑、缓存清理及偏好保留、导出配置 / 预览、真实下载、变更列表。Excel 下载后读回验证字段顺序、金额数字类型、未知 null / 已知 0 及固定状态格颜色；CSV 读回验证空值与零值区分。
- M4 隔离 WordPress / MariaDB 完整 Docker 门禁通过，包含官方 Plugin Check、身份上传、幂等、防重放、限流、事务、备份恢复与多站点。定向真实 REST 回归验证全局快照 404、设备历史仍返回全部 3 条快照、采集趋势 200，以及旧配置被忽略且其他设置与扩展保留。最终新增表单修正包再次验收结果见[实施记录](scope-simplification-2026-11-10.md)。

源码已按用户授权分批本地提交，验收证据保存在本地；未推送或发布。当前状态及发布前待办见[收尾记录](simplification-closeout-2026-11-10.md)。前述浏览器交互使用合成接口，真实服务器验收使用 WP-CLI / REST 集成回归，两种证据范围分别记录。

## 审查时的依据（以下为实施前状态）

## 优先处理

### 1. 没有入口的通用编辑分支

- `AssetWorkspace` 中 `editingAsset` 初值为 null；全部 `setEditingAsset` 调用也只传 null，唯一的弹窗打开入口是自定义资产“新增”。
- `submitAsset` 仍保留更新分支和对应 `updateMutation`；`AssetFormModal` 仍为编辑已有资产、编辑电脑、初始化原采购字段维护条件分支。这些能力在当前产品调用链中无法进入。
- 真正的编辑入口为详情中的 `AssetSettingsPanel` / `CustomAssetSettingsPanel`。
- 建议将通用弹窗收缩为自定义资产录入，删除工作区不可达的更新状态和更新 mutation，以及弹窗不可达的电脑 / 编辑分支。保留共享保存转换，供真实编辑入口和新增使用。
- 来源：[工作区](../vite-admin/src/pages/assets/AssetWorkspace.tsx)、[通用弹窗](../vite-admin/src/pages/assets/AssetFormModal.tsx)、[真实编辑面板](../vite-admin/src/pages/assets/AssetSettingsPanel.tsx)。

### 2. 没有业务消费者的统计设置

- `countAvailableAssetsOnly` / `count_available_assets_only` 仍出现在默认设置、设置写入与响应、备份导出 / 恢复和前端类型中。
- 仓库内没有统计计算或界面逻辑读取该开关。分析页明确按未归档范围统计，不由此设置控制。
- 建议删除无效设置的活动契约和类型；旧备份中该键可被忽略，保留其他设置及数据。无需删除整份已有 option 或迁移真实资产。
- 来源：[设置控制器](../includes/v3/rest/class-npcink-device-inventory-settings-controller.php)、[分析范围](../vite-admin/src/pages/analysis/AnalysisWorkspace.tsx)、[设置类型](../vite-admin/src/type/v3.ts)。

### 3. 完整资产列表的额外持久缓存

- 前端已有 React Query 内存缓存，后台也注入初始列表；`shared/cache.tsx` 又按查询参数将完整资产分页结果保存到 localStorage，缓存接受期为 10 分钟。
- 工作区把持久结果作为 `initialData`，没有传入对应的原始更新时间；这可能让旧结果在挂载时重新被当成新数据。默认查询 staleTime 为 30 秒、窗口聚焦不自动刷新。
- 缓存键没有站点路径和登录用户维度；同源的多个站点或用户切换可能复用相同键。资产修改时当前仅失效 React Query 查询，没有统一失效 localStorage 中其他筛选和分页的快照。
- 建议删除完整列表的 localStorage 持久缓存，保留 React Query 和服务端初始数据；实施时清理本项目的旧列表缓存键，不清空其他偏好。若以后需要离线能力，应另有明确的更新与隔离策略。
- 来源：[持久缓存](../vite-admin/src/pages/shared/cache.tsx)、[查询接入](../vite-admin/src/pages/assets/AssetWorkspace.tsx)、[查询默认配置](../vite-admin/src/main.tsx)、[后台首屏数据](../admin/partials/npcink-device-inventory-admin-menu.php)。

### 4. 名称和采购金额的重复事实来源

- `assetFormValuesToInput` 将名称同时写入主记录 `name` 和 `metadata.purchase.title`，采购价同时写入 `purchasePrice` 和 `metadata.purchase.total`。
- 前轮已将编辑初始化改为使用主记录；但 `customAssetInfo` 的卡片和详情读取仍优先使用采购元数据中的 title / total。两份内容不一致时，展示与编辑仍可能不同。
- 建议卡片、详情和编辑统一以主记录名称、采购价为准，收缩这些同义字段的双写和优先回退。采购单号、数量、日期、平台、店铺等独立信息继续保留。先停止将旧镜像字段当成权威来源，不批量删除历史 metadata。
- 来源：[保存转换](../vite-admin/src/pages/shared/assetForm.ts)、[自定义展示数据](../vite-admin/src/pages/shared/assets.tsx)、[自定义详情](../vite-admin/src/pages/assets/CustomAssetDetail.tsx)。

## 有条件精简

### 5. 全局采集快照查询接口

- `services/v3.ts` 的 `getObservations` 没有仓库内调用方，服务端仍维护 `GET /observations`、全局搜索分页和 repository `list_all`。测试引用不代表产品使用方。
- 当前详情使用 `GET /assets/{uuid}/observations`；分析变化使用专用 `/analysis/hardware-observations`；备份独立读取数据库。
- 建议可先删除未使用的前端封装与专用类型。服务端全局接口是否删除，要先核实外部脚本使用情况；此前用户允许删除的是身份 POST，不适用于此接口。
- 来源：[前端封装](../vite-admin/src/services/v3.ts)、[REST 控制器](../includes/v3/rest/class-npcink-device-inventory-assets-controller.php)、[快照仓储](../includes/v3/repositories/class-npcink-device-inventory-observation-repository.php)。

### 6. 导出中的外观编辑器

- 台账导出目前同时提供逐状态调色、整行 / 状态单元格两种着色、保存默认配色、拖动列顺序、分组全选及预览等配置。
- 这些功能确有实现，不能据源码断定无人使用；但其外观配置明显多于简单台账导出的必要操作。
- 建议优先保留 Excel / CSV、导出范围、字段选择与常用方案；没有指定交付模板要求时，颜色固定或提供一个简单开关，列顺序采用方案默认。预览本身有核对作用，不必与配色定制一起删除。
- 来源：[导出弹窗](../vite-admin/src/pages/assets/AssetExportModal.tsx)、[工作簿与配色实现](../vite-admin/src/pages/shared/tabular.tsx)。

### 7. 变更数据的“隐藏姓名”开关

- 当前仅替换姓名列和设备名称，`changeContentText` 仍显示 oldValue / newValue 或手工消息；姓名变更的旧新姓名、说明中的姓名不会随开关隐藏。
- 这是局部界面遮挡，不能提供完整脱敏；是否有截图演示用途，源码无法证明。
- 建议没有明确截图演示场景时删除该开关，保留真实审计记录。若确需保留，应准确界定展示用途和覆盖范围，不能把当前行为称为脱敏。
- 来源：[变更列表](../vite-admin/src/pages/events/ChangeWorkspace.tsx)、[变更内容](../vite-admin/src/pages/shared/events.tsx)。

## 保留建议与验证边界

暂未发现需要继续整体删除的桌面主模块。硬件采集、设备身份、自检、手动上传、完整硬件 JSON 和脱敏上传排障包用途不同；签名自动更新与手工下载回退也不能仅因都叫“更新”认定重复。自动变更与手工记录分别服务事实审计和人工补充，备份恢复与台账导出分别服务迁移恢复和日常整理，均建议保留。

保存筛选、卡片 / 表格切换和查询下钻有明确实现与不同用途，没有使用量证据时暂不列为必删项。已接受的只读分析、财务未知值与零值区分、更新候选规则继续遵循现有 ADR，不因本轮审查推翻。

审查初稿仅核实源码调用链；此后用户授权全部依次实施，并单独确认全局快照没有外部调用。当前实现及运行验收以本文开头和实施记录为准。

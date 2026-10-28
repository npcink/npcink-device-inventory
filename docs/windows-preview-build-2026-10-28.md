# Windows 0.4.5 测试包与隔离验收（2026-10-28）

## 授权及范围

用户授权使用当前M5的Docker，并将当前候选代码提交、推送到专用测试分支运行Windows preview。本轮不合并master、不创建tag或正式Release，不向device.local写入测试数据。

分支：`codex/windows-0.4.5-acceptance`。首次候选提交5676214，后续修复见下文。已提交此前经本地验证的完整采集、签名v2、展示和发布工具改动；Windows预览包只用于信任的内部验收，没有平台代码签名或自动更新签名，不能据此验收正式自动更新。

## Docker与本地门禁

当前M5的Docker Desktop引擎29.7.2已启动。隔离站点使用WordPress7.1.3、PHP8.3、MariaDB11.8.9及官方Plugin Check2.0.0。

首次检查发现README新增Upgrade Notice超过限制；缩短文案后仍失败。核查官方解析器后确认存在两个Upgrade Notice节，拼接时相邻版本标题丢失换行。最终合并到原有单节，所有升级说明含HTML包装均在300字节内，官方检查通过。

隔离Docker全套通过：

- ZIP安装和启用，官方Plugin Check无错误/警告。
- 真实签名v2、令牌权限、nonce重放及限流边界。
- receipt导出恢复与重复上传幂等；读失败回滚。
- REST权限、游标SQL、归档竞态、时钟校验。
- 卸载/重装、旧revision表修复、真实备份恢复及多站点升级。
- 测试Compose容器、网络和数据卷已删除，未操作其他项目容器。

系统代理位于127.0.0.1:12000；Git及Rust没有自动采用系统代理，造成此前直连失败。本轮仅给相关命令显式传代理，不更改全局Git配置。联网刷新RustSec后，两份lockfile审计及完整`npm run check:submission`通过；桌面仍5条已有上游unmaintained/unsound警告，没有新增ignore。

Docker实测与submission门禁使用相同的release/submission ZIP，SHA-256均为：

`80d99105e0a32b70ddb7d37d8cf3d06db1c010196ceb4f1b1a0442da33c69e7c`

该哈希替代此前本地预验收包的694d6468开头哈希。ZIP生成后没有再重建。

## Windows runner记录

首次workflow run：40622854984（源码20e64f1）。Node原生命令runner的UTF-8/stderr/参数边界、退出码/启动失败、超时和后代进程清理3项均通过；PS5.1包装层因JSON数组输出语义与PS7不同失败，未生成安装包。

提交2ef38ee将JSON数组直接赋值，消除PS5.1额外数组包装；本地PS7回归通过。第二次workflow run：40623073674，构建源码为2ef38ee78bfa1c963a82e49ce261538d1ddf4531。

第二次run中数组断言通过，但PS5.1的中文参数受调用者代码页影响而失败。提交3f1ae40将stdin控制JSON中的非ASCII字符转为Unicode转义，避免依赖调用者的native-pipeline编码；测试主动设置ASCII代码页以验证，macOS PS7回归通过。

第三次run：40623314368（源码3f1ae40）。Windows原生命令runner的3项测试、PowerShell5.1.26100.33648和PowerShell7.6.7包装层、采集器62项及桌面14项Rust测试、两组fmt/Clippy、桌面前端构建均通过。打包时Tauri拒绝Rust运行时2.12.5与JavaScript API2.11.1的次版本不匹配，仍未生成安装包。

提交503140adea457fdbc946d8dc194a3ede947f09f3将JavaScript API精确固定到2.12.4，与Rust运行时保持2.12，并在Windows构建开始处增加配套版本门禁。版本门禁补充Tauri解析版本检查及真实失败条件回归；发布工具共9项、桌面前端构建及npm audit均通过。

第四次run：[40624537030](https://github.com/npcink/npcink-device-inventory/actions/runs/40624537030)，构建源码为503140adea457fdbc946d8dc194a3ede947f09f3。提前的版本检查发现锁文件使用Windows CRLF换行时，原脚本的文本匹配误判Rust版本缺失。先增加CRLF真实文件回归复现同一错误，再统一读取为LF；原LF检查、CRLF检查和Tauri错版本拒绝回归全部通过（发布工具共9项）。修复提交ff62c0c。

第五次run：[40625002580](https://github.com/npcink/npcink-device-inventory/actions/runs/40625002580)，构建源码为ff62c0c80e67da6caa37bcded32dfa5dd62e258a，Windows job在12分15秒内全部成功：

- 配套产品版本与Tauri依赖版本门禁。
- Node命令runner 3项，Windows PowerShell5.1.26100.33648及PowerShell7.6.7包装层。
- 采集器fmt、Clippy及62项测试；桌面fmt、Clippy及14项测试。
- TypeScript/前端生产构建、Tauri发布模式编译、NSIS打包和制品上传。

## 已下载的Windows测试安装包

- 名称：`Npcink Device Agent_0.4.5_x64-setup.exe`。
- 本地目录：`release-preview/windows-0.4.5/`，同时包含`SHA256SUMS`、`build-info.json`和`验收步骤.md`，均不提交Git。
- 大小：3,796,590字节。
- 安装包SHA-256：`820203dd0ada88e823fd4d60eb4c36840b088756c39bbf8808f3fbbc184ac87a`。
- [GitHub artifact 12789342617](https://github.com/npcink/npcink-device-inventory/actions/runs/40625002580/artifacts/12789342617)，保留至2026-11-04 03:20:52 UTC（北京时间11:20:52），需GitHub登录下载；本地副本不受此保留期限制。
- GitHub ZIP大小3,778,607字节，SHA-256：`14e29e6b52beabde2047d27627344ae880274964f792ad3b04ca24c6baa879b9`。下载后与API和上传日志中的digest一致；核对制品源commit为ff62c0c80e67da6caa37bcded32dfa5dd62e258a，ZIP只含上述安装包后才解压。
- 文件识别为Windows PE/Nullsoft Installer；NSIS引导器本身为PE32，安装目标为x64。这不代表已在实机安装或验证采集结果。

本包无Authenticode或updater签名，不是正式Release。测试分支后续文档提交不改变此安装包的构建源码；实机验收应保留上述hash和run对应关系。

## 用户下一步

1. 复制exe到Windows，安装并确认0.4.5。已有0.4.4时，覆盖安装后检查配置保留情况。
2. 普通用户点击“重新采集”，记录耗时与错误，到“技术详情”核对每根内存、已知8GiB独显及存储关系；在“排障→导出硬件信息”保存普通用户JSON。
3. 退出后以管理员身份重复，提供两份JSON及已知的真实内存/显卡/物理硬盘配置。无需安装Rust或Node，原始报告通过私下渠道提供，不提交公开CI。

首轮不上传；下一轮才使用可信HTTPS验收站点和配套插件3.2.4联验。Windows真实硬件完整性、普通/管理员权限差异、覆盖安装配置保留、正式签名更新、正式Release仍待验收。

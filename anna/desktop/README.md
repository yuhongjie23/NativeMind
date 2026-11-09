# Anna → NativeMind 本机独立窗口

用户于 2026-11-09 确认采用此路线。此目录是新的发布候选入口；`anna/native`、`anna/bundle` 仍是旧的本机内嵌开发路径，不应把旧 `native_command` 工具发布给 Agent。

发布进度：2026-11-09 已上传工具 2.0.0（工具版本 1046）和 App 2.0.0（版本 2084），绑定现有 App 847。启动界面已上传并通过校验；App 为 `pending_review`，尚未正式上架。GitHub [v2.0.0](https://github.com/yuhongjie23/NativeMind/releases/tag/v2.0.0) 已公开。

## 当前实现

- `ui/` 是 Anna 内的小型启动页，点击按钮才发 `open_app`，参数永远 `{}`；不加载学习界面、学习数据或本地数据桥。启动请求与固定状态经过 Anna，学习内容不经过。
- `../launcher` 是 Windows x64 独立 Rust Executa，只提供一个无参数启动工具。真实 Tool ID 为 `tool-forforever23-hongjie-yu-3qny9w3z`，当前工具版本 `2.0.0`。拒绝旧数据库桥、路径、模型参数；不采纳调用者传来的账号或本地路径。
- 完整 App 来自原桌面源码，以 `anna-local` 功能构建，使用 `com.nativemind.anna-local` 身份及独立单实例端口。版本/身份配置不匹配会在打开数据库前停止。
- 数据目录默认 `%APPDATA%\com.nativemind.anna-local`，与原桌面版分开。旧数据只通过用户主动恢复备份/选择目录迁入；包内不带用户数据库、密钥、模型或音乐。
- 纯本地构建禁用 DeepSeek 路由和外部搜索，CSP 不允许远程请求；Ollama 限制本机地址、禁代理与重定向。设置页隐藏无法启用的云端选项。
- Anna 请求启动后，本机原生确认通过才初始化 App。启动器不继承平台凭据给 App，不回传目录、进程 ID、日志、笔记或模型信息。返回 `launch_requested` 只代表请求启动，不能证明用户已确认或 App 已就绪。
- 启动器校验本次构建嵌入的 App/vec0 SHA-256。此校验用于发现替换/损坏，不等同 Authenticode 发布者签名，也不防同 Windows 用户权限的恶意软件。

## 身份与隔离的边界

平台 Tool ID 的所有权、安装用户与调用路由依赖 Anna 官方安装体系。`ANNA_RUNTIME_PROFILE` 仅用于拒绝错误运行位置，不是身份证明；不把环境变量、manifest.name、客户端自报 appId 当认证。

本方案没有给 Anna 开放私有数据通道，因此不需要将 Anna JWT 转交本机验证。学习数据库按 Windows 用户/本地应用目录隔离，不声称“同一 Windows 用户切换 Anna 账号会获得不同数据库”。应用内单独确认避免远端调用直接进入学习界面；其他已获本机文件权限的软件仍受其自身权限约束。

## 构建

在仓库根目录执行 `npm run anna:desktop:package`。开发机需要现有 Node/Rust，最终用户不需要 Node/Rust/Python/uv。脚本总是重建完整桌面界面和本机二进制，不复用未经核验的旧 exe。

输出到唯一 `packages/nativemind-<version>-*/`，包含：

- `nativemind-<version>-windows-x86_64.zip`：正式 binary 分发格式，根清单指定 `bin/nativemind-anna-launcher.exe`，另含 `desktop/nativemind.exe` 和 `vec0.dll`。
- `executa.json`：指向本目录归档的 `distribution.binary_artifacts`，不是桌面 setup.exe。
- `acceptance.json`：归档大小和哈希、已做检查、待做验收。`publishReady` 保持 false。
- `check-new-pc.ps1`：只读依赖/包完整性检查，不自动下载或安装任何东西。

构建复用 `src-tauri/target` 缓存，因此其中的 `release/nativemind.exe` 会是最近构建的版本；运行/分发应使用候选包内 exe，普通桌面包重新用默认桌面构建命令生成。

## 安装与更新

采用 Anna 官方 binary 上传/安装机制：先上传候选 Executa 二进制、绑定精确版本和哈希，再更新 App Required 绑定及新的启动页 UI；保持未发布，先验证。不要用旧内嵌 UI 配新启动工具，二者协议不同。

官方安装器按 Tool ID/版本目录保存软件，切换 current 指向新版本；用户数据在目录外。此机制的真实安装、失败更新、运行中更新与保留旧版本行为尚未在 Anna Agent 上验收。恢复旧程序不代表可回退已经升级的数据库，遇到迁移问题应使用明确备份恢复流程，不自动覆盖学习库。

独立桌面 App 在 Agent 外运行：更新前先退出 App，再更新工具，重新打开。需要确认平台的版本清理不会删除仍在运行的 App 的资源。卸载只应移除软件，用户数据保留。当前没有独立后台更新服务，也未配置 Windows Authenticode 证书。

参考：[官方 binary 分发](https://anna.partners/developers/tools/executa-binary)、[官方协议](https://anna.partners/developers/tools/executa-protocol)。本地代码/哈希检查不替代平台验收或审核。

## 全新电脑验收（尚未完成）

使用一台没有此项目源码、Node、Rust 或旧 NativeMind 数据的 Windows x64 电脑/虚拟机。仅换临时目录不算全新电脑。用户于本轮回复暂无该环境，明确保留此项待验收。

1. 运行候选目录的 `check-new-pc.ps1`，保存输出。确认 WebView2 已安装；未安装时通过微软官方安装程序安装，不能把错误当作应用已启动。
2. 登录 Anna 并选择本机 Windows Agent，安装候选 App/Executa。错误选择云端 Agent 必须明确失败。
3. 点击打开，在本机确认框选“否”：不得打开学习界面或创建学习库。再选“是”：应打开完整界面；记录请求耗时和启动结果。
4. 不装 Ollama 时，任务、笔记、专注等应可用；AI 应提示明确依赖。安装 Ollama/生成模型/向量模型后分别验收聊天、资料问答和索引。
5. 使用合成笔记、任务、阅读进度，关闭 App 后离线重新打开，内容与进度应保留；记录程序外连，确认没有学习内容发给 Anna/远程模型。
6. 保留数据更新下一版本；验证同一数据目录、记录保留、失败安装不替换正常版本。修改 DLL 后启动必须失败。先备份，再测卸载后重装。
7. 不同 Windows 用户不能自动使用另一用户的数据库；同一用户切换 Anna 账号只能发启动请求，不能通过工具读取数据。

最后再填写平台验收结果并提交审核。未完成本页验收前不要标为“已可公开使用”。

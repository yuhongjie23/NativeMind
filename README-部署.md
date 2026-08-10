# NativeMind 便携版部署说明

## 给使用者的步骤（对方机器）
1. 解压 `NativeMind-便携版.zip` 到任意目录（建议英文路径）。
2. **先双击 `setup_ollama.bat`** —— 自动安装 Ollama + 拉取本地模型（首次约 5-15 分钟，视网速）。
3. 双击 `nativemind.exe` 启动。

> 不装 Ollama 也能打开 App（界面/笔记/专注/复盘都正常），只是「陪伴对话 / Flora 回信 / AI 检索 / 复盘生成」这些 AI 功能会降级为模板。装好 Ollama + 模型后即全功能。

## 模型说明
| 档位 | 模型 | 用途 | 体积 |
|---|---|---|---|
| 快速 fast | qwen2.5:1.5b | 陪伴对话/意图/关键词 | ~1GB |
| 教练 coach | qwen2.5:7b | 任务拆分/复盘/苏格拉底 | ~4.7GB |
| 深度 deep | qwen2.5:14b | Flora 回信/长文档 | ~9GB |

- 4060（8GB 显存）建议用 7b；14b 较慢，可在 `setup_ollama.bat` 里删掉对应一行跳过。
- 模型在 App 设置 → 模型与外观 里可切换（下拉选择）。

## 数据存哪
- 用户数据（笔记/任务/专注/复盘/对话）存在本地数据库，首次运行自动创建。
- 数据位置：`%APPDATA%\com.nativemind.app\nativemind.db`（或设置里自定义的存储地址）。
- 想迁移/备份数据：拷走这个 `.db` 文件即可。

## 常见问题
- **exe 很大（几百 MB）**：因为内置了背景音乐/背景图。如果嫌大，可以去掉 `public/audio/backgrounds/` 里不需要的音乐再重新打包。
- **杀毒软件拦截**：便携版无签名，个别杀软可能误报，点「允许」即可。
- **Ollama 装不上**：手动去 https://ollama.com/download 装，装完重跑 `setup_ollama.bat`。

## 重新打包
在开发机上运行：
```powershell
powershell -ExecutionPolicy Bypass -File build-portable.ps1
```
会重新生成 `NativeMind-便携版.zip`。不影响 `npm run dev` / `npm run desktop` 开发流程。

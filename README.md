# NativeMind

本地优先的 AI 学习节律工具 —— 专注、任务、笔记与复盘放在一起，数据全在本机，默认不联网。
A local-first AI study-rhythm app: focus timer, tasks, notes & reviews in one place. All data stays on-device, offline by default.

> **许可 / License**：[非商业使用许可](./LICENSE)（Non-Commercial License）—— 允许学习/研究/个人使用，禁止任何商业用途。

---

## 🚀 快速使用 / Quick Start（无需编译 · no build required）

**如果你想直接使用，不需要下载源码编译：**

1. 下载安装包 **`NativeMind_0.1.0_x64-setup.exe`**（见右侧 **Releases** 页面）并安装；
2. 运行安装目录里的 **`setup_ollama.bat`**（一键安装 Ollama 并拉取本地模型，如 `qwen2.5:1.5b` / `qwen2.5:14b`）；
3. 启动 NativeMind 即可使用。模型功能需要本机 Ollama 已运行；未装 Ollama 时应用回退「模板模式」，任务拆解/复盘用规则模板，核心功能仍可用。

**Want to use it right away without building from source?** Download the installer from **Releases**, then run `setup_ollama.bat` to install Ollama and pull the local models. That's it.

---

## 📦 为什么安装包这么大 / Why is the installer so large?

安装包 **约 2GB**，是因为它把 `src-tauri/resources/audio/backgrounds/` 里的 **7 首背景音乐 mp3（约 1.2GB）** 一并打包，做到开箱即用。mp3 是已压缩格式，打包无法再压小。

- 其中 `backup1.mp3`（701MB）是「备用」曲目，并未被映射使用 —— 正式发布版建议删除。
- **想装小体积版本？** 从源码构建即可：本仓库源码本身只有约 **70MB**（不含媒体）。构建命令见下文。
- 背景音乐可在应用内 **设置 → 路径 → 资源目录** 指向你自己的目录，或把 mp3 换成短循环低码率文件（每首几 MB）后重新打包，安装包可降到 ~60MB。

**The ~2GB installer ships 7 background-music MP3s (~1.2GB) bundled for an out-of-the-box experience — that's why it's large.** The source repo itself is only ~70MB; build from source for a much smaller binary.

---

## 项目简介 / About

NativeMind 是一个本地优先的 AI 学习节律工具。核心不是「和 AI 聊天」，而是四件事：
1. 把今天要学的东西变清楚
2. 把专注过程记录下来
3. 把新旧知识自动关联
4. 把学习结果沉淀成本地笔记和复盘

**核心原则 / Principles**
- AI 只在用户需要整理、连接、复盘时出现；专注时尽量安静
- 所有写入型动作必须经过用户确认
- 本地资料优先，外部搜索只作为补充
- RAG 不是问答机器，而是学习连接器
- 结构化数据是长期资产，模型输出只是草稿

## 功能 / Features

- 全屏「心流小筑」学习房间：场景/天气/时段背景 + 背景音乐（♪ 一键开关）
- 番茄钟专注：计时、暂停、快捷键，结束有提示音
- 任务拆解：AI 按「理解→练习→巩固→自查」拆分，建议需确认后写入
- 笔记导入与检索：PDF/Markdown/TXT/EPUB 导入，RAG 关键词 + 向量 + 深度问答（Self-RAG）
- 复盘：日/周/月自动生成（本地模型，失败降级为数据摘要）
- 陪伴宠物：本地小模型对话（点按/主动一拍）
- 写信「对话」：与 Flora 的历史会话

## 技术栈 / Tech Stack

| 层 | 技术 |
|----|------|
| 外壳 | Tauri v2（Rust 后端） |
| 前端 | React 19 + TypeScript + Vite |
| 状态 | Zustand |
| 数据库 | SQLite（WAL + 迁移） |
| 向量库 | sqlite-vec（`vec0.dll` 随仓库分发） |
| 本地模型 | Ollama（可选 llama.cpp） |

## 环境要求 / Requirements

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18 | 前端构建 |
| Rust | stable (1.75+) | Tauri 后端 |
| [Ollama](https://ollama.com) | 最新 | 本地模型（缺失则回退模板模式） |

Windows 需要 **WebView2**（Win10/11 通常自带）。

## 从源码构建 / Build from source

```bash
# 安装前端依赖
npm install

# 桌面开发模式（编译 Rust + 启动窗口）
npm run desktop

# 打包安装包（NSIS）
npm run desktop:build
```

模型功能需 Ollama 已启动并拉取模型（默认 `qwen2.5:1.5b` 快速 / `qwen2.5:14b` 教练，可在 设置 → 模型与外观 修改）。

## 资源放置 / Resources

仓库**不包含**背景音乐等大体积媒体（见 `.gitignore`），缺失时应用静默运行。

- 背景音乐：mp3 放进 `src-tauri/resources/audio/backgrounds/`，命名规则见 [该目录 README](./src-tauri/resources/audio/backgrounds/README.md)（`day.mp3` / `rain_all.mp3` / `spring_all.mp3` / `summer_firefly.mp3` …）。
- 音乐库 / 读取目录：应用内 设置 → 路径 直接配置。
- `vec0.dll`：已随仓库分发，RAG 依赖，勿删。

## 二次开发 / Development

- 入口：`src/main.tsx` → `FullscreenCozyHome`（`src/ui/demo/fullscreen-cozy-home/`）
- 分层：`domain`（纯逻辑）→ `application`（用例/端口/事件）→ `infrastructure` + `ai`（实现）→ `ui`
- 写库必须走 use-case 并发布事件；AI 建议型写入必须经确认门
- 数据库迁移：`src/infrastructure/db/migrations/`（`NNN_xxx.sql`，注册进 `index.ts`，版本只增不改）
- 命令：`npm test` / `npm run typecheck` / `npm run lint` / `cd src-tauri && cargo test`

## 目录结构 / Structure

```
src/                前端（React + Zustand + hooks）
src-tauri/          Rust 后端（commands / db / model_client / vector）
src-tauri/resources/ bundle 资源（audio 背景乐 / vec0.dll）
public/             静态资产（logo / 陪伴 sprite / 提示音）
tests/              单元与集成测试
scripts/            辅助脚本
```

## 许可 / License

[非商业使用许可](./LICENSE)：允许学习、研究、教学与个人使用，允许修改与分发（须保留本许可与版权声明）；**禁止任何商业用途**（销售、收费 SaaS/云服务、企业内部盈利使用等）。

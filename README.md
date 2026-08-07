# NativeMind

NativeMind 是一个**本地优先（Local-first）**的 AI 学习节律工具：把专注计时、任务拆解、笔记检索、复盘与陪伴式交互整合到同一套桌面体验中。默认数据仅保存在本机，在可用时接入本地 Ollama 模型。

## 功能列表

- 全屏「心流小筑」学习房间
  - 场景 / 天气 / 时段背景
  - 背景音乐陪伴
- 番茄钟专注与暂停
- 任务拆解
  - 支持 AI 建议，且需用户确认后执行
- 本地笔记导入与 RAG 检索
  - 关键词检索
  - 向量检索（sqlite-vec）
  - 深度问答
- 日 / 周 / 月复盘生成
- 陪伴宠物对话（本地小模型）

## 技术栈

- **桌面框架**：Tauri v2（Rust 后端）
- **前端**：React 19 + TypeScript + Vite
- **状态管理**：Zustand
- **本地数据**：SQLite（WAL + migrations）
- **向量检索**：sqlite-vec
- **本地模型**：Ollama

## 环境要求

- Node.js >= 18
- Rust stable toolchain
- Windows 需安装 WebView2
- 使用模型能力前需在本机安装并运行 Ollama

## 快速开始

> 先安装 Ollama：<https://ollama.com>

1. 拉取示例模型（一个快速模型 + 一个教练模型）：

```bash
ollama pull qwen2.5:1.5b
ollama pull qwen2.5:14b
```

2. 安装依赖：

```bash
npm install
```

3. 桌面开发模式：

```bash
npm run desktop
```

4. 桌面打包：

```bash
npm run desktop:build
```

### Ollama 不可用时的回退机制

若 Ollama 未安装或未启动，应用会回退到「模板模式」：

- 任务拆解与复盘改用规则模板（无 AI 参与）
- 其余核心功能仍可正常使用

### 背景音乐资源说明

仓库不分发大体积媒体文件（如背景音乐 mp3）。当资源缺失时，应用会静默运行。你可以将本地 mp3 放入：

`src-tauri/resources/audio/backgrounds/`

## 目录结构（示例）

```text
NativeMind/
├─ src/                          # React + TypeScript 前端
├─ src-tauri/                    # Tauri/Rust 后端
│  ├─ src/
│  ├─ migrations/                # SQLite 迁移
│  └─ resources/
│     └─ audio/
│        └─ backgrounds/         # 本地背景音乐（mp3，不入库）
├─ .github/
│  └─ workflows/                 # CI 工作流
└─ README.md
```

## 二次开发指引

1. **优先保持本地优先原则**：避免引入默认上传云端的数据路径。
2. **新增 AI 能力时提供可回退路径**：确保 Ollama 不可用时仍可用模板逻辑完成关键流程。
3. **数据库变更走迁移**：SQLite schema 变更通过 migrations 管理。
4. **资源按需本地化**：大文件媒体不直接入库，建议通过目录约定由用户自行放置。
5. **提交前验证**：至少完成前端 typecheck 与测试，确保改动可回归。

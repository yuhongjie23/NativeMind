# NativeMind 开发与使用文档

本文档描述**当前仓库里真实存在的代码**。与 `PROJECT_STRUCTURE.md`（设计期规划稿）不同，
本文档中出现的每个文件都可以在仓库中找到；已实现与未实现的部分会明确标注。

- 版本：0.1.0
- 技术栈：React 19 + TypeScript 5 + Vite 5 + Zustand 4 / Tauri 2 + Rust + SQLite
- 文件总数（不含 node_modules / target / dist）：约 190

---

## 一、两种运行形态：网页端 vs 桌面端

这是最容易困惑的一点，先讲清楚。

同一份前端代码有两条运行路径，靠 `src/ui/stores/runtime.ts` 里的
`'__TAURI_INTERNALS__' in window` 判断走哪条：

| | 网页端（`npm run dev`） | 桌面端（`npm run desktop`） |
|---|---|---|
| 启动的东西 | 只有 Vite 开发服务器 | Vite + Rust 主进程，套一个原生窗口 |
| 数据仓储 | `local-demo.ts` 内存实现 | `db/repositories/*` 走 SQLite |
| 数据持久化 | **刷新即丢** | 落盘到应用数据目录 `nativemind.db` |
| AI | 模板模式（规则拆句 + 填空） | 本地模型（Ollama），不可用时降级 |
| 向量检索 | 无 | sqlite-vec，加载失败降级为关键词检索 |
| 文件导入 / PDF | ✅ 桌面端支持（md / txt / pdf，文件对话框选择） | Rust 侧解析 |

所以你看到「只能跑在网页端」，不是功能缺失，而是**命令不同**。
`npm run dev` 只是给 UI 开发用的预览模式，它刻意不依赖 Rust，这样改样式不用等 Rust 编译。

### 桌面端怎么跑起来

```bash
# 一次性环境准备
# 1) Rust 工具链：https://rustup.rs
# 2) Windows 需要 WebView2 Runtime（Win10 1803+ 一般已内置）
#    Linux 需要 libwebkit2gtk-4.1-dev、libssl-dev、libayatana-appindicator3-dev

npm install
npm run desktop          # 开发模式，热更新仍然生效
npm run desktop:build    # 出安装包
```

`npm run desktop` 实际做的事（定义在 `src-tauri/tauri.conf.json`）：
先执行 `beforeDevCommand`（即 `npm run dev`）拉起 Vite，
再启动 Rust 主进程，用原生窗口加载 `devUrl`（http://localhost:5173）。
窗口里跑的还是那份 React 代码，只是这次 `window.__TAURI_INTERNALS__` 存在，
于是 runtime 切到 SQLite 路径。

`npm run desktop:build` 会先 `npm run build` 产出 `dist/`，
再由 Rust 把它嵌进可执行文件，按 `bundle.targets` 打包：
Windows → NSIS 安装器，macOS → dmg，Linux → AppImage / deb。
产物在 `src-tauri/target/release/bundle/`。

### 数据文件在哪

由 `resolve_data_dir()`（`src-tauri/src/lib.rs`）解析系统标准位置：

- Windows：`%APPDATA%\com.nativemind.app\nativemind.db`
- macOS：`~/Library/Application Support/com.nativemind.app/nativemind.db`
- Linux：`~/.local/share/com.nativemind.app/nativemind.db`

拿不到该目录时代码直接 panic，不会退到当前工作目录 —— 开发和打包后的 cwd
完全不同，静默写到随机位置比启动失败更难排查。

---

## 二、本轮补齐的内容与仍缺的部分

### 已补齐

| 项 | 说明 |
|---|---|
| 设置持久化 | 新增 `settings-store.ts`，隐私 / 宠物 / 专注默认值写入 `settings` 表；此前值只存在组件 state，切页即丢 |
| 打包配置 | `bundle` 原本是空对象 `{}`，`tauri build` 不会产出任何安装包。现已配置 targets、图标、NSIS 中文安装界面 |
| 资源打包 | 把 `public/audio` 映射为运行时 `resource_dir/audio`，与 `commands/audio.rs` 的扫描路径对齐 |
| AI 模式透出 | runtime 暴露 `aiMode`，设置页明确显示当前是模板模式还是本地模型 |
| 死代码清理 | 删除 `src/App.tsx`（`main.tsx` 实际导入的是 `./ui/App`，该文件无任何引用） |
| 脚本别名 | 新增 `desktop` / `desktop:build` / `typecheck` |

### 仍然缺失（按优先级）

1. **应用图标只有占位图**。`src-tauri/icons/` 下只有一个 64×64 纯色 `icon.ico`，
   由 `scripts/generate-placeholder-icon.mjs` 生成。macOS 需要 `icon.icns`，
   Linux 需要多尺寸 png。设计稿出来后跑 `npx tauri icon <源图.png>` 一次性生成全套。
2. **代码签名未配置**。未签名的包在 Windows 会弹 SmartScreen 警告，
   macOS 会直接拒绝运行。分发前需要证书并在 `bundle.windows.certificateThumbprint` /
   `bundle.macOS.signingIdentity` 中配置。
3. **音频资源目录是空的**。三个分类目录都建好了但没有文件，环境音选了也不会响。
4. **自动更新未接入**（`plugins` 为空）。
5. **日历集成只有接口**（`calendar-interface.ts`），没有任何平台实现。
6. **`db:migrate` 脚本指向不存在的文件**（`scripts/migrate.js`）。迁移实际由前端
   `Database.migrate()` 在启动时驱动，这个 npm script 是历史遗留，跑会报错。
7. **无集成测试**。`test:integration` 指向 `tests/integration`，该目录不存在。
8. **UI 只有基础样式**。`globals.css` 是手写 CSS；`package.json` 里装了 tailwind
   但没有 `tailwind.config.js`，也没有 postcss 配置，实际并未启用。

---

## 三、分层架构

依赖方向严格单向，越靠上越不认识具体技术：

```
        ui/  ──────────────┐
         │                 │  只调用 useCases / policies，不碰 SQL
         ▼                 │
    application/  ◄────────┘  写库的唯一入口，编排流程、发事件
         │
         ├──► domain/          纯业务规则，无副作用，不 import 任何外部模块
         │
         └──► ports.ts         用接口声明「我需要什么」
                  ▲
                  │  实现这些接口
         infrastructure/ ──► src-tauri/（Rust 命令）
              ai/
```

关键约束：

- **domain 不 import 任何非 domain 模块**。它只有类和纯函数，可以脱离浏览器测试。
- **只有 application/use-cases 能写库**。UI 和 AI 都不能直接调仓储，
  否则事件不会发出，订阅者（索引、复盘、审计）全部失效。
- **infrastructure 通过 ports.ts 的接口被注入**，因此内存实现和 SQLite 实现可互换 ——
  这正是网页端与桌面端能共用同一套业务代码的原因。
- **AI 的写入必须经过确认**。`confirmation-service.ts` 把 AI 提议转成待确认动作，
  用户点确认后才真正落库。

---

## 四、逐文件说明

### 4.1 仓库根

| 文件 | 说明 |
|---|---|
| `package.json` | 依赖与脚本。注意 `db:migrate` 指向的文件不存在 |
| `package-lock.json` | 依赖锁定 |
| `tsconfig.json` | TS 编译配置，定义 `@infrastructure` / `@application` 等路径别名 |
| `vite.config.ts` | Vite 配置：React 插件、路径别名、`core` 手动分包、vitest 配置 |
| `index.html` | 唯一 HTML 入口，提供 `#root` 挂载点 |
| `README.md` | 项目简介 |

### 4.2 `scripts/`

| 文件 | 说明 |
|---|---|
| `generate-placeholder-icon.mjs` | 手写 ICO 容器生成占位图标。tauri-build 在 Windows 上缺 `icon.ico` 连 `cargo check` 都过不去，此脚本负责打通编译链路 |

### 4.3 `src/` 入口

| 文件 | 说明 |
|---|---|
| `main.tsx` | 挂载 React。开着 StrictMode，双次挂载能提前暴露订阅未清理的问题 |
| `vite-env.d.ts` | Vite 客户端类型声明 |

### 4.4 `src/domain/` — 领域层

纯业务规则，无副作用。每个子目录一个 `index.ts` 做桶导出。

| 文件 | 说明 |
|---|---|
| `todo/Todo.ts` | Todo 实体与状态流转规则（标题非空、状态迁移合法性） |
| `todo/Goal.ts` | 目标实体，Todo 的上层归属 |
| `todo/index.ts` | 桶导出 |
| `focus/FocusSession.ts` | 专注会话实体。定义 active / completed / aborted 状态与时长计算 |
| `focus/index.ts` | 桶导出 |
| `note/Note.ts` | 笔记实体与元数据 |
| `note/NoteChunk.ts` | 笔记分块实体，RAG 的检索单元 |
| `note/index.ts` | 桶导出 |
| `knowledge-link/KnowledgeLink.ts` | 知识关联实体与关系类型 |
| `knowledge-link/index.ts` | 桶导出 |
| `review/ReviewLog.ts` | 复盘记录实体（日报 / 周报） |
| `review/index.ts` | 桶导出 |
| `socratic/SocraticSession.ts` | 苏格拉底式提问会话与问题序列 |
| `socratic/index.ts` | 桶导出 |
| `companion/CompanionProfile.ts` | 宠物档案：性格、称呼、互动频率 |
| `companion/CompanionEvent.ts` | 宠物互动场景与触发事件定义 |
| `companion/index.ts` | 桶导出 |

### 4.5 `src/application/` — 应用层

| 文件 | 说明 |
|---|---|
| `ports.ts` | **架构核心**。用接口声明应用层需要的能力（各类仓储、模型、向量库、事件总线）。infrastructure 实现它们 |
| `bootstrap.ts` | 组装 Application：注入仓储与 AI，挂载事件订阅者，返回 useCases / policies / eventBus |
| `index.ts` | 桶导出 |
| `shared/utils.ts` | 应用层公共工具（ID 生成、时间处理） |
| `events/event-bus.ts` | 进程内事件总线，同步派发，支持退订 |
| `events/event-types.ts` | 所有领域事件的类型定义，事件名的唯一来源 |
| `events/subscribers/note-index-subscriber.ts` | 笔记导入后排入解析 / 分块 / 嵌入任务 |
| `events/subscribers/review-subscriber.ts` | 累积当日行为供复盘生成 |
| `events/subscribers/companion-subscriber.ts` | 领域事件转宠物互动触发（受互动策略节流） |
| `events/subscribers/audit-subscriber.ts` | 写审计日志，AI 写入可追溯 |
| `policies/privacy-policy.ts` | 联网开关。默认拒绝出网，Web 搜索必须先过它 |
| `policies/focus-mode-policy.ts` | 专注期间抑制打扰（宠物、通知） |
| `policies/interaction-policy.ts` | 宠物互动节流：判断此刻该不该出现，避免频繁打扰 |
| `confirmation/action-proposal.ts` | AI 提议的动作对象（做什么、影响什么、可否撤销） |
| `confirmation/confirmation-service.ts` | 提议 → 用户确认 → 执行。AI 写库的必经关卡 |
| `use-cases/todo/create-todo.ts` | 创建任务，发 `TodoConfirmed` |
| `use-cases/todo/complete-todo.ts` | 完成任务，发 `TodoCompleted` |
| `use-cases/todo/update-todo.ts` | 更新任务字段 |
| `use-cases/focus/start-focus.ts` | 开始专注，写入 active 会话 |
| `use-cases/focus/complete-focus.ts` | 正常结束，记录时长与笔记，发 `FocusCompleted` |
| `use-cases/focus/abort-focus.ts` | 中断专注，记录原因 |
| `use-cases/note/import-note.ts` | 导入笔记，发 `NoteImported` 触发后台索引 |
| `use-cases/note/update-note.ts` | 更新笔记内容，需重新索引 |
| `use-cases/note/search-notes.ts` | 检索笔记，向量不可用时降级关键词 |
| `use-cases/review/generate-daily-review.ts` | 生成日复盘 |
| `use-cases/review/generate-weekly-review.ts` | 生成周复盘 |
| `use-cases/companion/trigger-interaction.ts` | 触发宠物互动，先问互动策略与专注策略 |
| `use-cases/companion/handle-user-response.ts` | 处理用户对宠物的回应，发 `CompanionInteractionCompleted` |
| `use-cases/socratic/start-session.ts` | 开启提问会话 |
| `use-cases/socratic/ask-question.ts` | 生成下一个问题 |

### 4.6 `src/ai/` — AI 编排层

不直接调模型，通过 ports 注入的模型接口工作。

| 文件 | 说明 |
|---|---|
| `types.ts` | AI 层类型定义 |
| `index.ts` | 桶导出 |
| `adapters.ts` | 把 AI 能力适配成 application 期望的接口形状 |
| `shared/utils.ts` | AI 层公共工具 |
| `router/model-router.ts` | 按任务复杂度选模型档位，弱模型不可用时升档 |
| `router/tier-config.ts` | 模型档位配置（小 / 中 / 大及各自适用任务） |
| `prompts/index.ts` | Prompt 加载与版本管理 |
| `prompts/intent.v1.md` | 意图识别 prompt |
| `prompts/todo-structuring.v1.md` | 自然语言转结构化任务 |
| `prompts/review-daily.v1.md` | 日复盘生成 |
| `prompts/rag-relation.v1.md` | 判断两段笔记的关系 |
| `prompts/socratic.v1.md` | 苏格拉底式提问 |
| `schemas/index.ts` | JSON Schema 注册表 |
| `schemas/intent.v1.json` | 意图输出结构约束 |
| `schemas/todo.v1.json` | 任务输出结构约束 |
| `schemas/review-log.v1.json` | 复盘输出结构约束 |
| `schemas/knowledge-link.v1.json` | 知识关联输出结构约束 |
| `evaluation/json-validator.ts` | 校验模型 JSON 输出。本地小模型经常输出带解释文字的伪 JSON，这里负责抽取与验证 |
| `evaluation/quality-metrics.ts` | 输出质量打分 |
| `rag/chunk-strategy.ts` | 笔记分块策略（按语义边界，保留重叠） |
| `rag/retrieval-strategy.ts` | 检索策略：向量 / 关键词 / 混合 |
| `rag/relation-judge.ts` | 让模型判断候选块与查询的相关性，过滤向量误召回 |
| `rag/rag-orchestrator.ts` | 串起分块 → 检索 → 判定 → 组装上下文 |
| `search/search-gate.ts` | **联网前的最后一道闸**。判断这个问题是否真的需要联网，能本地回答就不出网 |
| `search/keyword-generator.ts` | 把用户问题转成搜索关键词 |
| `search/result-filter.ts` | 过滤搜索结果噪声 |
| `companion/interaction-generator.ts` | 按场景与宠物性格生成互动文案 |

### 4.7 `src/infrastructure/` — 基础设施层

| 文件 | 说明 |
|---|---|
| `index.ts` | 桶导出 |
| `tauri-runtime.ts` | **桌面端装配点**。建 SQLite 驱动、各仓储、真实模型 provider、向量库、任务队列，组装出完整 Application |
| `local-demo.ts` | **网页端装配点**。全内存仓储 + 模板 AI，让 UI 在没有 Rust 的情况下也能开发调试。含内存版设置仓储 |
| `db/database.ts` | 数据库门面：迁移执行、版本表维护、完整性检查 |
| `db/tauri-driver.ts` | 把 SQL 通过 Tauri 命令发到 Rust 执行。命令名与 `commands/db.rs` 一一对应，改名会断掉所有仓储 |
| `db/migrations/index.ts` | 迁移清单，按序号执行 |
| `db/migrations/001_init.sql` | 初始表结构 |
| `db/migrations/002_add_socratic.sql` | 苏格拉底会话表 |
| `db/migrations/003_add_companion_interactions.sql` | 宠物互动记录表 |
| `db/repositories/todo-repository.ts` | 任务表读写 |
| `db/repositories/focus-repository.ts` | 专注会话读写，含中断会话恢复 |
| `db/repositories/note-repository.ts` | 笔记与分块读写 |
| `db/repositories/review-repository.ts` | 复盘记录读写 |
| `db/repositories/companion-repository.ts` | 宠物档案与互动历史读写 |
| `db/repositories/support-repositories.ts` | 设置、审计、任务队列等辅助表仓储 |
| `vector-store/vector-store-interface.ts` | 向量库抽象接口 |
| `vector-store/sqlite-vec-provider.ts` | sqlite-vec 实现。`isAvailable()` 探测扩展是否加载成功，失败让上层降级 |
| `vector-store/chroma-provider.ts` | Chroma 实现，备选方案 |
| `model-runtime/model-interface.ts` | 模型能力抽象（补全、嵌入、可用性探测） |
| `model-runtime/tauri-model-provider.ts` | 经 Rust 调模型，绕开 WebView 的跨域限制 |
| `model-runtime/ollama-provider.ts` | 直连 Ollama HTTP API |
| `model-runtime/llama-cpp-provider.ts` | llama.cpp 实现，备选 |
| `rag/note-candidate-provider.ts` | 为 RAG 提供候选笔记块 |
| `file-import/index.ts` | 导入入口，按扩展名分派 |
| `file-import/markdown-parser.ts` | Markdown 解析，保留标题层级 |
| `file-import/pdf-parser.ts` | PDF 文本抽取（实际解析在 Rust 侧） |
| `file-import/text-normalizer.ts` | 文本归一化：空白、换行、全半角 |
| `background-jobs/job-queue.ts` | 持久化任务队列。落库而非内存，重启后未完成任务能续跑 |
| `background-jobs/parse-note-job.ts` | 解析笔记文本 |
| `background-jobs/chunk-note-job.ts` | 分块 |
| `background-jobs/embed-job.ts` | 生成嵌入向量，完成后发 `NoteIndexed` |
| `audio/audio-library.ts` | 静态音频清单（分类 + 元数据） |
| `audio/audio-player.ts` | HTML Audio 播放器，管音量、循环、环境音互斥。播放只在前端做，Rust 不参与，否则会两路音源同响 |
| `calendar/calendar-interface.ts` | 日历接口定义，**尚无实现** |

### 4.8 `src/types/`

| 文件 | 说明 |
|---|---|
| `domain.ts` | 跨层共享的领域类型 |
| `config.ts` | 配置类型（隐私、宠物、专注默认值等） |
| `events.ts` | 事件负载类型 |
| `api.ts` | Tauri 命令的请求 / 响应类型 |
| `common.ts` | 通用工具类型 |

### 4.9 `src/ui/`

| 文件 | 说明 |
|---|---|
| `App.tsx` | 根组件。管当前页面、把领域事件接到 store 刷新上；等 `startRuntime()` 完成（建表 + 读设置）才渲染页面 |
| `styles/globals.css` | 全局样式。当前是手写 CSS，未启用 Tailwind |

**stores/**（Zustand）

| 文件 | 说明 |
|---|---|
| `runtime.ts` | 运行时单例。检测环境二选一装配，导出 useCases / policies / repositories / `aiMode` / `startRuntime` |
| `todo-store.ts` | 任务状态与选择器（`selectPendingTodos` 等） |
| `focus-store.ts` | 专注会话状态、历史、今日分钟数 |
| `note-store.ts` | 笔记检索状态 |
| `review-store.ts` | 复盘状态 |
| `companion-store.ts` | 宠物互动状态（配置已迁到 settings-store） |
| `settings-store.ts` | 设置读写。隐私 / 宠物 / 专注默认值落 `settings` 表，改完即存；`load()` 会把隐私值回灌给 PrivacyPolicy |
| `confirmation-store.ts` | 待确认动作队列，向应用层暴露 `uiConfirmationPrompt` |

**hooks/**

| 文件 | 说明 |
|---|---|
| `use-event-listener.ts` | 订阅领域事件并在卸载时自动退订 |
| `use-focus-mode.ts` | 读取专注态，供组件抑制干扰元素 |
| `use-confirmation.ts` | 读取待确认动作 |

**components/**

| 文件 | 说明 |
|---|---|
| `common/Button.tsx` | 按钮，支持 primary / ghost 等变体 |
| `common/Input.tsx` | 输入框与 TextArea，自带 label 关联 |
| `common/Modal.tsx` | 模态框，处理焦点陷阱与 Esc 关闭 |
| `layout/AppShell.tsx` | 整体骨架：侧栏 + 内容区 + 全局确认弹窗 |
| `layout/Sidebar.tsx` | 导航栏，`PageKey` 类型的定义处 |
| `features/TodoCard.tsx` | 任务卡片 |
| `features/FocusTimer.tsx` | 计时器。归零只回调 `onElapsed`，不自动结束会话 |
| `features/CompanionWidget.tsx` | 宠物气泡 |
| `features/ConfirmationModal.tsx` | AI 动作确认弹窗，展示影响范围与可否撤销 |

**pages/**

| 文件 | 说明 |
|---|---|
| `TodayPage.tsx` | 今日：任务录入与列表 |
| `FocusPage.tsx` | 专注：时长选择、关联任务、环境音、历史。默认值来自 settings |
| `KnowledgePage.tsx` | 知识：笔记导入与检索 |
| `ReviewPage.tsx` | 复盘：日报 / 周报 |
| `CompanionPage.tsx` | 宠物：互动与历史 |
| `SettingsPage.tsx` | 设置：隐私、宠物、专注默认值、AI 模式说明 |

### 4.10 `src-tauri/` — Rust 后端

这一层刻意很薄：只做浏览器做不到的事（SQLite 事务、文件 IO、动态库加载、绕开
WebView 的 HTTP）。它不认识 Todo / Note / FocusSession，只认识 SQL 字符串、
文件路径和 HTTP 请求。加功能前先问「前端能不能做」，能做就别放进来。

| 文件 | 说明 |
|---|---|
| `Cargo.toml` | Rust 依赖 |
| `Cargo.lock` | 依赖锁定 |
| `build.rs` | tauri-build 构建脚本 |
| `tauri.conf.json` | 窗口、构建命令、安全能力、打包配置 |
| `capabilities/default.json` | 主窗口权限白名单。用到新的 core 权限要在这里显式加 |
| `icons/icon.ico` | 应用图标（当前为占位图） |
| `src/main.rs` | 可执行入口，调 `lib::run()` |
| `src/lib.rs` | 装配：解析数据目录、开库、尝试加载 sqlite-vec、注册全部命令 |
| `src/utils/mod.rs` | `CommandResult` 等公共类型，统一错误序列化 |
| `src/db/mod.rs` | db 模块声明 |
| `src/db/connection.rs` | SQLite 连接管理与事务 |
| `src/db/migrations.rs` | 说明为何迁移**不在** Rust 侧执行（版本表与 SQL 都在 TS，那边有测试） |
| `src/commands/mod.rs` | 命令模块声明与 `AppPaths` |
| `src/commands/db.rs` | `db_select` / `db_execute` / `db_schema_status` / `db_integrity_check` / `db_path`。命令名与前端 `TauriSqlDriver` 对齐 |
| `src/commands/file.rs` | 文本读写、内容哈希、元数据、PDF 抽取 |
| `src/commands/model.rs` | 模型就绪探测、列表、补全、嵌入 |
| `src/commands/vector.rs` | 向量扩展状态与扩展目录，前端据此决定是否降级 |
| `src/commands/audio.rs` | 扫描 `resource_dir/audio` 下 ambient / cue / companion 三类音频。**不负责播放** |
| `src/file_parser/mod.rs` | 解析器模块声明 |
| `src/file_parser/markdown.rs` | Markdown 解析 |
| `src/file_parser/pdf.rs` | PDF 文本抽取 |
| `src/model_client/mod.rs` | 模型客户端模块声明 |
| `src/model_client/ollama.rs` | Ollama HTTP 客户端。地址非本机时构造失败，属配置错误，启动阶段即暴露 |
| `src/vector/mod.rs` | 向量模块声明 |
| `src/vector/sqlite_vec.rs` | `load_quietly()` 尝试加载扩展，失败只记日志不中断启动 |

### 4.11 `tests/`

| 文件 | 说明 |
|---|---|
| `unit/ai/model-router.test.ts` | 模型档位选择与降级（14 例） |
| `unit/ai/json-validator.test.ts` | 模型 JSON 输出校验与容错（24 例） |
| `unit/ai/search-gate.test.ts` | 联网闸门判定（22 例） |
| `unit/ai/rag.test.ts` | 分块 / 检索 / 关系判定（21 例） |
| `unit/infrastructure/file-import.test.ts` | 导入与文本归一化（12 例） |
| `unit/infrastructure/providers.test.ts` | provider 可用性探测与降级（9 例） |
| `unit/infrastructure/job-queue.test.ts` | 队列出入、重试、恢复（7 例） |
| `unit/infrastructure/memory-driver.ts` | 测试用内存 SQL 驱动（非测试用例，是工具） |

合计 109 个用例。domain 与 application 层目前没有测试覆盖。

### 4.12 `docs/`

| 文件 | 说明 |
|---|---|
| `DEVELOPMENT.md` | 本文档 |
| `PROJECT_STRUCTURE.md` | 设计期结构稿，部分内容与实际代码不一致，以本文档为准 |
| `DATABASE_SCHEMA.md` | 表结构设计 |
| `EVENT_SYSTEM.md` | 事件系统设计 |
| `产品架构_v2.md` | 产品架构与约束（C1–C7） |
| `宠物互动接口补充方案.md` | 宠物互动接口设计 |
| `spark.txt` | 早期想法记录 |

---

## 五、常用命令

```bash
npm run dev              # 网页端预览（数据不持久化）
npm run desktop          # 桌面端开发
npm run desktop:build    # 桌面端打包
npm run typecheck        # tsc --noEmit
npm test                 # 全部单测
npm run test:unit        # 仅 tests/unit
npm run build            # tsc + vite build（产出 dist/）
npm run icon:placeholder # 重新生成占位图标
```

Rust 侧：

```bash
cd src-tauri
cargo check              # 快速类型检查
cargo clippy             # lint
```

### 常见问题

**`Error: Port 5173 is already in use` → `beforeDevCommand terminated with a non-zero status code`**

已经有一个 Vite 开发服务器在跑（通常是之前 `npm run dev` 没关）。
`vite.config.ts` 里设了 `strictPort: true`，这是**故意的**：
`tauri.conf.json` 的 `devUrl` 硬编码指向 5173，如果放任 Vite 自动换到 5174，
桌面窗口会加载一个空地址，得到一个白屏窗口 —— 那比直接报端口错误难查得多。

处理：关掉已有的 dev server 再跑 `npm run desktop`。
查占用方（Windows）：

```bash
netstat -ano | findstr :5173
taskkill /PID <上一步得到的 PID> /F
```

注意 `npm run desktop` 自己会拉起 Vite，不需要另开一个终端跑 `npm run dev`。

**`启动失败 / 数据库错误：table todos already exists`**

已修复，记录原因备查。React StrictMode 会把挂载 effect 执行两次，
两次 `startRuntime()` 并发进来，都读到空的 `schema_migrations`，
于是都去执行 001_init —— 先到的建表成功，后到的撞上 "table todos already exists"，
于是一次**其实已经成功**的初始化被报成启动失败。
数据库本身是完好的（可用 `sqlite3 <db> "SELECT * FROM schema_migrations"` 确认）。

两处修复：
- `tauri-runtime.ts` 用 Promise 对 `initialize()` 去重，失败时清缓存以允许重试
- `Database.migrate()` 把「该版本是否已应用」的判定移进事务内部。
  事务外先查再执行必然留下竞态窗口；驱动的事务队列保证同时只有一个事务，
  因此在事务内复查是可靠的。这样无论谁并发调用 migrate 都安全。

**桌面窗口打开但白屏**：Vite 没起来或端口不匹配，看终端里 `beforeDevCommand` 的输出。


**首次 `npm run desktop` 很慢**：Rust 依赖首次编译需要几分钟，之后增量编译很快。


---

## 六、加功能时的落点

| 需求 | 改哪里 |
|---|---|
| 新增业务规则 | `domain/`，写纯函数并加测试 |
| 新增用户流程 | `application/use-cases/`，记得发事件 |
| 新增页面 | `ui/pages/` + `Sidebar.tsx` 的 `PageKey` + `App.tsx` 的 pages 映射 |
| 新增持久化数据 | 加迁移 SQL → 加仓储 → 在 `ports.ts` 声明接口 → 两个 runtime 都注入 |
| 新增设置项 | `types/config.ts` → `settings-store.ts` → `SettingsPage.tsx` |
| 新增 Rust 能力 | `commands/` 加函数 → `lib.rs` 注册 → 必要时在 `capabilities/default.json` 加权限 |
| 新增 AI 能力 | `ai/prompts/` 加 prompt 与 schema，写库必须走 confirmation |

两个容易踩的坑：

- 在 `local-demo.ts` 忘记注入新仓储 → 网页端预览一打开就报错，桌面端却正常。
- 绕过 use-case 直接调仓储写库 → 数据进去了但索引、复盘、审计都不会更新。

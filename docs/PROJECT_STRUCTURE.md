# NativeMind 项目结构说明

## 总体架构图

```
NativeMind/
├── src/                          # 前端源码（React + TypeScript）
├── src-tauri/                    # Tauri Rust 后端
├── docs/                         # 项目文档
├── public/                       # 静态资源
├── tests/                        # 测试文件
└── scripts/                      # 构建和工具脚本
```

---

## 1. 前端源码 (`src/`)

基于 React 19 + TypeScript + Tailwind CSS 的模块化单体架构。

### 1.1 领域层 (`src/domain/`)

**职责**: 核心业务规则，不依赖外部（UI、数据库、模型）

| 模块 | 职责 | 核心对象 |
|------|------|----------|
| `todo/` | Todo 任务核心规则 | Todo、Goal、TodoStatus |
| `focus/` | 番茄钟与专注规则 | FocusSession、FocusState |
| `note/` | 笔记核心规则 | Note、NoteChunk、NoteMetadata |
| `knowledge-link/` | 知识关系规则 | KnowledgeLink、RelationType |
| `review/` | 复盘规则 | ReviewLog、ReviewType |
| `socratic/` | 苏格拉底提问规则 | SocraticSession、Question |
| `companion/` | 陪伴角色规则 | CompanionProfile、CompanionScene、CompanionInteraction |

**实现思路**:
- 纯 TypeScript 类和接口，无副作用
- 包含验证逻辑（如 Todo 标题不能为空）
- 不调用数据库、不调用模型、不直接操作 UI
- 每个模块导出领域实体、值对象、领域规则

### 1.2 应用用例层 (`src/application/`)

**职责**: 编排用户流程，是写入数据库的**唯一入口**

```
application/
├── use-cases/              # 用户流程编排
│   ├── todo/
│   │   ├── create-todo.ts
│   │   ├── complete-todo.ts
│   │   └── update-todo.ts
│   ├── focus/
│   │   ├── start-focus.ts
│   │   ├── complete-focus.ts
│   │   └── abort-focus.ts
│   ├── note/
│   │   ├── import-note.ts
│   │   ├── update-note.ts
│   │   └── search-notes.ts
│   ├── review/
│   │   ├── generate-daily-review.ts
│   │   └── generate-weekly-review.ts
│   ├── companion/
│   │   ├── trigger-interaction.ts
│   │   └── handle-user-response.ts
│   └── socratic/
│       ├── start-session.ts
│       └── ask-question.ts
├── confirmation/           # 统一写入确认机制
│   ├── confirmation-service.ts
│   └── action-proposal.ts
├── policies/              # 策略对象
│   ├── focus-mode-policy.ts      # 专注模式裁决
│   ├── interaction-policy.ts     # 宠物互动策略
│   └── privacy-policy.ts         # 隐私与联网裁决
└── events/                # 领域事件系统
    ├── event-bus.ts
    ├── event-types.ts
    └── subscribers/
        ├── companion-subscriber.ts
        ├── review-subscriber.ts
        └── audit-subscriber.ts
```

**实现思路**:
- 用例是业务流程的编排者，调用领域层 + AI 层 + 基础设施层
- 所有 AI 建议的写入必须经过 `ConfirmationService` 确认
- 用例完成后发布领域事件，供其他模块订阅
- `FocusModePolicy` 在专注期间拦截所有 AI 主动行为

### 1.3 AI 编排层 (`src/ai/`)

**职责**: 模型路由、Prompt 管理、RAG 编排、外部搜索

```
ai/
├── router/                 # 模型路由器
│   ├── model-router.ts     # 根据任务类型选择模型层级
│   └── tier-config.ts      # 1.5B / 7B / 14B 配置
├── prompts/               # Prompt 模板（版本化）
│   ├── intent.v1.md
│   ├── todo-structuring.v1.md
│   ├── review-daily.v1.md
│   ├── rag-relation.v1.md
│   └── socratic.v1.md
├── schemas/               # JSON Schema（版本化）
│   ├── intent.v1.json
│   ├── todo.v1.json
│   ├── review-log.v1.json
│   └── knowledge-link.v1.json
├── rag/                   # RAG 编排
│   ├── rag-orchestrator.ts
│   ├── chunk-strategy.ts
│   ├── retrieval-strategy.ts
│   └── relation-judge.ts
├── search/                # 外部搜索门禁
│   ├── search-gate.ts
│   ├── keyword-generator.ts
│   └── result-filter.ts
├── companion/             # 宠物互动 AI
│   └── interaction-generator.ts
└── evaluation/            # 评测工具
    ├── json-validator.ts
    └── quality-metrics.ts
```

**实现思路**:
- AI 层只产出**草稿**或 `ActionProposal`，不直接写库
- 所有结构化输出必须经过 JSON Schema 校验
- Prompt 和 Schema 版本化，每次调用记录版本号
- 模型调用失败时有降级链（§16.1）

### 1.4 基础设施层 (`src/infrastructure/`)

**职责**: 数据库、向量库、文件解析、模型运行时等可替换实现

```
infrastructure/
├── db/                    # SQLite
│   ├── database.ts        # 数据库连接
│   ├── migrations/        # 数据库迁移脚本
│   │   ├── 001_init.sql
│   │   ├── 002_add_socratic.sql
│   │   └── 003_add_companion_interactions.sql
│   └── repositories/      # 数据访问层
│       ├── todo-repository.ts
│       ├── focus-repository.ts
│       ├── note-repository.ts
│       ├── review-repository.ts
│       └── companion-repository.ts
├── vector-store/          # 向量库 Provider
│   ├── vector-store-interface.ts
│   ├── sqlite-vec-provider.ts
│   └── chroma-provider.ts
├── file-import/           # PDF / Markdown 解析
│   ├── pdf-parser.ts
│   ├── markdown-parser.ts
│   └── text-normalizer.ts
├── model-runtime/         # 本地模型运行时
│   ├── model-interface.ts
│   ├── ollama-provider.ts
│   └── llama-cpp-provider.ts
├── audio/                 # 音频播放
│   ├── audio-player.ts
│   └── audio-library.ts
├── calendar/              # 日历 Provider
│   └── calendar-interface.ts
└── background-jobs/       # 后台任务
    ├── job-queue.ts
    ├── parse-note-job.ts
    ├── chunk-note-job.ts
    └── embed-chunks-job.ts
```

**实现思路**:
- 所有外部依赖走 Provider 接口，业务代码不绑定具体实现
- Repository 是数据访问层，用例层通过 Repository 读写数据
- 后台任务（切分、embedding）走 Job 队列，支持重试和断点续传
- 专注期间不启动占用模型资源的 Job

### 1.5 UI 层 (`src/ui/`)

**职责**: 页面、组件、交互、动画

```
ui/
├── components/            # 共享组件
│   ├── ui/               # shadcn/ui 组件
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── MainLayout.tsx
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── Modal.tsx
│   └── features/
│       ├── TodoCard.tsx
│       ├── FocusTimer.tsx
│       ├── CompanionWidget.tsx
│       └── KnowledgeGraph.tsx
├── pages/                # 页面
│   ├── Today.tsx         # 今日计划
│   ├── Notes.tsx         # 笔记与知识库
│   ├── Focus.tsx         # 专注番茄钟
│   ├── Connection.tsx    # 知识连接
│   ├── Review.tsx        # 复盘
│   └── Settings.tsx      # 设置
├── stores/               # Zustand 状态管理
│   ├── todo-store.ts
│   ├── focus-store.ts
│   ├── note-store.ts
│   └── companion-store.ts
├── hooks/                # 自定义 Hooks
│   ├── use-focus-mode.ts
│   ├── use-confirmation.ts
│   └── use-event-listener.ts
└── styles/               # 样式
    ├── globals.css
    └── tailwind.config.js
```

**实现思路**:
- UI 层不直接调模型、不直接写库
- 所有业务操作通过调用 `application/use-cases/` 完成
- 使用 Zustand 做状态管理，按领域模块拆分 store
- 确认弹窗统一由 `ConfirmationService` 触发

### 1.6 类型定义 (`src/types/`)

**职责**: 全局类型定义

```
types/
├── domain.ts             # 领域对象类型
├── api.ts                # API 请求响应类型
├── events.ts             # 领域事件类型
└── config.ts             # 配置类型
```

---

## 2. Tauri 后端 (`src-tauri/`)

Rust 后端负责 SQLite、文件 IO、向量库、Ollama 调用等。

```
src-tauri/
├── src/
│   ├── main.rs           # Tauri 主入口
│   ├── commands/         # Tauri 命令（前端通过 invoke 调用）
│   │   ├── db.rs         # 数据库操作
│   │   ├── file.rs       # 文件操作
│   │   ├── model.rs      # 模型调用
│   │   └── audio.rs      # 音频播放
│   ├── db/               # SQLite 操作
│   │   ├── mod.rs
│   │   ├── connection.rs
│   │   └── migrations.rs
│   ├── vector/           # 向量库
│   │   ├── mod.rs
│   │   └── sqlite_vec.rs
│   ├── file_parser/      # 文件解析
│   │   ├── mod.rs
│   │   ├── pdf.rs
│   │   └── markdown.rs
│   ├── model_client/     # 模型客户端
│   │   ├── mod.rs
│   │   └── ollama.rs
│   └── utils/            # 工具函数
│       └── mod.rs
├── Cargo.toml            # Rust 依赖
└── tauri.conf.json       # Tauri 配置
```

**实现思路**:
- Rust 层提供高性能的 SQLite 和文件操作
- 前端通过 `invoke('command_name', { args })` 调用 Rust 函数
- 所有数据库写入在 Rust 层完成，确保事务一致性
- 向量库优先使用 SQLite 扩展（部署简单）

---

## 3. 文档 (`docs/`)

```
docs/
├── PROJECT_STRUCTURE.md          # 本文件
├── DEVELOPMENT.md          # 开发规范
├── API_DESIGN.md                 # API 设计文档
├── DATABASE_SCHEMA.md            # 数据库表结构
├── EVENT_SYSTEM.md               # 领域事件系统设计
├── 产品架构_v2.md                # 完整架构设计（原始）
└── 宠物互动接口补充方案.md       # 宠物互动设计（原始）
```

---

## 4. 静态资源 (`public/`)

```
public/
├── companions/           # 陪伴角色资源包
│   ├── gugu-gaga/       # 咕咕嘎嘎角色
│   │   ├── profile.json
│   │   ├── animations/
│   │   │   ├── idle.json
│   │   │   ├── focus.json
│   │   │   └── celebrate.json
│   │   └── dialogues/
│   │       └── templates.json
│   └── [其他角色]/
├── audio/               # 音频资源
│   ├── music/
│   ├── white-noise/
│   └── notification/
├── icons/               # 图标
└── images/              # 图片
```

---

## 5. 测试 (`tests/`)

```
tests/
├── unit/                # 单元测试
│   ├── domain/
│   ├── application/
│   └── ai/
├── integration/         # 集成测试
│   ├── use-cases/
│   └── repositories/
└── e2e/                # 端到端测试
    └── scenarios/
```

---

## 6. 脚本 (`scripts/`)

```
scripts/
├── setup.sh             # 环境配置
├── migrate.sh           # 数据库迁移
└── build-prod.sh        # 生产构建
```

---

## 核心设计原则

### 依赖方向

```
UI → application → domain
         ↓
   infrastructure (实现接口)
         ↓
      AI 层 (只产出草稿)
```

### 数据流

```
用户输入 → UI → 用例层 → 领域层验证 → AI 生成草稿
         → 用户确认 → Repository 写库 → 发布领域事件
```

### 模块解耦

- 通过**领域事件总线**解耦跨模块通信
- 陪伴角色、复盘、审计通过**订阅事件**响应，不直接耦合业务模块
- 所有 AI 行为必须经过 `FocusModePolicy` 裁决

### 可扩展性

| 想加什么 | 改哪里 | 不该改哪里 |
|----------|--------|------------|
| 新陪伴角色 | 加资源包 | 不改用例层 |
| 新 AI 任务 | 加 Prompt + Schema + 路由 | 不在业务代码直接调模型 |
| 换向量库 | 实现 Provider 接口 | 不改 RAG 编排逻辑 |
| 新统计功能 | 加事件订阅者 | 不改事件发布者 |

---

## 下一步

1. 阅读 `docs/DEVELOPMENT.md` 了解开发规范
2. 阅读 `docs/DATABASE_SCHEMA.md` 了解数据模型
3. 阅读 `docs/EVENT_SYSTEM.md` 了解事件系统
4. 开始填充核心模块代码

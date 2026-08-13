# NativeMind — 工作指南（极简，控制上下文占用）

本地优先的 AI 学习节律工具。Tauri v2 + React 19 + Zustand + SQLite + sqlite-vec + Ollama。

## 关键事实（勿重复探索）
- **入口是 `src/main.tsx` → `FullscreenCozyHome`**。`src/ui/pages/*`、`src/ui/App.tsx` 已删，别再找它们。
- 分层：`domain`（纯逻辑）→ `application`（用例/端口/事件）→ `infrastructure` + `ai`（实现）→ `ui`。UI 只经 use-case 写库。
- 写库必须走 use-case（含发事件）；AI 建议型写入必须经确认门（AGENTS.md 铁律）。
- 音频：内置环境音 `audio-player`、天气自定义歌 `FullscreenCozyHome.playCustom`、音乐库 `music-store`、专注歌 `focus-music` store，四路独立。
- 备份/每日清理在 `FullscreenCozyHome` 启动里（`runMaintenance`），不是 App.tsx。

## 命令
- `npm run dev`（网页预览，数据不持久化）/ `npm run desktop`（Tauri 桌面）
- `npm test` / `npm run typecheck` / `npm run lint`（ESLint 类型感知规则已开，`no-floating-promises`/`exhaustive-deps` 生效）
- Rust：`cd src-tauri && cargo test` / `cargo check`

## 文档索引（需要细节时按需读，别一次全读）
- 架构/使用：`docs/使用文档.md`（功能+实现，最全）
- 分层约束：`docs/ARCHITECTURE.md`、根 `AGENTS.md`
- 数据库：`docs/DATABASE_SCHEMA.md`
- 事件：`docs/EVENT_SYSTEM.md`
- 已知问题/在修：`docs/exec-plans/tech-debt-tracker.md`
- 过时/归档（设计稿、一次性 prompt）：`docs/archive/`，默认不读

## 约定
- 保持干净架构：`domain` 不 import 其它层；`application` 不 import infrastructure。
- 改动前先看是否已有该能力（复用），改完跑 `npm test`。
- 迁移文件加 `NNN_xxx.sql` 并注册进 `migrations/index.ts`，版本只增不改。

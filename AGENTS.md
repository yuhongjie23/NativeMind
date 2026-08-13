# AGENTS.md — AI Agent Guidelines for NativeMind

This file tells AI coding agents (Claude Code, Copilot, Cursor, etc.) how to work in this repo.

## Project Identity

NativeMind is a **local-first AI learning rhythm tool** — a Tauri v2 desktop app that helps users
structure learning, track focus sessions, connect knowledge, and review progress. The AI is an
assistant, not a chatbot; data stays on the user's machine by default.

## Architecture Rules (Non-Negotiable)

### Clean Architecture / Hexagonal
The codebase follows strict layer separation. Do NOT cross boundaries:

```
src/
├── domain/          # Pure TS — no IO, no React, no DB, no fetch
├── application/     # Use cases & ports — orchestration only, no infra
├── infrastructure/  # Implements ports — DB, file I/O, model runtime
├── ai/              # AI strategies — prompts, RAG, routing, schemas
├── ui/              # React components, stores, hooks, pages
└── types/           # Shared types consumed by all layers
```

**Rules:**
1. `domain/` must never import from any other layer. Pure business logic only.
2. `application/` defines ports (interfaces) — it never imports infrastructure directly.
3. `infrastructure/` and `ai/` implement ports defined in `application/`.
4. `ui/` routes **business writes** through `application/` use cases and stores. Utility infrastructure modules (e.g. `paths-api`, `audio-library`) may be imported directly by UI — they are read-only helpers, not business write paths. UI must never touch DB/SQL directly.
5. Dependency injection happens in `src/application/bootstrap.ts`.

### The Write-Confirmation Gate

**AI-suggested writes go through the confirmation system; user-initiated writes are the user's own confirmation and write directly.**

- `src/application/confirmation/action-proposal.ts` — defines what an action looks like
- `src/application/confirmation/confirmation-service.ts` — the gate
- UI components use `use-confirmation.ts` hook
- **AI-suggested mutations** (todos from a goal, knowledge links, review drafts, import results) are `ActionProposal`s that must be confirmed before writing.
- **User-initiated mutations** (typing a todo, completing a task, deleting a review) carry the user's explicit intent already and write directly — do not wrap them in a second confirmation.

### Two Runtime Modes

The same frontend code runs in two modes, switched by `src/ui/stores/runtime.ts`:

| Mode | Command | Storage | AI | Vector |
|------|---------|---------|----|--------|
| Web (dev) | `npm run dev` | In-memory (`local-demo.ts`) | Template placeholder | None |
| Desktop | `npm run desktop` | SQLite via Rust | Ollama (local) | sqlite-vec |

**When adding features:** always implement for both paths, or gate with `runtime.isDesktop`.

## Coding Conventions

### File Organization
- One concept per file. No mega-files.
- `index.ts` in each directory re-exports the public API.
- Barrel exports only — no implementation in index files.

### Naming
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components
- Types/interfaces: `PascalCase` (e.g., `FocusSession`, `TodoRepository`)
- Functions: `camelCase` (e.g., `startFocus`, `generateReview`)
- Events: `domain:action` format (e.g., `todo:created`, `focus:completed`)

### TypeScript
- Strict mode enabled. No `any` without an explicit `// eslint-disable-next-line` comment.
- Use `import type` for type-only imports.
- Prefer discriminated unions over optional fields for state variants.
- All ports are interfaces defined in `application/ports.ts`.

### Testing
- Unit tests: `tests/unit/` mirroring `src/` structure
- Integration tests: `tests/integration/` — use the in-memory driver by default
- No test should require a running Tauri or Ollama instance
- Run `npm test` before committing

### Rust (`src-tauri/`)
- `commands/` — Tauri IPC command handlers (thin wrappers, logic in `db/` / `model_client/` / `vector/`)
- `db/` — SQLite connection, migrations, repository queries
- `model_client/` — Ollama HTTP client
- `vector/` — sqlite-vec integration

## Commit Guidelines

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Keep commits focused — one logical change per commit
- Reference issue numbers when applicable

## Key Constraints

1. **Local-first:** No cloud dependency. External search is opt-in only.
2. **User consent:** All writes confirmed. AI suggestions are drafts until accepted.
3. **Quiet during focus:** AI stays silent during focus sessions unless explicitly called.
4. **Data as asset:** Structured data (notes, links, reviews) is the long-term asset; model output is draft.

## Token-Saving Collaboration Rules

1. **根 CLAUDE.md（~600 token，极简）** — 每次会话启动只自动加载它：项目一句话、入口/分层/写库铁律等关键事实、命令、文档索引。开局就有骨架，不花几千 token 探索已删的死代码或架构。
2. **docs/INDEX.md** — 全文档索引 + 「什么时候读」提示，标注过时文档（PROJECT_STRUCTURE.md）。
3. **归档设计稿** — COZY_HOME_* prompt + SEEDANCE2_AI_VIDEO_WORKFLOW_GUIDE + demo 截图移到 docs/archive/（~210KB，约 5 万 token 从默认视野拿掉）。一次性设计输入，不是实现文档。

协作省 token 规矩（照此执行）:
- 别整段贴审计报告/大文件 → 写进文件让用户读，只贴「新增/变化」几行。
- 一次改一个模块 → 按需读相关文件，不重读全仓。
- 修完写进 docs/exec-plans/tech-debt-tracker.md → 下次不用重新审计。
- 大文件读时自动分段，需要长文档时说「先读前 N 行」而不是整份吞。

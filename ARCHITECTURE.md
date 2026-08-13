# ARCHITECTURE.md — NativeMind Architecture

> Last updated: 2026-08-02 | Version: 0.1.0

## Overview

NativeMind follows **Clean Architecture (Hexagonal)** principles, with a React frontend
and a Rust/Tauri backend. The frontend is organized into concentric layers; the Rust
backend provides system-level capabilities (SQLite, file I/O, local AI).

```
┌────────────────────────────────────────────────────┐
│                    UI Layer (React)                 │
│  Pages → Components → Stores → Hooks              │
├────────────────────────────────────────────────────┤
│               Application Layer                     │
│  Use Cases · Confirmation Gate · Events · Policies │
├────────────────────────────────────────────────────┤
│    Domain Layer          │    AI Layer              │
│    Pure business logic   │    Prompts · RAG        │
│    Entities · Rules      │    Router · Schemas      │
├────────────────────────────────────────────────────┤
│              Infrastructure Layer                   │
│  Repositories · File Import · Model Runtime        │
│  Vector Store · Job Queue                          │
├────────────────────────────────────────────────────┤
│              Tauri Bridge (Rust)                    │
│  SQLite · Ollama Client · File Parser · sqlite-vec │
└────────────────────────────────────────────────────┘
```

## Layer Details

### Domain Layer (`src/domain/`)
Pure TypeScript. No framework, no IO, no side effects.

| Module | Entities | Key Rules |
|--------|----------|-----------|
| `todo/` | `Todo`, `Goal` | Title required, status transitions validated |
| `focus/` | `FocusSession` | Only one active session at a time |
| `note/` | `Note`, `NoteChunk` | Content hash for dedup, indexStatus lifecycle |
| `knowledge-link/` | `KnowledgeLink` | Bidirectional edge, archive not delete |
| `review/` | `ReviewLog` | Daily/weekly types, statistics + insights |
| `socratic/` | `SocraticSession`, `Exchange` | Turn-based dialogue |
| `companion/` | `CompanionProfile`, `Interaction` | State machine for pet behavior |

### Application Layer (`src/application/`)

**Use Cases** — the ONLY entry point for write operations:
- `todo/` — create, update, complete
- `focus/` — start, complete, abort
- `note/` — import, update, search
- `review/` — generate daily, generate weekly
- `knowledge-link/` — create, archive, query, suggest
- `companion/` — trigger interaction, handle response
- `socratic/` — start session, ask, complete, abandon

**Confirmation Gate** (`confirmation/`):
All mutations produce an `ActionProposal` → `ConfirmationService` validates → user confirms → executes.

**Events** (`events/`):
`EventBus` dispatches domain events (`todo:created`, `focus:completed`, etc.).
Subscribers react: audit logging, companion triggers, note indexing.

**Policies** (`policies/`):
- `focus-mode-policy.ts` — whether to interrupt user during focus
- `interaction-policy.ts` — when companion can initiate
- `privacy-policy.ts` — when external search is allowed

### Infrastructure Layer (`src/infrastructure/`)

| Module | Responsibility |
|--------|---------------|
| `db/` | SQLite migrations, repository implementations |
| `file-import/` | Parse PDF, Markdown, plain text, ebooks (EPUB/MOBI/AZW3) |
| `model-runtime/` | Ollama provider, llama.cpp provider, unified interface |
| `vector-store/` | Chroma provider, sqlite-vec provider |
| `rag/` | Note candidate provider for RAG retrieval |
| `job-queue/` | Background job processing (parse → chunk → embed) |

### AI Layer (`src/ai/`)

| Module | Responsibility |
|--------|---------------|
| `prompts/` | Versioned prompt templates (`.v1.md` files) |
| `schemas/` | JSON Schema for structured AI output (`.v1.json` files) |
| `rag/` | Chunk strategy, retrieval strategy, relation judgment |
| `router/` | Model routing by task complexity (tier config) |
| `search/` | Keyword generation, result filtering, search gate |
| `companion/` | Interaction generation for pet character |
| `evaluation/` | JSON validator, quality metrics |

### UI Layer (`src/ui/`)

```
ui/
├── pages/         # 8 pages: Today, Focus, Knowledge, Review,
│                  #   Socratic, Companion, Connections, Settings
├── components/
│   ├── features/  # Domain components: FocusTimer, TodoCard,
│   │              #   KnowledgeGraph, CompanionWidget, ConfirmationModal
│   ├── common/    # Shared: Button, Input, Modal
│   └── layout/    # AppShell, Sidebar
├── stores/        # Zustand stores (one per domain aggregate)
├── hooks/         # use-confirmation, use-event-listener, use-focus-mode
└── styles/        # Tailwind globals
```

## Tauri Backend (`src-tauri/`)

Rust backend providing native capabilities through IPC commands:

| Module | Responsibility |
|--------|---------------|
| `commands/` | IPC handlers (db, file, model, vector, audio) |
| `db/` | SQLite connection pool, schema migrations |
| `model_client/` | Ollama HTTP API client |
| `file_parser/` | PDF text extraction (pdf-extract), Markdown parsing, ebook extraction (lib-epub / mobi + html2text) |
| `vector/` | sqlite-vec extension integration |

## Data Flow

### Write Operation Flow
```
UI Component → Store action → Use Case → ConfirmationService
  → User confirms → Repository → SQLite (via Tauri IPC or in-memory)
  → EventBus.dispatch → Subscribers react
```

### Read Operation Flow
```
UI Component → Store (Zustand) → Repository → SQLite / In-Memory
```

### AI Operation Flow
```
Use Case → AI Port (application/ports.ts) → AI Adapter (ai/adapters.ts)
  → Router → Prompt + Schema → Model Runtime (Ollama / Template)
  → Response parsed → Structured output → Use Case continues
```

## Key Design Decisions

1. **Ports & Adapters**: All external dependencies are behind interfaces defined in `application/ports.ts`. This enables the dual-mode runtime (web memory driver vs desktop SQLite driver).

2. **Confirmation Gate**: Every write operation goes through a single confirmation pipeline. This enforces the principle that "AI suggests, user confirms."

3. **Template Fallback**: When Ollama is unavailable, the AI layer falls back to template/rule-based responses (`ai/adapters.ts`).

4. **sqlite-vec over Chroma**: The primary vector store is sqlite-vec (zero-dependency, runs in-process). Chroma is a fallback for richer queries.

5. **Prompt Versioning**: All AI prompts are versioned files (`prompts/*.v1.md`) with corresponding JSON schemas (`schemas/*.v1.json`). This makes prompt changes auditable.

6. **Archive, Don't Delete**: Knowledge links are archived (`archivedAt` timestamp) rather than physically deleted, preventing the AI from re-suggesting the same link.

## Dependency Graph

```
ui/ ──────────────► application/ ──► domain/
                        │
                        ▼
                   ai/ ──────────────► infrastructure/
                                              │
                                              ▼
                                        src-tauri/ (Rust)
```

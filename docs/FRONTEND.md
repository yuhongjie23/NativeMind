# FRONTEND.md — Frontend Architecture & Conventions

## Tech Stack
- **React 19** with functional components + hooks
- **TypeScript 5** (strict mode)
- **Vite 5** as bundler/dev server
- **Zustand 4** for state management
- **Tailwind CSS 3.4** for styling
- **Recharts** for review statistics
- **D3.js** (d3-force) for knowledge graph
- **CodeMirror 6** for note editor
- **Lottie Web** for companion animations

## Project Structure

```
src/
├── main.tsx                 # App entry point
├── types/                   # Shared TypeScript types
│   ├── common.ts            # UUID, ISO8601DateTime, etc.
│   ├── domain.ts            # Domain entity types
│   ├── api.ts               # IPC command types
│   ├── events.ts            # Event type definitions
│   └── config.ts            # Configuration types
├── domain/                  # Pure business logic (no React)
├── application/             # Use cases, events, policies
│   ├── ports.ts             # All interfaces (Repository, AI ports)
│   ├── bootstrap.ts         # DI container setup
│   ├── confirmation/        # Write-confirmation gate
│   ├── events/              # EventBus + subscribers
│   ├── policies/            # Focus/interaction/privacy rules
│   └── use-cases/           # One directory per aggregate
├── infrastructure/          # Port implementations
│   ├── db/                  # SQLite repos + migrations
│   ├── file-import/         # PDF/MD/TXT parsers
│   ├── model-runtime/       # Ollama/llama.cpp providers
│   ├── vector-store/        # Chroma/sqlite-vec providers
│   ├── rag/                 # Note candidate provider
│   └── job-queue/           # Background task queue
├── ai/                      # AI strategies
│   ├── prompts/             # Versioned prompt templates (.v1.md)
│   ├── schemas/             # JSON Schema for structured output
│   ├── rag/                 # Chunk/retrieval/relation strategies
│   ├── router/              # Model-router by task tier
│   ├── search/              # Keyword gen, result filter, search gate
│   └── evaluation/          # JSON validator, quality metrics
└── ui/                      # React UI layer
    ├── App.tsx              # Root component
    ├── pages/               # 8 page components
    ├── components/
    │   ├── features/        # Domain-specific components
    │   ├── common/          # Shared UI primitives
    │   └── layout/          # AppShell, Sidebar
    ├── stores/              # Zustand stores
    ├── hooks/               # Custom hooks
    └── styles/              # globals.css
```

## State Management (Zustand)

Each domain aggregate has its own store. Stores are the bridge between UI and use cases.

| Store | File | Manages |
|-------|------|---------|
| `useTodoStore` | `todo-store.ts` | Todo CRUD, daily list |
| `useFocusStore` | `focus-store.ts` | Timer state, active session |
| `useNoteStore` | `note-store.ts` | Notes list, search results |
| `useReviewStore` | `review-store.ts` | Daily/weekly reviews |
| `useKnowledgeLinkStore` | `knowledge-link-store.ts` | Graph data, link suggestions |
| `useSocraticStore` | `socratic-store.ts` | Active dialogue session |
| `useCompanionStore` | `companion-store.ts` | Pet state, interaction queue |
| `useSettingsStore` | `settings-store.ts` | User preferences |
| `useConfirmationStore` | `confirmation-store.ts` | Pending action proposals |
| `useRuntimeStore` | `runtime.ts` | Platform detection, AI mode |

**Store conventions:**
- Each store imports use cases from `application/`, never repositories directly.
- Async actions use `async/await` with loading/error states.
- Optimistic updates are allowed for simple operations; complex ones wait for confirmation.

## Component Patterns

### Feature Components (`ui/components/features/`)
- Domain-aware, may import stores and use cases
- Examples: `FocusTimer`, `TodoCard`, `KnowledgeGraph`, `CompanionWidget`, `ConfirmationModal`

### Common Components (`ui/components/common/`)
- Presentational only, no domain knowledge
- Examples: `Button`, `Input`, `Modal`

### Layout Components (`ui/components/layout/`)
- `AppShell` — main layout wrapper, routes to pages
- `Sidebar` — navigation with icon buttons

## Pages

| Page | Route | Description |
|------|-------|-------------|
| `TodayPage` | `/` | Today's todos, focus timer, companion widget |
| `FocusPage` | `/focus` | Full-screen focus mode |
| `KnowledgePage` | `/knowledge` | Notes list + search + import |
| `ReviewPage` | `/review` | Daily/weekly review viewer |
| `SocraticPage` | `/socratic` | Socratic dialogue interface |
| `CompanionPage` | `/companion` | Companion pet full view |
| `ConnectionsPage` | `/connections` | Knowledge graph visualization |
| `SettingsPage` | `/settings` | User preferences, model config |

## Hooks

| Hook | Purpose |
|------|---------|
| `use-confirmation` | Wrap async writes with confirmation flow |
| `use-event-listener` | Subscribe to domain events in components |
| `use-focus-mode` | Query and control focus mode state |

## Dual Runtime

The app runs in two modes, detected by `src/ui/stores/runtime.ts`:

```typescript
const isDesktop = '__TAURI_INTERNALS__' in window;
```

| Capability | Web (`npm run dev`) | Desktop (`npm run desktop`) |
|------------|---------------------|----------------------------|
| Storage | In-memory (`local-demo.ts`) | SQLite via Tauri IPC |
| AI | Template/rule-based | Ollama (local LLM) |
| Vector search | None | sqlite-vec |
| File import | Browser File API | Rust file parser |
| Persistence | Lost on refresh | `nativemind.db` on disk |

**Rule**: Always check `runtime.isDesktop` before calling Tauri-specific APIs.
Use the ports system — the correct implementation is injected at bootstrap.

## Import Conventions

```typescript
// ✅ Correct
import type { Todo } from '@shared-types/common';
import { useTodoStore } from '@stores/todo-store';

// ❌ Wrong — never import infrastructure directly from UI
import { TodoRepository } from '../../infrastructure/db/repositories/todo-repository';
```

# RELIABILITY.md — Reliability & Error Handling

## Architecture for Reliability

NativeMind follows these reliability patterns:

### 1. Confirmation Gate (Write Safety)
All write operations go through `ConfirmationService`:
- No blind writes — user always sees what will change
- Atomicity: each confirmed action is a single repository call
- Audit trail: every confirmed write is logged

### 2. Dual Runtime Isolation
The web mode (`npm run dev`) and desktop mode are kept separate:
- Web mode crashes don't affect desktop data
- In-memory driver is a full implementation of the same ports
- Runtime detection at bootstrap, not sprinkled through code

### 3. Graceful Degradation

| Capability | Primary | Fallback | Fallback 2 |
|------------|---------|----------|------------|
| AI | Ollama (local LLM) | Template/rule-based | N/A |
| Vector search | sqlite-vec | Keyword search | N/A |
| PDF parsing | Rust `pdf-extract` | Error message | N/A |
| Storage | SQLite | Error (panics if no data dir) | N/A |

### 4. Structured AI Output
All AI responses use JSON Schema validation (`src/ai/schemas/`):
- `json-validator.ts` validates before data enters the system
- `quality-metrics.ts` scores output quality
- Invalid AI output is discarded, not silently accepted

### 5. State Machine Validation
Domain entities enforce valid state transitions:
- `FocusSession`: active → completed | aborted (not both)
- `Todo`: pending → in_progress → completed | cancelled
- `KnowledgeLink`: created → archived → restored (not deleted)

## Error Handling Strategy

### Layer Responsibilities

| Layer | Error Handling |
|-------|---------------|
| UI | Catch, display toast/error state, offer retry |
| Application | Wrap use case execution, emit error events |
| Infrastructure | Throw typed errors, never swallow silently |
| Domain | Validate inputs, throw on invalid state transitions |
| AI | Validate JSON output, discard invalid, log quality |

### Error Types
- `DomainError` — business rule violation (e.g., "Todo title required")
- `InfrastructureError` — DB/file/network failure
- `AIError` — model unavailable, invalid output, timeout
- `ValidationError` — JSON schema mismatch

### User-Facing Errors
- Toast notifications for transient errors
- Inline error states for form validation
- Empty states (not errors) for "no data yet"
- Graceful fallback UI when backend is unavailable

## Data Backup & Recovery

### Current State (v0.1.0)
- Single SQLite file — user can back up manually
- No automatic backup yet
- No migration rollback (forward-only migrations)

### Planned
- Automatic periodic backup of `nativemind.db`
- Export all data as portable format (Markdown + JSON)
- Migration dry-run before applying

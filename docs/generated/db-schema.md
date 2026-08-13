# Database Schema

> Auto-generated from migration files. Last updated: 2026-08-02.
> 
> See `docs/DATABASE_SCHEMA.md` for the complete DDL and data lifecycle documentation.

## Tables (13 + auxiliary)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `todos` | Task management | id, title, status, priority, estimated_minutes, scheduled_date |
| `focus_sessions` | Pomodoro timer records | id, todo_id, duration_minutes, started_at, status |
| `notes` | Imported/created notes | id, title, content, content_hash, source_type, index_status |
| `note_chunks` | Segments for vector embedding | id, note_id, chunk_index, content, embedding_status |
| `knowledge_links` | AI-suggested connections | id, from_type/id, to_type/id, relation_type, confidence, archived_at |
| `review_logs` | Daily/weekly reflections | id, review_type, date, content, summary, insights |
| `socratic_sessions` | Socratic dialogue sessions | id, topic, status |
| `socratic_exchanges` | Q&A turns in a session | id, session_id, turn_number, question, user_response |
| `companion_interactions` | Pet character interactions | id, companion_id, scene_type, interaction_type, content |
| `action_proposals` | Pending write confirmations | id, action_type, payload, status |
| `settings` | User preferences | key, value |
| `model_runs` | AI call audit log | id, model, prompt_hash, tokens, duration_ms |
| `background_jobs` | Async task queue | id, job_type, entity_id, status |

## Vector Table
| Table | Purpose |
|-------|---------|
| `note_chunks_fts` | sqlite-vec virtual table for embedding search |

## Key Relations
- `focus_sessions.todo_id` → `todos.id`
- `note_chunks.note_id` → `notes.id`
- `socratic_exchanges.session_id` → `socratic_sessions.id`
- `knowledge_links` uses polymorphic from/to (entity type + id)
- `todos.linked_note_ids` stores an array of note UUIDs

## Migrations
1. `001_init.sql` — Core tables (todos, focus, notes, knowledge_links, review_logs, settings)
2. `002_add_socratic.sql` — Socratic session and exchange tables
3. `003_add_companion.sql` — Companion interaction table
4. `004_add_knowledge_link_lifecycle.sql` — archived_at, restore support for knowledge links

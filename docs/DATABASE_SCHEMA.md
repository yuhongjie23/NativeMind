# 数据库 Schema 设计

## SQLite 表结构

### 1. todos - Todo 任务表

```sql
CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    source_goal_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT CHECK(priority IN ('low', 'medium', 'high')),
    estimated_minutes INTEGER,
    scheduled_date TEXT,
    tags TEXT, -- JSON array
    linked_note_ids TEXT, -- JSON array
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_scheduled_date ON todos(scheduled_date);
```

### 2. focus_sessions - 专注记录表

```sql
CREATE TABLE focus_sessions (
    id TEXT PRIMARY KEY,
    todo_id TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 25,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    aborted_at TEXT,
    abort_reason TEXT,
    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'aborted')),
    notes TEXT,
    FOREIGN KEY (todo_id) REFERENCES todos(id)
);

CREATE INDEX idx_focus_sessions_started_at ON focus_sessions(started_at);
CREATE INDEX idx_focus_sessions_status ON focus_sessions(status);
```

### 3. notes - 笔记表

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL, -- SHA256 for change detection
    source_type TEXT CHECK(source_type IN ('manual', 'imported_pdf', 'imported_markdown', 'imported_text')),
    source_uri TEXT,
    index_status TEXT CHECK(index_status IN ('pending', 'parsing', 'chunking', 'indexing', 'indexed', 'failed', 'stale')),
    embedding_version TEXT,
    chunk_count INTEGER DEFAULT 0,
    indexed_at TEXT,
    index_error TEXT,
    tags TEXT, -- JSON array
    metadata TEXT, -- JSON object (author, date, etc.)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_notes_index_status ON notes(index_status);
CREATE INDEX idx_notes_updated_at ON notes(updated_at);
```

### 4. note_chunks - 笔记切片表

```sql
CREATE TABLE note_chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    text TEXT NOT NULL,
    heading_path TEXT, -- JSON array like ["Chapter 1", "Section 1.1"]
    page INTEGER,
    char_start INTEGER,
    char_end INTEGER,
    tags TEXT, -- JSON array
    created_at TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);
```

### 5. knowledge_links - 知识关系链接表

```sql
CREATE TABLE knowledge_links (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL CHECK(from_type IN ('note', 'chunk', 'concept', 'todo', 'review_item')),
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL CHECK(to_type IN ('note', 'chunk', 'concept', 'todo', 'review_item')),
    to_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('same_concept', 'prerequisite', 'example_of', 'contrast', 'extends', 'review_later')),
    reason TEXT,
    confidence REAL CHECK(confidence >= 0 AND confidence <= 1),
    created_by TEXT CHECK(created_by IN ('ai_suggestion', 'user_manual', 'rule_based')),
    confirmed_by_user INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_knowledge_links_from ON knowledge_links(from_type, from_id);
CREATE INDEX idx_knowledge_links_to ON knowledge_links(to_type, to_id);
CREATE INDEX idx_knowledge_links_relation_type ON knowledge_links(relation_type);
```

### 6. review_logs - 复盘日志表

```sql
CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly')),
    date TEXT NOT NULL, -- YYYY-MM-DD
    content TEXT NOT NULL, -- Markdown format
    summary TEXT,
    statistics TEXT, -- JSON object (focus_time, tasks_completed, etc.)
    insights TEXT, -- JSON array of key insights
    next_todos TEXT, -- JSON array of suggested next steps
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_review_logs_date ON review_logs(date);
CREATE INDEX idx_review_logs_review_type ON review_logs(review_type);
```

### 7. socratic_sessions - 苏格拉底提问会话表

```sql
CREATE TABLE socratic_sessions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    related_note_ids TEXT, -- JSON array
    status TEXT CHECK(status IN ('active', 'completed', 'abandoned')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE socratic_exchanges (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    question TEXT NOT NULL,
    user_response TEXT,
    ai_feedback TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES socratic_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_socratic_exchanges_session_id ON socratic_exchanges(session_id);
```

### 8. companion_interactions - 陪伴角色互动记录表

```sql
CREATE TABLE companion_interactions (
    id TEXT PRIMARY KEY,
    companion_id TEXT NOT NULL,
    scene_type TEXT NOT NULL CHECK(scene_type IN ('enter', 'exit', 'focus_start', 'focus_complete', 'focus_abort', 'idle', 'encourage', 'question')),
    trigger_event TEXT, -- 触发的领域事件类型
    interaction_type TEXT CHECK(interaction_type IN ('animation', 'dialogue', 'question')),
    content TEXT, -- 对话内容或问题
    user_response TEXT, -- 用户的回答（如果有）
    animation_name TEXT,
    requires_response INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_companion_interactions_created_at ON companion_interactions(created_at);
CREATE INDEX idx_companion_interactions_scene_type ON companion_interactions(scene_type);
```

### 9. action_proposals - 待确认动作表

```sql
CREATE TABLE action_proposals (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL CHECK(action_type IN ('create_todos', 'create_knowledge_link', 'generate_review', 'import_search_result')),
    summary TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON object
    source TEXT CHECK(source IN ('ai', 'rule_based')),
    status TEXT CHECK(status IN ('pending', 'confirmed', 'rejected', 'expired')),
    requires_confirmation INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    decided_at TEXT
);

CREATE INDEX idx_action_proposals_status ON action_proposals(status);
CREATE INDEX idx_action_proposals_created_at ON action_proposals(created_at);
```

### 10. model_runs - 模型调用日志表

```sql
CREATE TABLE model_runs (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    model_tier TEXT CHECK(model_tier IN ('fast', 'coach', 'deep')),
    model_name TEXT,
    prompt_version TEXT,
    schema_id TEXT,
    input_hash TEXT,
    output TEXT,
    validation_result TEXT CHECK(validation_result IN ('success', 'schema_failed', 'business_failed')),
    error_message TEXT,
    user_correction TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_model_runs_task_type ON model_runs(task_type);
CREATE INDEX idx_model_runs_created_at ON model_runs(created_at);
```

### 11. search_sessions - 外部搜索会话表

```sql
CREATE TABLE search_sessions (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    keywords TEXT, -- JSON array of generated keywords
    result_count INTEGER DEFAULT 0,
    user_confirmed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE search_results (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    snippet TEXT,
    source TEXT,
    published_date TEXT,
    relevance_score REAL,
    saved INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES search_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_search_results_session_id ON search_results(session_id);
CREATE INDEX idx_search_results_saved ON search_results(saved);
```

### 12. settings - 用户设置表

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### 13. background_jobs - 后台任务表

```sql
CREATE TABLE background_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL CHECK(job_type IN ('parse_note', 'chunk_note', 'embed_chunks', 'reindex_note', 'rebuild_index')),
    entity_type TEXT,
    entity_id TEXT,
    status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    payload TEXT, -- JSON object with job parameters
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX idx_background_jobs_status ON background_jobs(status);
CREATE INDEX idx_background_jobs_job_type ON background_jobs(job_type);
```

---

## 向量数据存储

### 使用 SQLite 扩展（sqlite-vec）

```sql
-- 创建向量表
CREATE VIRTUAL TABLE note_chunk_embeddings USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[384] -- 假设使用 384 维的 embedding
);

-- 插入向量
INSERT INTO note_chunk_embeddings(chunk_id, embedding) 
VALUES ('chunk_001', vec_f32(?));

-- 相似度搜索
SELECT 
    chunk_id,
    distance
FROM note_chunk_embeddings
WHERE embedding MATCH vec_f32(?)
ORDER BY distance
LIMIT 10;
```

---

## 数据关系图

```
todos ──┐
        ├──< focus_sessions
        │
        └──< knowledge_links (as from/to)

notes ──┐
        ├──< note_chunks ──< note_chunk_embeddings
        │
        ├──< knowledge_links (as from/to)
        │
        └──< socratic_sessions (related)

socratic_sessions ──< socratic_exchanges

search_sessions ──< search_results

companion_interactions (独立)

action_proposals (独立)

model_runs (独立，审计用)

background_jobs (独立，任务队列)
```

---

## 数据生命周期

### 写入分类（对应架构 §12.1）

| 类型 | 示例 | 写入方式 |
|------|------|----------|
| 用户直接操作 | 勾选 Todo、开始计时、手动编辑笔记 | 直接写库，可撤销 |
| AI 建议型 | Todo 草稿、知识链接建议、复盘草稿 | 先写 `action_proposals`，确认后写目标表 |
| 系统运行型 | 计时器状态、审计日志、模型调用记录 | 自动写库，不需确认 |

### 数据清理策略

| 表 | 清理策略 |
|---|---------|
| `model_runs` | 保留最近 30 天，可在设置中关闭或清理 |
| `companion_interactions` | 保留最近 90 天 |
| `action_proposals` (rejected/expired) | 保留最近 7 天 |
| `background_jobs` (completed) | 保留最近 7 天 |
| `search_sessions` (未保存结果) | 保留最近 24 小时 |

---

## 迁移脚本示例

`infrastructure/db/migrations/001_init.sql`:

```sql
-- 初始化核心表
-- 详细 SQL 见上文各表定义
```

`infrastructure/db/migrations/002_add_socratic.sql`:

```sql
-- 添加苏格拉底提问相关表
CREATE TABLE socratic_sessions (...);
CREATE TABLE socratic_exchanges (...);
```

`infrastructure/db/migrations/003_add_companion_interactions.sql`:

```sql
-- 添加宠物互动记录表
CREATE TABLE companion_interactions (...);
```

---

## 下一步

1. 实现 `infrastructure/db/database.ts` 连接和迁移逻辑
2. 实现各 Repository 层的数据访问接口
3. 确保所有写入遵守三分类规则
4. 配置自动备份机制

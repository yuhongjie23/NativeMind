-- 001 初始化核心表
-- 语句之间用 -- @@split 分隔，由 splitStatements 切开逐条执行
-- 约定：时间戳统一 ISO8601 TEXT，数组/对象存 JSON TEXT，布尔存 0/1

CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    source_goal_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT CHECK(priority IN ('low', 'medium', 'high')),
    estimated_minutes INTEGER,
    scheduled_date TEXT,
    tags TEXT,
    linked_note_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
)
-- @@split
CREATE INDEX idx_todos_status ON todos(status)
-- @@split
CREATE INDEX idx_todos_scheduled_date ON todos(scheduled_date)
-- @@split
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
)
-- @@split
CREATE INDEX idx_focus_sessions_started_at ON focus_sessions(started_at)
-- @@split
CREATE INDEX idx_focus_sessions_status ON focus_sessions(status)
-- @@split
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_type TEXT CHECK(source_type IN ('manual', 'imported_pdf', 'imported_markdown', 'imported_text')),
    source_uri TEXT,
    index_status TEXT CHECK(index_status IN ('pending', 'parsing', 'chunking', 'indexing', 'indexed', 'failed', 'stale')),
    embedding_version TEXT,
    chunk_count INTEGER DEFAULT 0,
    indexed_at TEXT,
    index_error TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
-- @@split
CREATE INDEX idx_notes_index_status ON notes(index_status)
-- @@split
CREATE INDEX idx_notes_updated_at ON notes(updated_at)
-- @@split
CREATE INDEX idx_notes_content_hash ON notes(content_hash)
-- @@split
CREATE TABLE note_chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    text TEXT NOT NULL,
    heading_path TEXT,
    page INTEGER,
    char_start INTEGER,
    char_end INTEGER,
    tags TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
)
-- @@split
CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id)
-- @@split
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
)
-- @@split
CREATE INDEX idx_knowledge_links_from ON knowledge_links(from_type, from_id)
-- @@split
CREATE INDEX idx_knowledge_links_to ON knowledge_links(to_type, to_id)
-- @@split
CREATE INDEX idx_knowledge_links_relation_type ON knowledge_links(relation_type)
-- @@split
CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly')),
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    statistics TEXT,
    insights TEXT,
    next_todos TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
-- @@split
CREATE INDEX idx_review_logs_date ON review_logs(date)
-- @@split
CREATE INDEX idx_review_logs_review_type ON review_logs(review_type)
-- @@split
-- 同一天同一类型只应有一份复盘，靠唯一索引兜住重复生成
CREATE UNIQUE INDEX idx_review_logs_type_date ON review_logs(review_type, date)
-- @@split
CREATE TABLE action_proposals (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL CHECK(action_type IN ('create_todos', 'create_knowledge_link', 'generate_review', 'import_search_result')),
    summary TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT CHECK(source IN ('ai', 'rule_based')),
    status TEXT CHECK(status IN ('pending', 'confirmed', 'rejected', 'expired')),
    requires_confirmation INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    decided_at TEXT
)
-- @@split
CREATE INDEX idx_action_proposals_status ON action_proposals(status)
-- @@split
CREATE INDEX idx_action_proposals_created_at ON action_proposals(created_at)
-- @@split
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
)
-- @@split
CREATE INDEX idx_model_runs_task_type ON model_runs(task_type)
-- @@split
CREATE INDEX idx_model_runs_created_at ON model_runs(created_at)
-- @@split
CREATE TABLE search_sessions (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    keywords TEXT,
    result_count INTEGER DEFAULT 0,
    user_confirmed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
)
-- @@split
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
)
-- @@split
CREATE INDEX idx_search_results_session_id ON search_results(session_id)
-- @@split
CREATE INDEX idx_search_results_saved ON search_results(saved)
-- @@split
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
-- @@split
CREATE TABLE background_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL CHECK(job_type IN ('parse_note', 'chunk_note', 'embed_chunks', 'reindex_note', 'rebuild_index')),
    entity_type TEXT,
    entity_id TEXT,
    status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    payload TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
)
-- @@split
CREATE INDEX idx_background_jobs_status ON background_jobs(status)
-- @@split
CREATE INDEX idx_background_jobs_job_type ON background_jobs(job_type)
-- @@split
-- 审计日志：领域事件的落地记录，系统运行型写入，不需用户确认
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
)
-- @@split
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at)

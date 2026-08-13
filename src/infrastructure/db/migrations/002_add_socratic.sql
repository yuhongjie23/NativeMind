-- 002 苏格拉底提问会话
-- 拆成独立迁移是因为这块功能在 001 之后才定稿，已装应用的用户靠这个补表

CREATE TABLE socratic_sessions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    related_note_ids TEXT,
    status TEXT CHECK(status IN ('active', 'completed', 'abandoned')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
)
-- @@split
CREATE TABLE socratic_exchanges (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    question TEXT NOT NULL,
    user_response TEXT,
    ai_feedback TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES socratic_sessions(id) ON DELETE CASCADE
)
-- @@split
CREATE INDEX idx_socratic_exchanges_session_id ON socratic_exchanges(session_id)
-- @@split
-- 同一会话内轮次唯一，避免并发追问写出两个 turn 3
CREATE UNIQUE INDEX idx_socratic_exchanges_turn ON socratic_exchanges(session_id, turn_number)

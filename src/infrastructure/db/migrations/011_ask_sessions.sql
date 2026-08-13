-- 011 深度问答历史
-- Self-RAG 深度问答结果持久化：可回看、可删除。问答是用户主动发起的沉淀，
-- 保存由 SaveAskSessionUseCase 负责（只追加），不涉及确认门（非 AI 建议型写入）。

CREATE TABLE ask_sessions (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',   -- JSON 数组：[{chunkId,noteId,text,score,headingPath?}]
    confidence REAL NOT NULL DEFAULT 0,
    judged INTEGER NOT NULL DEFAULT 0,       -- 0/1
    regenerated INTEGER NOT NULL DEFAULT 0,  -- 0/1
    ok INTEGER NOT NULL DEFAULT 1,           -- 0/1：模型是否成功生成
    empty INTEGER NOT NULL DEFAULT 0,        -- 0/1：无相关笔记
    critique TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
-- @@split
CREATE INDEX idx_ask_sessions_created_at ON ask_sessions(created_at DESC)

-- 008_relax_action_type_check.sql
-- action_type 白名单补齐 delete_review / delete_note：
-- 删除复盘等确认型写入会在真实 SQLite 上撞 CHECK 约束而失败。
-- SQLite 不能 ALTER CHECK，只能重建表。action_proposals 无外键引用，可安全重建。
-- 注意：迁移在事务内执行，PRAGMA foreign_keys 在这里是空操作，所以不再写它。
-- @@split
ALTER TABLE action_proposals RENAME TO action_proposals_old
-- @@split
CREATE TABLE action_proposals (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL CHECK(action_type IN ('create_todos', 'create_knowledge_link', 'generate_review', 'import_search_result', 'delete_review', 'delete_note')),
    summary TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT CHECK(source IN ('ai', 'rule_based')),
    status TEXT CHECK(status IN ('pending', 'confirmed', 'rejected', 'expired')),
    requires_confirmation INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    decided_at TEXT
)
-- @@split
INSERT INTO action_proposals (id, action_type, summary, payload, source, status, requires_confirmation, created_at, decided_at)
  SELECT id, action_type, summary, payload, source, status, requires_confirmation, created_at, decided_at FROM action_proposals_old
-- @@split
DROP TABLE action_proposals_old
-- @@split
CREATE INDEX idx_action_proposals_status ON action_proposals(status)
-- @@split
CREATE INDEX idx_action_proposals_created_at ON action_proposals(created_at)

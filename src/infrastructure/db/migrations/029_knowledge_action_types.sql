-- Preserve existing proposals while allowing the two confirmed knowledge writes.
-- SQLite CHECK constraints require a table rebuild; Database.migrate wraps it in a transaction.
ALTER TABLE action_proposals RENAME TO action_proposals_before_knowledge
-- @@split
CREATE TABLE action_proposals (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL CHECK(action_type IN ('create_todos', 'create_knowledge_link', 'generate_review', 'import_search_result', 'delete_review', 'delete_note', 'create_note_cards', 'create_topic_page')),
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
SELECT id, action_type, summary, payload, source, status, requires_confirmation, created_at, decided_at
FROM action_proposals_before_knowledge
-- @@split
DROP TABLE action_proposals_before_knowledge
-- @@split
CREATE INDEX idx_action_proposals_status ON action_proposals(status)
-- @@split
CREATE INDEX idx_action_proposals_created_at ON action_proposals(created_at)

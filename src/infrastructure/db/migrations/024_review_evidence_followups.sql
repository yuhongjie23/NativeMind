ALTER TABLE review_logs ADD COLUMN evidence TEXT;
-- @@split
CREATE TABLE review_follow_ups (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES review_logs(id) ON DELETE CASCADE,
  suggestion TEXT NOT NULL,
  todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL,
  adopted_at TEXT NOT NULL,
  UNIQUE(review_id, suggestion)
);

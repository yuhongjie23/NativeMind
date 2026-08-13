-- 007 复盘支持月度
-- review_type 的 CHECK 原只允许 daily/weekly，加 monthly。
-- SQLite 改不了 CHECK，走事务内重建（迁移本身在事务里，安全）。
-- @@split
ALTER TABLE review_logs RENAME TO review_logs_old
-- @@split
CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly', 'monthly')),
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
INSERT INTO review_logs (id, review_type, date, content, summary, statistics, insights, next_todos, created_at, updated_at)
  SELECT id, review_type, date, content, summary, statistics, insights, next_todos, created_at, updated_at
  FROM review_logs_old
-- @@split
DROP TABLE review_logs_old
-- @@split
CREATE INDEX idx_review_logs_date ON review_logs(date)
-- @@split
CREATE INDEX idx_review_logs_review_type ON review_logs(review_type)
-- @@split
CREATE UNIQUE INDEX idx_review_logs_type_date ON review_logs(review_type, date)

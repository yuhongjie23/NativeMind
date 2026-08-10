-- 009_add_focus_fk_on_delete.sql
-- focus_sessions.todo_id 原外键无 ON DELETE：删除被专注过的 Todo 会撞外键错误，
-- 删除永远失败。重建该表，外键改为 ON DELETE SET NULL —— 保留专注历史、允许删任务。
--
-- 说明：迁移在事务内执行，PRAGMA foreign_keys 在这里是空操作（SQLite 约束）；
-- 但重建时 INSERT SELECT 的现有 todo_id 都指向存在的任务（或为 NULL），
-- 外键校验天然通过，不需要关闭外键。
-- @@split
CREATE TABLE focus_sessions_new (
    id TEXT PRIMARY KEY,
    todo_id TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 25,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    aborted_at TEXT,
    abort_reason TEXT,
    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'aborted')),
    notes TEXT,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE SET NULL
)
-- @@split
INSERT INTO focus_sessions_new (id, todo_id, duration_minutes, started_at, completed_at, aborted_at, abort_reason, status, notes)
  SELECT id, todo_id, duration_minutes, started_at, completed_at, aborted_at, abort_reason, status, notes FROM focus_sessions
-- @@split
DROP TABLE focus_sessions
-- @@split
ALTER TABLE focus_sessions_new RENAME TO focus_sessions
-- @@split
CREATE INDEX idx_focus_sessions_started_at ON focus_sessions(started_at)
-- @@split
CREATE INDEX idx_focus_sessions_status ON focus_sessions(status)

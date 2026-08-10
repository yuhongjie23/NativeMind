-- 005 陪伴互动 scene_type 放宽
-- TS 侧实际会写入 user_invoked / feedback / repeatedly_aborted / review_generated / user_initiated，
-- 原 CHECK 缺这些值，用户点宠物或回复宠物时报 CHECK constraint failed。
-- SQLite 改不了 CHECK，走「改名→重建→拷数据→删旧」的事务内重建（迁移本身在事务里，安全）。
-- @@split
ALTER TABLE companion_interactions RENAME TO companion_interactions_old
-- @@split
CREATE TABLE companion_interactions (
    id TEXT PRIMARY KEY,
    companion_id TEXT NOT NULL,
    scene_type TEXT NOT NULL CHECK(scene_type IN ('enter', 'exit', 'focus_start', 'focus_complete', 'focus_abort', 'idle', 'encourage', 'question', 'user_invoked', 'user_initiated', 'feedback', 'repeatedly_aborted', 'review_generated', 'todo_completed', 'idle_checkin', 'stuck_encourage', 'milestone_celebrate')),
    trigger_event TEXT,
    interaction_type TEXT CHECK(interaction_type IN ('animation', 'dialogue', 'question')),
    content TEXT,
    user_response TEXT,
    animation_name TEXT,
    requires_response INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
)
-- @@split
INSERT INTO companion_interactions (id, companion_id, scene_type, trigger_event, interaction_type, content, user_response, animation_name, requires_response, created_at)
  SELECT id, companion_id, scene_type, trigger_event, interaction_type, content, user_response, animation_name, requires_response, created_at
  FROM companion_interactions_old
-- @@split
DROP TABLE companion_interactions_old
-- @@split
CREATE INDEX idx_companion_interactions_created_at ON companion_interactions(created_at)
-- @@split
CREATE INDEX idx_companion_interactions_scene_type ON companion_interactions(scene_type)
-- @@split
CREATE INDEX idx_companion_interactions_type_created ON companion_interactions(interaction_type, created_at)

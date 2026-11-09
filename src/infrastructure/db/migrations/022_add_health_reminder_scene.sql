-- 022 允许既有主动陪伴逻辑写入 health_reminder。
-- 在迁移事务内重建 CHECK，完整保留历史会话、回复、角色及生命周期字段。
CREATE TABLE companion_interactions_v22 (
    id TEXT PRIMARY KEY,
    companion_id TEXT NOT NULL,
    scene_type TEXT NOT NULL CHECK(scene_type IN ('enter', 'exit', 'focus_start', 'focus_complete', 'focus_abort', 'idle', 'encourage', 'question', 'user_invoked', 'user_initiated', 'feedback', 'repeatedly_aborted', 'review_generated', 'todo_completed', 'idle_checkin', 'stuck_encourage', 'milestone_celebrate', 'health_reminder')),
    trigger_event TEXT,
    interaction_type TEXT CHECK(interaction_type IN ('animation', 'dialogue', 'question')),
    content TEXT,
    user_response TEXT,
    animation_name TEXT,
    requires_response INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    conversation_id TEXT,
    reply_to_id TEXT,
    turn_index INTEGER,
    initiator TEXT,
    status TEXT,
    role TEXT NOT NULL DEFAULT 'pet'
)
-- @@split
INSERT INTO companion_interactions_v22 (
    id, companion_id, scene_type, trigger_event, interaction_type, content,
    user_response, animation_name, requires_response, created_at,
    conversation_id, reply_to_id, turn_index, initiator, status, role
)
SELECT id, companion_id, scene_type, trigger_event, interaction_type, content,
    user_response, animation_name, requires_response, created_at,
    conversation_id, reply_to_id, turn_index, initiator, status, role
FROM companion_interactions
-- @@split
DROP TABLE companion_interactions
-- @@split
ALTER TABLE companion_interactions_v22 RENAME TO companion_interactions
-- @@split
CREATE INDEX idx_companion_interactions_created_at ON companion_interactions(created_at)
-- @@split
CREATE INDEX idx_companion_interactions_scene_type ON companion_interactions(scene_type)
-- @@split
CREATE INDEX idx_companion_interactions_type_created ON companion_interactions(interaction_type, created_at)

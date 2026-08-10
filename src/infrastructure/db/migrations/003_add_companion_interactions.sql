-- 003 陪伴角色互动记录
-- scene_type 与 InteractionPolicy 的场景枚举对齐，改这里要同步 application/policies

CREATE TABLE companion_interactions (
    id TEXT PRIMARY KEY,
    companion_id TEXT NOT NULL,
    scene_type TEXT NOT NULL CHECK(scene_type IN ('enter', 'exit', 'focus_start', 'focus_complete', 'focus_abort', 'idle', 'encourage', 'question')),
    trigger_event TEXT,
    interaction_type TEXT CHECK(interaction_type IN ('animation', 'dialogue', 'question')),
    content TEXT,
    user_response TEXT,
    animation_name TEXT,
    requires_response INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
)
-- @@split
CREATE INDEX idx_companion_interactions_created_at ON companion_interactions(created_at)
-- @@split
CREATE INDEX idx_companion_interactions_scene_type ON companion_interactions(scene_type)
-- @@split
-- 提问频控要按类型+时间数数，单独建索引省一次全表扫
CREATE INDEX idx_companion_interactions_type_created ON companion_interactions(interaction_type, created_at)

-- 019 陪伴互动会话关联
-- 提问与反馈共享 conversation_id（一段对话），feedback 用 reply_to_id 指向被回答的提问。
-- 历史可配对（P1-7）；ALTER ADD COLUMN 不影响既有行（可空）。

ALTER TABLE companion_interactions ADD COLUMN conversation_id TEXT
-- @@split
ALTER TABLE companion_interactions ADD COLUMN reply_to_id TEXT

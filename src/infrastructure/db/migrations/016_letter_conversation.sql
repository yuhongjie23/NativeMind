-- 016 对话会话：letters 增加 conversation_id，把多段对话归成会话（可重进 / 删除）。
-- 老数据为 NULL，仍按旧逻辑展示。

ALTER TABLE letters ADD COLUMN conversation_id TEXT
-- @@split
CREATE INDEX idx_letters_conversation ON letters(conversation_id)

-- 020 陪伴互动会话元数据
-- turn_index：会话内轮次序号（桌宠对话限制 2-3 轮用）
-- initiator：谁发起的（user / event / proactive）
-- status：生命周期（visible / answered / dismissed / expired）
-- 全部可空（既有行无值）；ALTER ADD COLUMN 不影响旧数据。

ALTER TABLE companion_interactions ADD COLUMN turn_index INTEGER
-- @@split
ALTER TABLE companion_interactions ADD COLUMN initiator TEXT
-- @@split
ALTER TABLE companion_interactions ADD COLUMN status TEXT

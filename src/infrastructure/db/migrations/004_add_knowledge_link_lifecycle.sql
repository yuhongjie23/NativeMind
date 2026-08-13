-- 004 知识链接的生命周期字段
--
-- 背景：knowledge_links 在 001 里就建好了，但只有 created_at。
-- 领域实体 KnowledgeLink 继承 Entity（含 updatedAt），确认关系、改理由都要更新时间戳，
-- 缺这一列会让「用户确认」无法持久化时间；软删除同理。
--
-- 只加列，不重建表 —— 已装应用的用户库里有数据，重建有丢数据风险。
-- SQLite 的 ALTER TABLE ADD COLUMN 不支持 NOT NULL 且无默认值，
-- 所以两列都可空，updated_at 随后用 created_at 回填。

ALTER TABLE knowledge_links ADD COLUMN updated_at TEXT
-- @@split
-- 归档代替物理删除：AI 建议的关系被用户否掉后仍值得留痕，
-- 避免同一条关系反复被建议、反复被否。
ALTER TABLE knowledge_links ADD COLUMN archived_at TEXT
-- @@split
-- 历史行回填，让 updated_at 始终可读
UPDATE knowledge_links SET updated_at = created_at WHERE updated_at IS NULL
-- @@split
-- 列表默认只看未归档的，走这个索引
CREATE INDEX idx_knowledge_links_archived ON knowledge_links(archived_at)
-- @@split
-- 建唯一索引前先去重，否则老库里若已有重复行，整个迁移会失败、应用起不来。
-- 保留 rowid 最小的那条（最早写入的），置信度高低留给用户后续调整。
DELETE FROM knowledge_links WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM knowledge_links
    GROUP BY from_type, from_id, to_type, to_id, relation_type
)
-- @@split
-- 同一对端点 + 同一关系类型不该重复。
-- AI 每次检索都可能产出同样的建议，没有这个约束会越积越多。
CREATE UNIQUE INDEX idx_knowledge_links_unique_edge
    ON knowledge_links(from_type, from_id, to_type, to_id, relation_type)



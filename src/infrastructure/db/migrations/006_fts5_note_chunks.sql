-- 006 关键词全文索引（FTS5）
-- 之前本地关键词检索用 LIKE '%…%'，前导通配符没法走索引，笔记多了全表扫。
-- 改 FTS5 外部内容表（content='note_chunks'，按 rowid 关联），触发器保持同步。
-- trigram 分词：中文按 3 字 n-gram 索引，能像 LIKE 一样命中子串。
-- @@split
CREATE VIRTUAL TABLE note_chunks_fts USING fts5(
    text,
    content='note_chunks',
    content_rowid='rowid',
    tokenize='trigram'
)
-- @@split
CREATE TRIGGER note_chunks_fts_ai AFTER INSERT ON note_chunks BEGIN
    INSERT INTO note_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END
-- @@split
CREATE TRIGGER note_chunks_fts_ad AFTER DELETE ON note_chunks BEGIN
    INSERT INTO note_chunks_fts(note_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END
-- @@split
CREATE TRIGGER note_chunks_fts_au AFTER UPDATE OF text ON note_chunks BEGIN
    INSERT INTO note_chunks_fts(note_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    INSERT INTO note_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END
-- @@split
-- 为库里已有的 chunk 建立索引（外部内容表的 rebuild 会按 rowid 扫描 note_chunks）
INSERT INTO note_chunks_fts(note_chunks_fts) VALUES('rebuild')

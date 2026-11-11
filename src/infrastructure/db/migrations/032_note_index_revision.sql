-- Internal monotonic revision: content hashes alone cannot detect edit A -> B -> A.
ALTER TABLE notes ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0
-- @@split
CREATE TRIGGER notes_invalidate_index AFTER UPDATE OF content, content_hash ON notes
WHEN OLD.content IS NOT NEW.content OR OLD.content_hash IS NOT NEW.content_hash
BEGIN
  DELETE FROM note_chunks WHERE note_id = NEW.id;
  UPDATE notes SET content_revision = OLD.content_revision + 1,
    index_status = 'stale', chunk_count = 0, embedding_version = NULL,
    indexed_at = NULL, index_error = NULL WHERE id = NEW.id;
END
-- @@split
-- Known stale legacy chunks must not remain searchable after upgrading.
DELETE FROM note_chunks WHERE note_id IN (SELECT id FROM notes WHERE index_status = 'stale')
-- @@split
UPDATE notes SET chunk_count = 0, embedding_version = NULL, indexed_at = NULL
WHERE index_status = 'stale'
-- @@split
INSERT INTO background_jobs (id, job_type, entity_type, entity_id, status, payload, created_at)
SELECT lower(hex(randomblob(16))), 'reindex_note', 'note', n.id, 'pending', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM notes n WHERE n.index_status = 'stale'
  AND NOT EXISTS (SELECT 1 FROM background_jobs b WHERE b.entity_type = 'note'
    AND b.entity_id = n.id AND b.status IN ('pending', 'running'))

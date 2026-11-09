-- Older imports could save a note even when the NoteImported queue subscriber failed.
-- Preserve all prior job history (including explicit failures); fill only missing work.
INSERT INTO background_jobs (id, job_type, entity_type, entity_id, status, payload, created_at)
SELECT lower(hex(randomblob(16))), 'chunk_note', 'note', n.id, 'pending', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM notes n
WHERE n.index_status = 'pending' AND length(trim(n.content)) > 0
  AND n.id NOT IN (
    SELECT entity_id FROM background_jobs WHERE entity_type = 'note' AND entity_id IS NOT NULL
  )

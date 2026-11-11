-- Stable source-span identity for extracted cards; normal notes have NULL metadata keys.
CREATE UNIQUE INDEX idx_note_card_source_span ON notes (
  json_extract(metadata, '$.cardSource.noteId'),
  json_extract(metadata, '$.cardSource.contentHash'),
  json_extract(metadata, '$.cardSource.charStart'),
  json_extract(metadata, '$.cardSource.charEnd')
)

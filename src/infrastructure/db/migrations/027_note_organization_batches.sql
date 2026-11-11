CREATE TABLE note_organization_batches (
  source_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK(end_offset > start_offset),
  input_start INTEGER NOT NULL CHECK(input_start >= 0 AND input_start <= start_offset),
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY(source_id, source_hash, start_offset)
)

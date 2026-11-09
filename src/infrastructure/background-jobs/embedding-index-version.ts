import type { Database } from '../db/database';
import { enqueueJob } from './enqueue-job';

/** sqlite-vec shares one embedding space. Version switch and requeue are atomic. */
export async function prepareEmbeddingIndex(db: Database, version: string, dimensionChanged = false): Promise<void> {
  await db.transaction(async tx => {
    const [previous] = await tx.select("SELECT value FROM settings WHERE key = 'internal.embedding-index-version'");
    if (previous?.value === version && !dimensionChanged) return;
    await tx.execute('DELETE FROM note_chunk_embeddings');
    const notes = await tx.select("SELECT id FROM notes WHERE index_status IN ('indexed', 'stale') AND length(trim(content)) > 0");
    for (const note of notes) {
      await tx.execute("UPDATE notes SET index_status = 'stale', embedding_version = NULL, index_error = NULL WHERE id = ?", [String(note.id)]);
      const active = await tx.select("SELECT id FROM background_jobs WHERE entity_type = 'note' AND entity_id = ? AND status IN ('pending', 'running') LIMIT 1", [String(note.id)]);
      if (!active.length) await enqueueJob(tx, { type: 'chunk_note', entityId: String(note.id) });
    }
    await tx.execute("INSERT INTO settings(key, value, updated_at) VALUES ('internal.embedding-index-version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [version, new Date().toISOString()]);
  });
}

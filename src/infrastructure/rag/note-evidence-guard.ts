import type { NoteEvidenceGuardPort } from '@application/ports';
import type { Database } from '../db/database';

/** Edits atomically delete old chunks; re-chunking assigns new UUIDs. */
export class NoteEvidenceGuard implements NoteEvidenceGuardPort {
  constructor(private readonly db: Database) {}

  async check(sources: Parameters<NoteEvidenceGuardPort['check']>[0], signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    if (!sources.length) return true;
    const ids = [...new Set(sources.map(source => source.chunkId))];
    const rows = await this.db.select(
      `SELECT c.id, c.note_id, n.title FROM note_chunks c JOIN notes n ON n.id = c.note_id
       WHERE c.id IN (${ids.map(() => '?').join(',')}) AND n.index_status <> 'stale'`, ids,
    );
    signal?.throwIfAborted();
    const current = new Map(rows.map(row => [String(row.id), row]));
    return sources.every(source => {
      const row = current.get(source.chunkId);
      return row && String(row.note_id) === source.noteId && (source.title === undefined || String(row.title) === source.title);
    });
  }
}

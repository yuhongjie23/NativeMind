import type { Database } from '../db/database';
import type { VectorMatch } from './vector-store-interface';

/** Vectors are derived data. A deleted/replaced chunk must never become a citation. */
export async function currentVectorMatches(db: Database, matches: VectorMatch[]): Promise<VectorMatch[]> {
  if (!matches.length) return [];
  const rows = await db.select(
    `SELECT c.id, c.note_id, c.text, c.char_start FROM note_chunks c
     JOIN notes n ON n.id = c.note_id WHERE n.index_status <> 'stale'
     AND c.id IN (${matches.map(() => '?').join(',')})`,
    matches.map(match => match.chunkId),
  );
  const current = new Map(rows.map(row => [String(row.id), row]));
  return matches.flatMap(match => {
    const row = current.get(match.chunkId);
    return row && String(row.note_id) === match.noteId ? [{ ...match, text: String(row.text),
      charStart: row.char_start == null ? undefined : Number(row.char_start) }] : [];
  });
}

import { expect } from 'vitest';
import { Database, type SqlDriver } from '@infrastructure/db/database';
import { SqliteVecProvider } from '@infrastructure/vector-store/sqlite-vec-provider';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';

/** Real vec0, including rollback after DROP. No Ollama or downloaded models required. */
export async function verifyVectorMetricMigration(driver: SqlDriver): Promise<void> {
  const db = new Database(driver);
  const notes = new SqliteNoteRepository(db);
  await db.execute('DROP TABLE IF EXISTS note_chunk_embeddings');
  await db.execute('CREATE VIRTUAL TABLE note_chunk_embeddings USING vec0(chunk_id TEXT PRIMARY KEY, note_id TEXT, embedding FLOAT[768])');
  const vector = (a: number, b: number) => [a, b, ...Array<number>(766).fill(0)];
  for (const [id, values] of [['same', vector(100, 0)], ['diagonal', vector(1, 1)], ['opposite', vector(-1, 0)]] as const) {
    await notes.save({ id, title: id, content: id, contentHash: id, sourceType: 'manual', indexStatus: 'indexed',
      tags: [], createdAt: '2026-11-11', updatedAt: '2026-11-11' });
    await notes.replaceChunks(id, [{ id, noteId: id, text: id, charStart: 0, charEnd: id.length,
      headingPath: [], tags: [], createdAt: '2026-11-11' }]);
    await db.execute('INSERT INTO note_chunk_embeddings(chunk_id, note_id, embedding) VALUES (?, ?, vec_f32(?))', [id, id, JSON.stringify(values)]);
  }
  const before = await db.select('SELECT chunk_id, hex(embedding) AS bytes FROM note_chunk_embeddings ORDER BY chunk_id');
  const failing: SqlDriver = {
    select: (sql, params) => driver.select(sql, params),
    execute: (sql, params) => driver.execute(sql, params),
    transaction: work => driver.transaction(tx => work({
      select: (sql, params) => tx.select(sql, params),
      execute: (sql, params) => {
        if (sql.startsWith('INSERT INTO note_chunk_embeddings(')) return Promise.reject(new Error('simulated migration failure'));
        return tx.execute(sql, params);
      },
      transaction: nested => tx.transaction(nested),
    })),
  };
  expect(await new SqliteVecProvider(new Database(failing)).isAvailable()).toBe(false);
  expect(await db.select('SELECT chunk_id, hex(embedding) AS bytes FROM note_chunk_embeddings ORDER BY chunk_id')).toEqual(before);
  expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'note_chunk_embeddings_metric_copy'")).toEqual([]);
  const upgraded = new SqliteVecProvider(db);
  expect(await upgraded.isAvailable()).toBe(true);
  expect(upgraded.didRebuild).toBe(false);
  expect(await db.select('SELECT chunk_id, hex(embedding) AS bytes FROM note_chunk_embeddings ORDER BY chunk_id')).toEqual(before);
  const matches = await upgraded.query(vector(1, 0), 3);
  expect(matches.map(match => match.noteId)).toEqual(['same', 'diagonal', 'opposite']);
  expect(matches[0].score).toBeCloseTo(1);
  expect(matches[1].score).toBeCloseTo(Math.SQRT1_2);
  expect(matches[2].score).toBe(0);
  expect(await new SqliteVecProvider(db).isAvailable()).toBe(true);
  await expect(upgraded.query(vector(0, 0), 3)).rejects.toThrow('向量无效');
  await expect(upgraded.upsert([{ chunkId: 'bad', noteId: 'bad', text: '', embedding: vector(Number.NaN, 1) }])).rejects.toThrow('向量无效');
  const same = (await notes.findById('same'))!;
  await notes.save({ ...same, content: 'edited', contentHash: 'edited' });
  await upgraded.upsert([{ chunkId: 'same', noteId: 'same', text: 'same', embedding: vector(1, 0) }]);
  expect((await upgraded.query(vector(1, 0), 1)).map(match => match.noteId)).toEqual(['diagonal']);
  expect(await db.select("SELECT chunk_id FROM note_chunk_embeddings WHERE chunk_id = 'same'")).toEqual([]);
  await upgraded.clear();
  for (const id of ['same', 'diagonal', 'opposite']) await notes.delete(id);
}

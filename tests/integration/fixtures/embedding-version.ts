import { expect } from 'vitest';
import type { Database } from '@infrastructure/db/database';
import { prepareEmbeddingIndex } from '@infrastructure/background-jobs/embedding-index-version';

export async function verifyEmbeddingVersion(db: Database): Promise<void> {
  const before = await db.select("SELECT value FROM settings WHERE key = 'internal.embedding-index-version'");
  await db.transaction(async tx => {
    for (let i = 0; i < 205; i++) await tx.execute(
      "INSERT INTO notes(id,title,content,content_hash,index_status,embedding_version,created_at,updated_at) VALUES(?,?,?,?,'indexed','old','2026-01-01','2026-01-01')",
      [`version-${i}`, 'version test', 'saved text', `version-${i}`]);
  });
  await db.execute("INSERT INTO background_jobs(id,job_type,entity_type,entity_id,status,created_at) VALUES('version-active','chunk_note','note','version-0','pending','2026-01-01')");
  const vectors = await db.select('SELECT chunk_id, hex(embedding) AS bytes FROM note_chunk_embeddings ORDER BY chunk_id');
  await db.execute("CREATE TEMP TRIGGER reject_version BEFORE INSERT ON background_jobs WHEN NEW.entity_id = 'version-100' BEGIN SELECT RAISE(ABORT, 'version fault'); END");
  try { await expect(prepareEmbeddingIndex(db, 'new-test')).rejects.toThrow('version fault'); }
  finally { await db.execute('DROP TRIGGER reject_version'); }
  expect(await db.select("SELECT value FROM settings WHERE key = 'internal.embedding-index-version'")).toEqual(before);
  expect(await db.select('SELECT chunk_id, hex(embedding) AS bytes FROM note_chunk_embeddings ORDER BY chunk_id')).toEqual(vectors);
  expect(await db.select("SELECT count(*) AS count FROM notes WHERE id LIKE 'version-%' AND index_status='indexed'")).toEqual([{ count: 205 }]);
  await prepareEmbeddingIndex(db, 'new-test');
  await prepareEmbeddingIndex(db, 'new-test');
  expect(await db.select('SELECT count(*) AS count FROM note_chunk_embeddings')).toEqual([{ count: 0 }]);
  expect(await db.select("SELECT count(*) AS count FROM background_jobs WHERE entity_id LIKE 'version-%' AND status='pending'")).toEqual([{ count: 205 }]);
  expect(await db.select("SELECT count(*) AS count FROM notes WHERE id LIKE 'version-%' AND content='saved text' AND updated_at='2026-01-01' AND index_status='stale'")).toEqual([{ count: 205 }]);
  await db.execute("DELETE FROM background_jobs WHERE entity_id LIKE 'version-%'");
  await db.execute("DELETE FROM notes WHERE id LIKE 'version-%'");
  // Restore the test runtime version; all requeued work still uses saved text.
  if (before[0]) await prepareEmbeddingIndex(db, String(before[0].value));
}

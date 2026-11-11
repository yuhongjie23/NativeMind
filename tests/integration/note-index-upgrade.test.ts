import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@infrastructure/db/database';
import { MIGRATIONS } from '@infrastructure/db/migrations';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NodeSqliteDriver } from './sqlite-driver';

const folders: string[] = [];
const drivers: NodeSqliteDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map(driver => driver.close()));
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});
const setup = async () => {
  const folder = await mkdtemp(join(tmpdir(), 'nativemind-index-upgrade-'));
  folders.push(folder);
  const path = join(folder, 'test.db');
  let driver = new NodeSqliteDriver(path);
  drivers.push(driver);
  let db = new Database(driver, MIGRATIONS.filter(m => m.version <= 31));
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  for (const id of ['current', 'stale']) {
    await repo.save({ id, title: id, content: '保存正文', contentHash: id, indexStatus: id === 'stale' ? 'stale' : 'indexed',
      sourceType: 'manual', tags: [], createdAt: '2026-11-11', updatedAt: '2026-11-11' });
    await repo.replaceChunks(id, [{ id: `${id}-chunk`, noteId: id, text: '旧切片', headingPath: [], tags: [], createdAt: '2026-11-11' }]);
  }
  const reopen = async (broken = false) => {
    await driver.close();
    drivers.splice(drivers.indexOf(driver), 1);
    driver = new NodeSqliteDriver(path);
    drivers.push(driver);
    db = new Database(driver, broken ? MIGRATIONS.map(m => m.version === 32
      ? { ...m, sql: `${m.sql}\n-- @@split\nINSERT INTO missing_table VALUES (1)` } : m) : MIGRATIONS);
    return db;
  };
  return { db, reopen };
};

describe('index revision upgrade on disk', () => {
  it('keeps saved content and valid indexes, removes known stale chunks, and resumes once after restart', async () => {
    const { db: old, reopen } = await setup();
    const saved = await old.select('SELECT id, title, content, content_hash FROM notes ORDER BY id');
    let db = await reopen();
    expect((await db.migrate()).map(m => m.version)).toEqual([32]);
    expect(await db.select('SELECT id, title, content, content_hash FROM notes ORDER BY id')).toEqual(saved);
    expect(await db.select('SELECT id FROM note_chunks')).toEqual([{ id: 'current-chunk' }]);
    expect(await db.select('SELECT entity_id, job_type FROM background_jobs')).toEqual([{ entity_id: 'stale', job_type: 'reindex_note' }]);
    await db.execute("UPDATE notes SET content = '新正文', content_hash = 'new' WHERE id = 'current'");
    db = await reopen();
    expect(await db.migrate()).toEqual([]);
    expect(await db.select("SELECT content, content_revision, chunk_count FROM notes WHERE id = 'current'"))
      .toEqual([{ content: '新正文', content_revision: 1, chunk_count: 0 }]);
    expect(await db.select('SELECT id FROM note_chunks')).toEqual([]);
    expect(await db.select('SELECT count(*) AS count FROM background_jobs')).toEqual([{ count: 1 }]);
    expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('rolls back all derived-data cleanup on migration failure and succeeds on restart', async () => {
    const { db: old, reopen } = await setup();
    const saved = await old.select('SELECT * FROM notes ORDER BY id');
    let db = await reopen(true);
    await expect(db.migrate()).rejects.toThrow('missing_table');
    expect(await db.select('SELECT * FROM notes ORDER BY id')).toEqual(saved);
    expect(await db.select('SELECT id FROM note_chunks ORDER BY id')).toHaveLength(2);
    expect(await db.select('SELECT id FROM background_jobs')).toEqual([]);
    db = await reopen();
    expect((await db.migrate()).map(m => m.version)).toEqual([32]);
    expect(await db.select('SELECT id FROM note_chunks')).toEqual([{ id: 'current-chunk' }]);
  });
});

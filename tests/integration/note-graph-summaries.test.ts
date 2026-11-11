import { expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { InMemoryNoteRepository } from '@infrastructure/local-demo';
import { NodeSqliteDriver } from './sqlite-driver';

it('SQLite and preview expose notes beyond 100 without loading document bodies', async () => {
  const driver = new NodeSqliteDriver(':memory:');
  try {
    const db = new Database(driver); await db.migrate();
    const sql = new SqliteNoteRepository(db), memory = new InMemoryNoteRepository();
    for (let i = 0; i < 105; i++) {
      const note = { id: `note-${i}`, title: `Note ${i}`, content: 'A private document body', contentHash: String(i),
        sourceType: 'manual' as const, indexStatus: 'pending' as const, tags: [],
        createdAt: '2026-11-10', updatedAt: '2026-11-10' };
      await sql.save(note); await memory.save(note);
    }
    const summaries = await sql.listGraphSummaries(1000);
    expect(summaries).toHaveLength(105);
    expect(summaries).toEqual(await memory.listGraphSummaries(1000));
    expect(summaries.every(note => Object.keys(note).sort().join(',') === 'id,title')).toBe(true);
    expect(await sql.listGraphSummaries(10)).toHaveLength(10);
  } finally { await driver.close(); }
});

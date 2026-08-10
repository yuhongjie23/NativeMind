/**
 * note_chunks FTS5 集成测试
 *
 * 在真实 SQLite 上验证：迁移 006 建出 FTS5 表（含 trigram 分词与触发器）、
 * replaceChunks 写入后触发器同步索引、searchChunks 能命中中文子串。
 */
import { describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const setup = async () => {
  const db = new Database(new NodeSqliteDriver(':memory:'));
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  await repo.save({
    id: 'note-1',
    title: '测试笔记',
    content: '',
    contentHash: 'hash-1',
    sourceType: 'imported_text',
    indexStatus: 'indexed',
    tags: [],
    createdAt: '2026-08-02T09:00:00.000Z',
    updatedAt: '2026-08-02T09:00:00.000Z',
  });
  return repo;
};

const chunk = (id: string, text: string) => ({
  id,
  noteId: 'note-1',
  text,
  headingPath: [],
  charStart: 0,
  charEnd: text.length,
  tags: [],
  createdAt: '2026-08-02T09:00:00.000Z',
});

describe('note_chunks FTS5', () => {
  it('中文关键词能命中 chunk 的子串', async () => {
    const repo = await setup();
    await repo.replaceChunks('note-1', [chunk('c1', '线性代数的向量空间与矩阵')]);

    const hits = await repo.searchChunks('线性代数');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('c1');
  });

  it('替换 chunk 后旧文本不再命中（触发器同步删除）', async () => {
    const repo = await setup();
    await repo.replaceChunks('note-1', [chunk('c1', '旧内容：量子力学入门')]);
    await repo.replaceChunks('note-1', [chunk('c2', '新内容：概率论与统计')]);

    expect((await repo.searchChunks('量子力学')).length).toBe(0);
    expect((await repo.searchChunks('概率论')).length).toBeGreaterThan(0);
  });
});

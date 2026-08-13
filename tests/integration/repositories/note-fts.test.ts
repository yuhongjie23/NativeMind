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

  it('findByTags 按 JSON 数组元素精确匹配（不带引号的子串不会误命中）', async () => {
    const repo = await setup();
    await repo.save({
      id: 'note-2',
      title: '深度学习',
      content: '',
      contentHash: 'hash-2',
      sourceType: 'imported_text',
      indexStatus: 'indexed',
      tags: ['深度学习'],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    });
    await repo.save({
      id: 'note-3',
      title: '机器视觉',
      content: '',
      contentHash: 'hash-3',
      sourceType: 'imported_text',
      indexStatus: 'indexed',
      tags: ['深度', '视觉'],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    });

    // 精确标签「深度学习」只命中 note-2，不把「深度」/「视觉」拉进来
    const hits = await repo.findByTags(['深度学习']);
    expect(hits.map((n) => n.id)).toEqual(['note-2']);

    // 多标签 OR 语义：任一命中即返回
    const multi = await repo.findByTags(['视觉', '不存在的标签']);
    expect(multi.map((n) => n.id)).toEqual(['note-3']);
  });

  it('findByTitleKeyword 按标题子串召回（正文用词不同但标题相关的笔记）', async () => {
    const repo = await setup();
    await repo.save({
      id: 'note-memory',
      title: '记忆模块（Memory）',
      content: '记忆模块负责存储与检索过去的交互与知识。',
      contentHash: 'hash-memory',
      sourceType: 'imported_text',
      indexStatus: 'indexed',
      tags: [],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    });
    await repo.save({
      id: 'note-agent',
      title: '单 Agent 四大核心组件',
      content: 'Agent 由记忆、规划、工具与行动四部分组成。',
      contentHash: 'hash-agent',
      sourceType: 'imported_text',
      indexStatus: 'indexed',
      tags: [],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-02T09:00:00.000Z',
    });

    // 搜「记忆」命中标题含「记忆」的笔记，不要求正文也出现
    const byTitle = await repo.findByTitleKeyword('记忆');
    expect(byTitle.map((n) => n.id)).toContain('note-memory');
    expect(byTitle.map((n) => n.id)).not.toContain('note-agent');

    // findByIds 批量取回标题
    const batch = await repo.findByIds(['note-memory', 'note-agent']);
    const titleById = new Map(batch.map((n) => [n.id, n.title]));
    expect(titleById.get('note-memory')).toBe('记忆模块（Memory）');
    expect(titleById.get('note-agent')).toBe('单 Agent 四大核心组件');
  });
});

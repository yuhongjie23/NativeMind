import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NoteCandidateProvider } from '@infrastructure/rag/note-candidate-provider';
import { InMemoryNoteRepository, LocalNoteSearchPort } from '@infrastructure/local-demo';
import { RetrievalStrategy } from '@ai/rag/retrieval-strategy';
import type { Note } from '@application/ports';
import { NodeSqliteDriver } from './sqlite-driver';

const drivers: NodeSqliteDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map(driver => driver.close())); });
const note = (id: string, content: string, indexStatus: Note['indexStatus'] = 'pending'): Note => ({
  id, content, indexStatus, title: '实验记录', tags: [], contentHash: id,
  sourceType: 'imported_text', createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z',
});
const setup = async () => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  const db = new Database(driver);
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  return { repo, provider: new NoteCandidateProvider(repo) };
};

describe('ordinary search before chunking', () => {
  it.each(['pending', 'failed', 'indexed'] as const)('finds saved body text with %s status and preserves its original position', async status => {
    const { repo, provider } = await setup();
    const content = '🌱背景说明。'.repeat(500) + '茶叶成分的提取率与溶剂有关。' + '后续记录。'.repeat(400);
    await repo.save(note('tea', content, status));
    const query = { text: '提取率', preferLiteralMatches: true, rerank: false };
    const candidates = await provider.listCandidates(query, 10);
    const hits = await new RetrievalStrategy({ version: 'test', embed: async () => [] }, { query: async () => [] })
      .retrieve(query, candidates, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain('提取率');
    expect(hits[0].text.length).toBeLessThanOrEqual(1200);
    expect(hits[0].charStart).toBeGreaterThan(1200);
    expect(content.slice(hits[0].charStart, hits[0].charStart! + hits[0].text.length)).toBe(hits[0].text);
    expect(await repo.listChunks('tea')).toEqual([]);
    expect(await repo.findById('tea')).toEqual(note('tea', content, status));
  });

  it('finds a partial title before indexing, without needing an exact title', async () => {
    const { repo, provider } = await setup();
    await repo.save({ ...note('tea', '记录实验过程'), title: '茶叶提取率实验记录' });
    expect(await provider.listCandidates({ text: '提取率', preferLiteralMatches: true }, 10))
      .toEqual([expect.objectContaining({ noteId: 'tea', charStart: 0 })]);
  });

  it('uses indexed chunks once available and never creates duplicate fallback hits', async () => {
    const { repo, provider } = await setup();
    const saved = note('tea', '提取率记录', 'indexed');
    await repo.save(saved);
    await repo.replaceChunks('tea', [{ id: 'tea-chunk', noteId: 'tea', text: saved.content,
      charStart: 0, charEnd: saved.content.length, headingPath: [], tags: [], createdAt: saved.createdAt }]);
    expect((await provider.listCandidates({ text: '提取率', preferLiteralMatches: true }, 10)).map(c => c.chunkId))
      .toEqual(['tea-chunk']);
  });

  it('excludes notes before the result cap and leaves deep/automatic retrieval unchanged', async () => {
    const { repo, provider } = await setup();
    await repo.save(note('a', '提取率'));
    await repo.save(note('b', '提取率'));
    expect((await provider.listCandidates({ text: '提取率', preferLiteralMatches: true, excludeNoteIds: ['a'] }, 1))
      .map(c => c.noteId)).toEqual(['b']);
    expect(await provider.listCandidates({ text: '提取率', preferLiteralMatches: true, deep: true }, 10)).toEqual([]);
    expect(await provider.listCandidates({ text: '提取率' }, 10)).toEqual([]);
    expect(await provider.listCandidates({ text: '不存在的内容', preferLiteralMatches: true }, 10)).toEqual([]);
  });

  it('does not begin a database lookup after cancellation', async () => {
    const { repo, provider } = await setup();
    const lookup = vi.spyOn(repo, 'findBySearchTitle');
    const controller = new AbortController();
    controller.abort();
    await expect(provider.listCandidates({ text: '提取率', preferLiteralMatches: true, signal: controller.signal }, 10)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not continue searching after cancellation during the title lookup', async () => {
    const { repo, provider } = await setup();
    const controller = new AbortController();
    vi.spyOn(repo, 'findBySearchTitle').mockImplementation(async () => { controller.abort(); return []; });
    const chunks = vi.spyOn(repo, 'searchChunks');
    const saved = vi.spyOn(repo, 'findUnchunkedByKeywords');
    await expect(provider.listCandidates({ text: '提取率', preferLiteralMatches: true, signal: controller.signal }, 10)).rejects.toThrow();
    expect(chunks).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('ranks multi-keyword matches before capping and does not let recent unrelated chunks crowd them out', async () => {
    const { repo, provider } = await setup();
    for (let i = 0; i < 25; i++) await repo.save(note(`a-${i}`, '茶叶的分类记录。'));
    await repo.save(note('tea', '茶叶的提取率与溶剂有关。'));
    expect((await repo.findUnchunkedByKeywords(['茶叶', '提取率', '溶剂'], [], 1)).map(n => n.id)).toEqual(['tea']);
    await repo.save(note('book', '无关内容', 'indexed'));
    await repo.replaceChunks('book', [{ id: 'book-chunk', noteId: 'book', text: '无关内容',
      charStart: 0, charEnd: 4, headingPath: [], tags: [], createdAt: '2026-11-11T00:00:00Z' }]);
    expect((await provider.listCandidates({ text: '提取率', preferLiteralMatches: true }, 1)).map(c => c.noteId))
      .toEqual(['tea']);
  });

  it('treats SQL wildcard characters literally in the saved-note fallback', async () => {
    const { repo } = await setup();
    await repo.save(note('literal', 'rate_100% 使用 C:\\notes'));
    await repo.save(note('other', 'rateX1000 使用 C:notes'));
    for (const term of ['rate_100%', 'C:\\notes']) {
      expect((await repo.findUnchunkedByKeywords([term], [], 20)).map(n => n.id)).toEqual(['literal']);
    }
    expect(await repo.findUnchunkedByKeywords([], [], 20)).toEqual([]);
    expect(await repo.findUnchunkedByKeywords(['rate'], [], 0)).toEqual([]);
  });

  it('keeps the browser demo searchable before indexing too', async () => {
    const repo = new InMemoryNoteRepository();
    await repo.save(note('tea', '背景说明。\n\n茶叶提取率记录。'));
    const hits = await new LocalNoteSearchPort(repo).search('提取率', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].noteId).toBe('tea');
    expect(hits[0].text).toContain('提取率');
    const saved = await repo.findById('tea');
    expect(saved?.content.slice(hits[0].charStart, hits[0].charStart! + hits[0].text.length)).toBe(hits[0].text);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NoteEvidenceGuard } from '@infrastructure/rag/note-evidence-guard';
import { DeepQAAdapter } from '@ai/adapters';
import { SelfRag } from '@ai/rag/self-rag';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';
import type { RetrievalCandidate } from '@ai/rag/retrieval-strategy';
import { NodeSqliteDriver } from './sqlite-driver';

const drivers: NodeSqliteDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map(driver => driver.close())); });
const setup = async (onGenerate?: (repo: SqliteNoteRepository) => Promise<void>) => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  const db = new Database(driver);
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  await repo.save({ id: 'n', title: '实验记录', content: '提取率为百分之二十。', contentHash: 'old',
    sourceType: 'manual', tags: [], indexStatus: 'indexed', createdAt: '2026-11-11', updatedAt: '2026-11-11' });
  await repo.replaceChunks('n', [{ id: 'c', noteId: 'n', text: '提取率为百分之二十。', charStart: 0,
    charEnd: 10, tags: [], headingPath: [], createdAt: '2026-11-11' }]);
  const candidates: RetrievalCandidate[] = [{ chunkId: 'c', noteId: 'n', title: '实验记录', text: '提取率为百分之二十。',
    charStart: 0, score: 1, matchedBy: ['rule'] }];
  const complete = vi.fn(async (request: ModelCompletionRequest) => {
    const schema = JSON.stringify(request.jsonSchema ?? {});
    if (schema.includes('missing')) return '{"missing":"","verdict":"supported"}';
    if (schema.includes('supported')) return '{"supported":[true]}';
    if (schema.includes('evidence')) return JSON.stringify({ relevance: 1, grounded: true, hallucination_risk: false,
      quality: 9, evidence: [{ source: 1, from: 1, to: 1, claim: 1 }], critique: '' });
    await onGenerate?.(repo);
    return '提取率为百分之二十。';
  });
  const router = new ModelRouter({ isAvailable: async () => true, complete });
  const rag = { retrieve: async () => candidates } as unknown as RAGOrchestrator;
  const guard = new NoteEvidenceGuard(db);
  return { db, repo, candidates, complete, router, rag, guard };
};

it('does not publish an old answer after its source changes during generation', async () => {
  const f = await setup(async repo => {
    const note = (await repo.findById('n'))!;
    await repo.save({ ...note, content: '更正：提取率为百分之四十。', contentHash: 'new' });
  });
  const reset = vi.fn();
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('提取率是多少？', { onToken: reset });
  expect(result.sourceIssue).toBe('changed');
  expect(result.citations).toEqual([]);
  expect(result.answer).toContain('资料已修改');
  expect(result.answer).not.toContain('百分之二十');
  expect(reset).toHaveBeenCalledWith('', true);
  expect(f.complete).toHaveBeenCalledTimes(1);
});

it('keeps a verified answer and precise source location when the material is unchanged', async () => {
  const f = await setup();
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('提取率是多少？');
  expect(result.sourceIssue).toBeUndefined();
  expect(result.judged).toBe(true);
  expect(result.citations).toEqual([expect.objectContaining({ noteId: 'n', charStart: 0, text: '提取率为百分之二十。' })]);
  expect(result.answer).toContain('百分之二十');
});

it.each(['delete', 'rename', 'rechunk', 'edit-back'] as const)('blocks %s before generation without spending a model call', async action => {
  const f = await setup();
  const note = (await f.repo.findById('n'))!;
  if (action === 'delete') await f.repo.delete('n');
  if (action === 'rename') await f.repo.save({ ...note, title: '更正后的标题' });
  if (action === 'rechunk') {
    const [chunk] = await f.repo.listChunks('n');
    await f.repo.replaceChunks('n', [{ ...chunk, id: 'replacement' }]);
  }
  if (action === 'edit-back') {
    await f.repo.save({ ...note, content: '临时修改', contentHash: 'changed' });
    await f.repo.save(note);
  }
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('提取率是多少？');
  expect(result.sourceIssue).toBe('changed');
  expect(f.complete).not.toHaveBeenCalled();
});

it('checks again after semantic evidence review and preserves English through the application adapter', async () => {
  const f = await setup();
  const originalComplete = f.complete.getMockImplementation()!;
  f.complete.mockImplementation(async request => {
    if (JSON.stringify(request.jsonSchema ?? {}).includes('missing')) await f.repo.delete('n');
    return originalComplete(request);
  });
  const adapter = new DeepQAAdapter(new SelfRag(f.router, f.rag, undefined, f.guard), async () => 'en');
  const result = await adapter.ask({ question: 'What is the extraction rate?' });
  expect(result).toMatchObject({ sourceIssue: 'changed', citations: [], judged: false, confidence: 0, ok: false });
  expect(result.answer).toContain('source material changed');
  expect(result.answer).not.toMatch(/[\u4e00-\u9fa5]/);
});

it('withdraws stale excerpts even when the generation failed', async () => {
  const f = await setup();
  f.complete.mockImplementation(async () => { await f.repo.delete('n'); throw new Error('Model unavailable'); });
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('提取率是多少？');
  expect(result.sourceIssue).toBe('changed');
  expect(result.citations).toEqual([]);
  expect(result.answer).not.toContain('百分之二十');
});

it('distinguishes a failed local source check from absent evidence', async () => {
  const f = await setup();
  const check = vi.spyOn(f.guard, 'check');
  check.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Database unavailable'));
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('提取率是多少？');
  expect(result.sourceIssue).toBe('unavailable');
  expect(result.answer).toContain('无法核对资料');
  expect(result.citations).toEqual([]);
  expect(result.answer).not.toContain('资料不足');
  expect(f.complete).toHaveBeenCalledTimes(1);
});

it('propagates cancellation during the final check instead of publishing an error or old answer', async () => {
  const f = await setup();
  const controller = new AbortController();
  let calls = 0;
  const check = f.guard.check.bind(f.guard);
  vi.spyOn(f.guard, 'check').mockImplementation(async (...args) => {
    if (++calls === 3) controller.abort();
    return check(...args);
  });
  await expect(new SelfRag(f.router, f.rag, undefined, f.guard).ask('问题', { signal: controller.signal })).rejects.toThrow();
});

it('does not let a changed unused source silently influence a verified answer', async () => {
  const f = await setup();
  const note = (await f.repo.findById('n'))!;
  await f.repo.save({ ...note, id: 'other', title: '另一份资料' });
  const [chunk] = await f.repo.listChunks('n');
  await f.repo.replaceChunks('other', [{ ...chunk, id: 'other-c', noteId: 'other' }]);
  f.candidates.push({ ...f.candidates[0], chunkId: 'other-c', noteId: 'other', title: '另一份资料' });
  const originalComplete = f.complete.getMockImplementation()!;
  f.complete.mockImplementation(async request => {
    if (JSON.stringify(request.jsonSchema ?? {}).includes('missing')) await f.repo.delete('other');
    return originalComplete(request);
  });
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('问题');
  expect(result.sourceIssue).toBe('changed');
  expect(result.citations).toEqual([]);
});

it.each(['regeneration', 'second-review'] as const)('checks sources during %s instead of publishing the refined answer', async phase => {
  const f = await setup();
  const originalComplete = f.complete.getMockImplementation()!;
  let generations = 0;
  let reviews = 0;
  f.complete.mockImplementation(async request => {
    const schema = JSON.stringify(request.jsonSchema ?? {});
    if (schema.includes('"evidence"')) {
      reviews += 1;
      if (reviews === 1) return JSON.stringify({ relevance: 1, grounded: false, hallucination_risk: true,
        quality: 2, evidence: [], critique: 'Remove unsupported claims.' });
      if (phase === 'second-review') await f.repo.delete('n');
    } else if (!schema.includes('missing') && !schema.includes('supported')) {
      if (++generations === 2 && phase === 'regeneration') await f.repo.delete('n');
    }
    return originalComplete(request);
  });
  const result = await new SelfRag(f.router, f.rag, undefined, f.guard).ask('问题');
  expect(result).toMatchObject({ sourceIssue: 'changed', regenerated: true, citations: [] });
  expect(generations).toBe(2);
  expect(reviews).toBe(phase === 'regeneration' ? 1 : 2);
});

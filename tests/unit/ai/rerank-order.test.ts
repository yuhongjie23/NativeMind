import { describe, expect, it, vi } from 'vitest';
import { ReRanker } from '@ai/rag/rerank';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';
import type { RetrievalCandidate } from '@ai/rag/retrieval-strategy';

const candidates: RetrievalCandidate[] = ['irrelevant', 'answer', 'context'].map((text, index) => ({
  chunkId: `long-chunk-id-${index}`, noteId: `long-note-id-${index}`, text, score: 0.5, matchedBy: ['vector'],
}));
function setup(output: unknown) {
  const complete = vi.fn(async (_request: ModelCompletionRequest) => JSON.stringify(output));
  const router = new ModelRouter({ isAvailable: async () => true, complete });
  return { ranker: new ReRanker(router), complete };
}

describe('compact candidate ranking', () => {
  it('maps short IDs to original candidates without exposing storage IDs', async () => {
    const { ranker, complete } = setup({ order: [1, 2, 0] });
    expect(await ranker.rerank('question', candidates, 2)).toEqual([candidates[1], candidates[2]]);
    const request = complete.mock.calls[0][0];
    expect(request.prompt).not.toContain('long-chunk-id');
    expect(request.prompt).not.toContain('long-note-id');
    expect(request.jsonSchema).toBeDefined();
    expect(request.maxTokens).toBe(128);
  });
  it.each([{ order: [1, 2] }, { order: [1, 2, 0, 3] }, { order: [1, '2', 0] },
    { order: [1, 1, 0] }, { order: [-1, 2, 0] }, { order: [0.5, 2, 0] }, { order: [3, 1, 0] }, { order: [] }, { unknown: [] }])(
    'falls back for invalid or incomplete order %j without repeating model work', async output => {
      const { ranker, complete } = setup(output);
      expect(await ranker.rerank('question', candidates, 3)).toBeNull();
      expect(complete).toHaveBeenCalledTimes(1);
    });
  it('allows an unchanged order when the model has no better ranking', async () => {
    const { ranker } = setup({ order: [0, 1, 2] });
    expect(await ranker.rerank('absent answer', candidates, 3)).toEqual(candidates);
  });
  it('checks all twenty IDs and never emits an out-of-pool candidate', async () => {
    const pool = Array.from({ length: 21 }, (_, i) => ({ ...candidates[0], chunkId: `c-${i}` }));
    const { ranker } = setup({ order: Array.from({ length: 20 }, (_, i) => 19-i) });
    const ranked = await ranker.rerank('question', pool, 20);
    expect(ranked).toHaveLength(20);
    expect(ranked?.map(item => item.chunkId)).toEqual(pool.slice(0,20).reverse().map(item => item.chunkId));
  });
  it('does not invoke the model for one candidate or an already canceled request', async () => {
    const { ranker, complete } = setup({ order: [0] });
    expect(await ranker.rerank('question', candidates.slice(0,1), 1)).toBeNull();
    await expect(ranker.rerank('question', candidates, 3, AbortSignal.abort())).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('aborts underlying work when its deadline expires', async () => {
    let observed: AbortSignal | undefined;
    const router = new ModelRouter({ isAvailable: async () => true, complete: request => {
      observed = request.signal;
      return new Promise((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(request.signal!.reason), { once: true }));
    } });
    const ranker = new ReRanker(router, { timeoutMs: 10, maxCandidates: 20, candidateChars: 300 });
    expect(await ranker.rerank('question', candidates, 3)).toBeNull();
    expect(observed?.aborted).toBe(true);
  });
});

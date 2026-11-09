import { describe, expect, it, vi } from 'vitest';
import { RetrievalStrategy } from '@ai/rag/retrieval-strategy';
import { ReRanker } from '@ai/rag/rerank';
import type { ModelRouter } from '@ai/router/model-router';
import type { KnowledgeProgress } from '@application/ports';

describe('progressive retrieval', () => {
  it('publishes literal hits before embeddings finish and skips optional reranking', async () => {
    let finish!: (value: number[][]) => void;
    const embedding = { version: 'test', embed: vi.fn(() => new Promise<number[][]>(resolve => { finish = resolve; })) };
    const rerank = vi.spyOn(ReRanker.prototype, 'rerank').mockResolvedValue([]);
    const retrieval = new RetrievalStrategy(embedding, { query: async () => [] }, undefined, { reranker: new ReRanker({} as ModelRouter) });
    const onPartial = vi.fn();
    const stages: KnowledgeProgress[] = [];
    const work = retrieval.retrieve({ text: 'needle', rerank: false, onPartial, onProgress: event => stages.push(event) }, [
      { chunkId: 'c', noteId: 'n', text: 'The needle is here', tags: [] },
    ]);
    await vi.waitFor(() => expect(embedding.embed).toHaveBeenCalled());
    expect(onPartial).toHaveBeenCalledWith([expect.objectContaining({ chunkId: 'c' })]);
    expect(stages.some(event => event.stage === 'embedding' && event.state === 'finished')).toBe(false);
    finish([[1, 0]]);
    expect(await work).toHaveLength(1);
    expect(rerank).not.toHaveBeenCalled();
    expect(stages.filter(event => event.state === 'finished').map(event => event.stage)).toEqual(['keywords', 'embedding', 'vector']);
    rerank.mockRestore();
  });

  it('cancelling after keyword results prevents vector access and late completion', async () => {
    const controller = new AbortController();
    const vector = { query: vi.fn(async () => []) };
    const retrieval = new RetrievalStrategy({ version: 'test', embed: async () => { controller.abort(); return [[1]]; } }, vector);
    const onPartial = vi.fn();
    await expect(retrieval.retrieve({ text: 'needle', signal: controller.signal, onPartial }, [])).rejects.toThrow();
    expect(onPartial).toHaveBeenCalledWith([]);
    expect(vector.query).not.toHaveBeenCalled();
  });
});

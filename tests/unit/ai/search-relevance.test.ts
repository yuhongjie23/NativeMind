import { describe, expect, it, vi } from 'vitest';
import { RetrievalStrategy, type RuleCandidateSource } from '@ai/rag/retrieval-strategy';

const tea: RuleCandidateSource = {
  chunkId: 'tea-chunk', noteId: 'tea', title: '茶叶成分的“提取率”分离机制',
  text: '温度与溶剂会影响浸出过程。', tags: [], charStart: 24,
};
const history: RuleCandidateSource = {
  chunkId: 'history-chunk', noteId: 'history', title: '历史读书笔记',
  text: '古代军队的驻防制度。', tags: [],
};
const setup = () => {
  const embedding = { version: 'test', embed: vi.fn(async () => [[1]]) };
  const vectors = { query: vi.fn(async () => [{ ...history, score: 0.95 }]) };
  return { embedding, vectors, retrieval: new RetrievalStrategy(embedding, vectors) };
};

describe('interactive note search relevance', () => {
  it('combines lexical and vector evidence without accumulating duplicate variants', async () => {
    const relevant = { ...tea, title: 'Lab notes', text: 'extraction temperature', chunkId: 'relevant' };
    const unrelated = { ...history, text: 'unrelated passage' };
    const vectors = { query: async () => [{ ...unrelated, score: 0.8 }, { ...relevant, score: 0.7 }] };
    const retrieval = new RetrievalStrategy({ version: 'test', embed: async () => [[1], [1], [1]] }, vectors);
    const hits = await retrieval.retrieve({ text: 'extraction temperature', rerank: false }, [relevant, unrelated]);
    expect(hits[0].chunkId).toBe('relevant');
    expect(hits[0].score).toBeCloseTo(0.2 + 0.7 * 0.6);
    expect(hits[0].matchedBy).toEqual(['rule', 'vector']);
  });
  it('does not let a book-title fragment outweigh the rest of the question', async () => {
    const relevant = { ...tea, title: 'Guide', text: 'extraction temperature', chunkId: 'relevant' };
    const distractor = { ...tea, title: 'Guide', text: 'Guide introduction', chunkId: 'intro' };
    const retrieval = new RetrievalStrategy({ version: 'test', embed: async () => [[1]] },
      { query: async () => [] });
    const hits = await retrieval.retrieve({ text: 'Guide, extraction temperature', rerank: false }, [distractor, relevant]);
    expect(hits[0].chunkId).toBe('relevant');
  });
  it('recalls beyond the display cutoff before applying lexical evidence', async () => {
    const relevant = { ...tea, title: 'Lab notes', text: 'extraction temperature', chunkId: 'relevant' };
    const semantic = [
      ...Array.from({ length: 17 }, (_, i) => ({ ...history, chunkId: `other-${i}`, score: 0.8 })),
      { ...relevant, score: 0.7 },
    ];
    const retrieval = new RetrievalStrategy({ version: 'test', embed: async () => [[1]] },
      { query: async (_vector, limit = 10) => semantic.slice(0, limit) });
    const hits = await retrieval.retrieve({ text: 'extraction temperature', rerank: false }, [relevant], 8);
    expect(hits[0].chunkId).toBe('relevant');
    expect(hits).toHaveLength(8);
  });
  it('finds the exact title without waiting for models or including unrelated vectors', async () => {
    const { retrieval, embedding, vectors } = setup();
    const onPartial = vi.fn();
    const hits = await retrieval.retrieve({ text: ` ${tea.title} `, preferLiteralMatches: true, onPartial }, [history, tea]);
    expect(hits).toEqual([expect.objectContaining({ noteId: 'tea', charStart: 24, score: 1, exactTitleMatch: true })]);
    expect(onPartial).toHaveBeenCalledWith(hits);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(vectors.query).not.toHaveBeenCalled();
  });

  it('puts partial literal matches before a higher-scoring but unrelated vector', async () => {
    const { retrieval } = setup();
    const hits = await retrieval.retrieve({ text: '提取率', preferLiteralMatches: true, rerank: false }, [history, tea]);
    expect(hits.map(hit => hit.noteId)).toEqual(['tea', 'history']);
    expect(hits[0].score).toBeLessThan(hits[1].score);
  });

  it('keeps semantic search available when there are no literal matches', async () => {
    const { retrieval } = setup();
    const hits = await retrieval.retrieve({ text: 'military deployment', preferLiteralMatches: true, rerank: false }, [tea, history]);
    expect(hits.map(hit => hit.noteId)).toEqual(['history']);
  });

  it('does not change deep retrieval or evidence retrieval for AI answers', async () => {
    for (const options of [{ deep: true, preferLiteralMatches: true }, {}]) {
      const { retrieval, embedding } = setup();
      await retrieval.retrieve({ text: tea.title!, ...options, rerank: false }, [tea, history]);
      expect(embedding.embed).toHaveBeenCalled();
    }
  });

  it('keeps same-title notes and respects exclusions and result limits', async () => {
    const { retrieval } = setup();
    const duplicate = { ...tea, noteId: 'duplicate', chunkId: 'duplicate-chunk' };
    const query = { text: tea.title!, preferLiteralMatches: true };
    expect(await retrieval.retrieve(query, [tea, duplicate])).toHaveLength(2);
    expect(await retrieval.retrieve(query, [tea, duplicate], 1)).toHaveLength(1);
    expect((await retrieval.retrieve({ ...query, excludeNoteIds: ['tea'] }, [tea, duplicate]))[0].noteId).toBe('duplicate');
  });

  it('honors cancellation during exact-title partial publication', async () => {
    const { retrieval } = setup();
    const controller = new AbortController();
    await expect(retrieval.retrieve({ text: tea.title!, preferLiteralMatches: true,
      signal: controller.signal, onPartial: () => controller.abort() }, [tea])).rejects.toThrow();
  });

  it('deduplicates exact-title previews by note before applying the limit', async () => {
    const { retrieval, embedding } = setup();
    const hits = await retrieval.retrieve({ text: tea.title!, preferLiteralMatches: true }, [
      tea, { ...tea, chunkId: 'second-passage' }, { ...tea, noteId: 'other-note', chunkId: 'other-chunk' },
    ], 2);
    expect(hits.map(hit => hit.noteId)).toEqual(['tea', 'other-note']);
    expect(embedding.embed).not.toHaveBeenCalled();
  });
});

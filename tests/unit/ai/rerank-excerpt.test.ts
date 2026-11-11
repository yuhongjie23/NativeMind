import { describe, expect, it } from 'vitest';
import { selectRerankExcerpt } from '@ai/rag/rerank-excerpt';
import { ReRanker } from '@ai/rag/rerank';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';
import type { RetrievalCandidate } from '@ai/rag/retrieval-strategy';

const filler = '本节记录目录与页码，说明文档编排方式。'.repeat(30);
describe('query-aware rerank excerpts', () => {
  it.each(['start', 'middle', 'end'])('keeps evidence at the %s in a contiguous bounded window', position => {
    const evidence = '茶多酚的提取率并非随着温度升高一直增加，过高温度会导致氧化降解。';
    const text = position === 'start' ? evidence + filler : position === 'middle' ? filler + evidence + filler : filler + evidence;
    const excerpt = selectRerankExcerpt(text, '茶多酚提取率与温度有什么关系？', 300);
    expect(excerpt).toContain(evidence);
    expect(excerpt.length).toBeLessThanOrEqual(300);
    expect(text).toContain(excerpt);
  });
  it('handles English words and preserves a nearby negative qualification', () => {
    const evidence = 'Binary search does NOT work on arbitrary unsorted data: it needs monotonicity or a sorted sequence.';
    const text = 'This section discusses the layout and contents of the book. '.repeat(15) + evidence + filler;
    const excerpt = selectRerankExcerpt(text, 'Why does BINARY SEARCH need a sorted sequence?', 300);
    expect(excerpt).toContain(evidence);
  });
  it('does not let repeated occurrences of one term outrank distinct query terms', () => {
    const text = '提取率。'.repeat(100) + filler + '茶多酚提取率受温度影响，过热导致氧化降解。' + filler;
    expect(selectRerankExcerpt(text, '茶多酚提取率温度氧化', 300)).toContain('过热导致氧化降解');
  });
  it('retains the beginning when there is no literal evidence, without inventing a match', () => {
    expect(selectRerankExcerpt(filler, 'eigenvectors', 300)).toBe(filler.slice(0,300));
    expect(selectRerankExcerpt(filler, 'how and why?', 300)).toBe(filler.slice(0,300));
  });
  it('keeps short passages intact and handles empty/zero-sized inputs', () => {
    expect(selectRerankExcerpt('原文', '原文', 300)).toBe('原文');
    expect(selectRerankExcerpt('', 'query', 300)).toBe('');
    expect(selectRerankExcerpt(filler, '', 0)).toBe('');
  });
  it('only changes the prompt excerpt, preserving full candidate text and citation offsets', async () => {
    const evidence = '茶多酚提取率受温度影响，过热导致氧化降解。';
    const source: RetrievalCandidate = { chunkId: 'late', noteId: 'note', text: filler+evidence, score: 0.5, matchedBy: ['vector'], charStart: 1234 };
    const other = { ...source, chunkId: 'other', text: '其他资料' };
    let prompt = '';
    const router = new ModelRouter({ isAvailable: async () => true, complete: async (request: ModelCompletionRequest) => {
      prompt = request.prompt; return '{"order":[0,1]}';
    } });
    const result = await new ReRanker(router).rerank('茶多酚提取率与温度', [source, other], 2);
    expect(prompt).toContain(evidence);
    expect(prompt).not.toContain(source.text);
    expect(result?.[0]).toBe(source);
    expect(result?.[0].charStart).toBe(1234);
    expect(result?.[0].text).toBe(filler+evidence);
  });
});

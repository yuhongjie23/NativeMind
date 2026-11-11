import { describe, expect, it } from 'vitest';
import { SelfRag } from '@ai/rag/self-rag';
import { ModelRouter } from '@ai/router/model-router';
import { RetrievalStrategy, type RetrievalCandidate } from '@ai/rag/retrieval-strategy';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';
import { selectSourceExcerpt } from '@ai/rag/rerank-excerpt';

const acceptPairs = (request: { jsonSchema?: unknown; prompt: string }) =>
  (request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v2'
    ? JSON.stringify({ missing: '', verdict: 'supported' }) :
  (request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v1'
    ? JSON.stringify({ supported: (JSON.parse(request.prompt) as unknown[]).map(() => true) }) : undefined;

const quote = 'L7试验规定提取温度为43摄氏度，超过该温度会降低回收率。';
const claim = 'L7试验的提取温度为43摄氏度。';
const candidate = (text: string): RetrievalCandidate => ({ chunkId: 'c1', noteId: 'n1', text, charStart: 100, score: 0.8, matchedBy: ['rule'] });
async function answer(source: RetrievalCandidate, evidenceQuote = quote, query = 'L7试验提取温度', inspect?: (prompt: string) => void) {
  const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
    const paired = acceptPairs(request);
    if (paired) return paired;
    inspect?.(request.prompt);
    if (!request.json) return claim;
    const rows = [...request.prompt.matchAll(/^\((\d+)\) (.*)$/gm)];
    const first = rows.find(row => row[2].includes(evidenceQuote.split('\n\n')[0]));
    const last = evidenceQuote.includes('\n\n') ? rows.find(row => row[2].includes(evidenceQuote.split('\n\n')[1])) : first;
    return JSON.stringify({ relevance: 1, quality: 9, grounded: true,
      hallucination_risk: false, evidence: [{ source: 1, from: Number(first?.[1] ?? 9999), to: Number(last?.[1] ?? 9999), claim: 1 }], critique: '' });
  } });
  return new SelfRag(router, { retrieve: async () => [source] } as unknown as RAGOrchestrator).ask(query);
}

describe('QA uses the same bounded source view for generation and citation validation', () => {
  it('exposes late evidence to both calls and maps the quote back to the original offset', async () => {
    const source = candidate('记录版式与目录。'.repeat(230)+quote);
    let calls = 0;
    const result = await answer(source, quote, 'L7试验提取温度', prompt => {
      calls++; expect(prompt).toContain(quote);
    });
    expect(calls).toBe(2);
    expect(result.answer).toBe(`${claim} [1]`);
    expect(result.citations[0].charStart).toBe(100 + source.text.indexOf(quote));
    expect(source.charStart).toBe(100);
  });
  it('rejects a quote present in the full source but outside the shown excerpt', async () => {
    const text = '未提供的旧版本规定。' + '目录记录。'.repeat(400)+quote;
    const result = await answer(candidate(text), '未提供的旧版本规定');
    expect(result.citations).toEqual([]);
    expect(result.judged).toBe(false);
    expect(result.answer).toContain('证据核验未完成');
  });
  it('rejects ambiguous repeated quotes inside the shown excerpt', async () => {
    const result = await answer(candidate(quote+'另一条记录。'+quote));
    expect(result.citations).toEqual([]);
  });
  it('does not locate a late quote at an identical earlier occurrence outside the selected window', async () => {
    const repeated = '提取温度为43摄氏度';
    const source = candidate(`旧记录：${repeated}。`+'目录记录。'.repeat(400)+quote);
    const result = await answer(source, repeated);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].charStart).toBe(100+source.text.lastIndexOf(quote));
  });
  it('retains an explicit window offset instead of searching for its text again', () => {
    const text = '目录。'.repeat(500)+quote;
    const window = selectSourceExcerpt(text, 'L7试验提取温度', 1500);
    expect(window.offset).toBeGreaterThan(0);
    expect(window.text).toBe(text.slice(window.offset,window.offset+1500));
  });
  it('maps second-chunk evidence across a real source gap, not synthetic newlines', async () => {
    const first = 'L7试验的设备登记编号。';
    const second = '第二段背景。'+quote;
    const chunks = [first, second].map((text,i) => ({ chunkId: `c${i+1}`, noteId: 'n1', text,
      title: 'L7试验', tags: ['L7'], headingPath: ['试验'], charStart: i ? 100+first.length+40 : 100 }));
    const retrieval = new RetrievalStrategy({ version: 'test', embed: async () => [] }, { query: async () => [] });
    const merged = await retrieval.retrieve({ text: 'L7试验', tags: ['L7'], rerank: false }, chunks);
    // Equal rule scores keep source order, allowing these nearby chunks to be promoted.
    const promoted = merged.find(item => item.sourceSpans?.length === 2);
    expect(promoted).toBeDefined();
    const result = await answer(promoted!);
    expect(result.citations[0].charStart).toBe(chunks[1].charStart + second.indexOf(quote));
  });
  it('rejects quotes crossing a synthetic join even if they appear in the displayed context', async () => {
    const first = 'L7试验的设备记录。';
    const second = quote;
    const source = { ...candidate(first+'\n\n'+second), sourceSpans: [
      { start: 0, end: first.length, charStart: 100 },
      { start: first.length+2, end: first.length+2+second.length, charStart: 200 },
    ] };
    const result = await answer(source, first+'\n\n'+second);
    expect(result.citations).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { SelfRag, defaultSelfRagOptions } from '@ai/rag/self-rag';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';

const acceptPairs = (request: { jsonSchema?: unknown; prompt: string }) =>
  (request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v2'
    ? JSON.stringify({ missing: '', verdict: 'supported' }) :
  (request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v1'
    ? JSON.stringify({ supported: (JSON.parse(request.prompt) as unknown[]).map(() => true) }) : undefined;

const text = 'The extraction temperature is 43 degrees Celsius.';
const rag = { retrieve: async () => [{ chunkId: 'c1', noteId: 'n1', text, score: 1, matchedBy: ['rule'], charStart: 10 }] } as unknown as RAGOrchestrator;
const valid = { relevance: 1, quality: 9, grounded: true, hallucination_risk: false,
  evidence: [{ source: 1, from: 1, to: 1, claim: 1 }], critique: '' };

describe('bounded QA requests preserve evidence checks', () => {
  it('shows a supported claim once while retaining all of its source references', async () => {
    const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
      return acceptPairs(request) ?? (request.json ? JSON.stringify({ ...valid, evidence: [
        { source: 1, from: 1, to: 1, claim: 1 }, { source: 2, from: 1, to: 1, claim: 1 },
      ] }) : text);
    } });
    const sources = await rag.retrieve({ text: 'temperature' });
    const twoSources = { retrieve: async () => [sources[0], { ...sources[0], chunkId: 'c2', noteId: 'n2' }] } as unknown as RAGOrchestrator;
    const result = await new SelfRag(router, twoSources).ask('temperature');
    expect(result.answer).toBe(`${text} [1] [2]`);
    expect(result.citations).toHaveLength(2);
  });
  it('repairs a pair-check failure once and rechecks the new answer', async () => {
    let generations = 0;
    let checks = 0;
    const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
      if ((request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v1') {
        return JSON.stringify({ supported: [++checks > 1] });
      }
      const paired = acceptPairs(request); if (paired) return paired;
      if (request.json) return JSON.stringify(valid);
      generations++;
      if (generations === 2) expect(request.prompt).toContain('Remove unsupported');
      return generations === 1 ? 'The extraction temperature is 99 degrees Celsius.' : text;
    } });
    const result = await new SelfRag(router, rag).ask('temperature', { language: 'en' });
    expect(generations).toBe(2);
    expect(checks).toBe(2);
    expect(result.regenerated).toBe(true);
    expect(result.answer).toContain('43');
    expect(result.answer).not.toContain('99');
    expect(result.citations[0].text).toBe(text);
  });
  it.each([JSON.stringify({ supported: [false] }), JSON.stringify({ supported: [] }), '{broken']) (
    'rejects selected evidence when pair checking fails or is incomplete: %s', async output => {
      const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
        if ((request.jsonSchema as { $id?: string } | undefined)?.$id === 'qa-evidence-check.v1') return output;
        return request.json ? JSON.stringify(valid) : text;
      } });
      const result = await new SelfRag(router, rag).ask('temperature');
      expect(result.citations).toEqual([]);
      expect(result.answer).not.toContain('43');
      expect(result.confidence).toBe(0);
    });
  it.each(['qa-evidence-check.v1', 'qa-evidence-check.v2'])(
    'shares one deadline across selection and pair checking and aborts %s', async schema => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let signal: AbortSignal | undefined;
      const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
        if ((request.jsonSchema as { $id?: string } | undefined)?.$id === schema) {
          signal = request.signal;
          return new Promise<string>((_, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }));
        }
        const paired = acceptPairs(request); if (paired) return paired;
        if (request.json) { await new Promise(resolve => setTimeout(resolve, 30)); return JSON.stringify(valid); }
        return text;
      } });
      const pending = new SelfRag(router, rag, { ...defaultSelfRagOptions, criticTimeoutMs: 50 }).ask('temperature');
      await vi.advanceTimersByTimeAsync(55);
      const result = await pending;
      expect(signal?.aborted).toBe(true);
      expect(result.judged).toBe(false);
      expect(result.citations).toEqual([]);
    } finally { warn.mockRestore(); vi.useRealTimers(); }
  });
  it('maps short source labels to the correct document and rejects out-of-range IDs', async () => {
    const sources = [
      { chunkId: 'actual-second-db-id', noteId: 'n2', text: 'This source contains unrelated facts.', score: 1, charStart: 500 },
      { chunkId: 'actual-first-db-id', noteId: 'n1', text, score: 1, charStart: 70 },
    ];
    let label: number | string = 2;
    const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
      const paired = acceptPairs(request); if (paired) return paired;
      expect(request.prompt).not.toContain('actual-first-db-id');
      expect(request.prompt).toContain('[c2]');
      return request.json ? JSON.stringify({ ...valid, evidence: [{ source: label, from: 1, to: 1, claim: 1 }] }) : text;
    } });
    const qa = new SelfRag(router, { retrieve: async () => sources } as unknown as RAGOrchestrator);
    expect((await qa.ask('temperature')).citations[0]).toMatchObject({ chunkId: 'actual-first-db-id', noteId: 'n1', charStart: 70 });
    label = 3;
    expect((await qa.ask('temperature')).citations).toEqual([]);
    label = 'actual-first-db-id';
    expect((await qa.ask('temperature')).citations).toEqual([]);
  });
  it('passes generation and review budgets to the provider and returns exact evidence', async () => {
    const calls: ModelCompletionRequest[] = [];
    const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
      calls.push(request); return acceptPairs(request) ?? (request.json ? JSON.stringify(valid) : text);
    } });
    const result = await new SelfRag(router, rag).ask('What is the temperature?', { language: 'en' });
    expect(calls.map(c => [c.maxTokens, c.temperature])).toEqual([[512, 0], [512, 0], [64, 0], [128, 0]]);
    expect(result.citations[0]).toMatchObject({ text, supportingClaim: text, charStart: 10 });
    expect(result.judged).toBe(true);
  });
  it.each(['{truncated', JSON.stringify({ ...valid, evidence: [{ source: 1, from: 99, to: 99, claim: 1 }] })])(
    'does not retry or publish unsupported output after a bad review: %s', async output => {
      const complete = vi.fn(async (request: ModelCompletionRequest) => request.json ? output : text);
      const router = new ModelRouter({ isAvailable: async () => true, complete });
      const result = await new SelfRag(router, rag).ask('temperature', { language: 'en' });
      expect(complete).toHaveBeenCalledTimes(2);
      expect(result.citations).toEqual([]);
      expect(result.confidence).toBe(0);
      expect(result.answer).not.toContain('43');
      expect(result.judged).toBe(false);
      expect(result.answer).toContain('Evidence verification could not be completed');
    });
  it('aborts a timed-out review and does not silently accept the draft', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let reviewSignal: AbortSignal | undefined;
      const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
        if (!request.json) return text;
        reviewSignal = request.signal;
        return new Promise<string>((_, reject) => request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true }));
      } });
      const pending = new SelfRag(router, rag, { ...defaultSelfRagOptions, criticTimeoutMs: 50 }).ask('temperature', { language: 'en' });
      await vi.advanceTimersByTimeAsync(60);
      const result = await pending;
      expect(reviewSignal?.aborted).toBe(true);
      expect(result.judged).toBe(false);
      expect(result.citations).toEqual([]);
      expect(result.answer).toContain('Evidence verification could not be completed');
    } finally { warn.mockRestore(); vi.useRealTimers(); }
  });
});

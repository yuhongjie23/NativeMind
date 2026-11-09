import { describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '@ai/router/model-router';
import { LinkHydeGenerator } from '@ai/rag/link-hyde';
import { KnowledgeLinkSuggestionAdapter, SearchResultEnhancerAdapter, SocraticQuestionAdapter } from '@ai/adapters';
import type { ModelCompletionRequest } from '@ai/types';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';

describe('knowledge generation cancellation', () => {
  it('HyDE timeout aborts the actual model request before falling back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const router = new ModelRouter({ isAvailable: async () => true, complete: async request => {
      signal = request.signal;
      return new Promise<string>((_, reject) => signal?.addEventListener('abort', () => reject(signal?.reason)));
    } });
    try {
      const result = await new LinkHydeGenerator(router, 5).generate('A sufficiently long note about spaced repetition and active recall.', ['learning']);
      expect(result.tags).toContain('learning');
      expect(signal?.aborted).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it('cancelled HyDE does not proceed to retrieval or fallback suggestions', async () => {
    const controller = new AbortController();
    const complete = vi.fn(async (request: ModelCompletionRequest) => {
      controller.abort();
      expect(request.signal?.aborted).toBe(true);
      return '{"tags":[],"topics":[]}';
    });
    const findConnections = vi.fn();
    const adapter = new KnowledgeLinkSuggestionAdapter({ findConnections } as unknown as RAGOrchestrator,
      new LinkHydeGenerator(new ModelRouter({ isAvailable: async () => true, complete })));
    await expect(adapter.suggestForNote('A sufficiently long note about spaced repetition.', [], 3, [], { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(findConnections).not.toHaveBeenCalled();
  });

  it('stopping a summary batch prevents later batches and ranking', async () => {
    const controller = new AbortController();
    const complete = vi.fn(async () => { controller.abort(); return 'summary'; });
    const adapter = new SearchResultEnhancerAdapter(new ModelRouter({ isAvailable: async () => true, complete }));
    await expect(adapter.enhance(Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: 'title', text: 'note' })), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(complete.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('cancelled Socratic retrieval does not silently continue to a model question', async () => {
    const controller = new AbortController();
    const run = vi.fn();
    const rag = { retrieve: vi.fn(async () => { controller.abort(); throw controller.signal.reason; }) } as unknown as RAGOrchestrator;
    await expect(new SocraticQuestionAdapter({ run } as unknown as ModelRouter, rag).askQuestion({ topic: 'learning', history: [] }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
  });
});

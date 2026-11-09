import { describe, expect, it, vi } from 'vitest';
import { withModelDeadline } from '@ai/shared/model-deadline';
import { ModelRouter } from '@ai/router/model-router';
import { SelfRag, defaultSelfRagOptions } from '@ai/rag/self-rag';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';
import type { ModelCompletionRequest } from '@ai/types';
import { createTauriRuntime } from '@infrastructure/tauri-runtime';

describe('model cancellation', () => {
  it('wires the full desktop/Anna ask use case to the real deep-QA adapter', async () => {
    const runtime = createTauriRuntime({ invoke: async () => { throw new Error('unexpected IO'); }, confirmationPrompt: async () => false });
    const answer = { answer: 'connected', citations: [], confidence: 1, judged: true, regenerated: false, empty: false, ok: true };
    const ask = vi.spyOn(runtime.ai.ports.deepQA, 'ask').mockResolvedValue(answer);
    const controller = new AbortController();
    expect(await runtime.application.useCases.askNotes.execute('question', { signal: controller.signal })).toEqual(answer);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ question: 'question', signal: controller.signal }));
  });
  it('aborts the underlying request when its deadline expires', async () => {
    let signal: AbortSignal | undefined;
    await expect(withModelDeadline(s => { signal = s; return new Promise(() => {}); }, 5, '生成')).rejects.toThrow('生成超时');
    expect(signal?.aborted).toBe(true);
  });

  it('does not retry, fall back, record output or emit late tokens after cancellation', async () => {
    const controller = new AbortController();
    const preview = vi.fn();
    const record = vi.fn();
    const complete = vi.fn(async (request: ModelCompletionRequest) => {
      request.onToken?.('第一段');
      controller.abort();
      request.onToken?.('迟到的内容');
      throw new Error('connection closed');
    });
    const router = new ModelRouter({ isAvailable: async () => true, complete }, { recorder: { record } });
    await expect(router.run({ taskType: 'deep_qa_generate', input: {}, inlinePrompt: { user: 'question' },
      signal: controller.signal, onToken: preview })).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(preview.mock.calls).toEqual([['第一段', undefined]]);
  });

  it('cancels a full answer during generation without starting criticism', async () => {
    const controller = new AbortController();
    const complete = vi.fn((request: ModelCompletionRequest) => new Promise<string>((_, reject) => {
      request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
      request.onToken?.('草稿');
    }));
    const rag = { retrieve: async () => [{ chunkId: 'c', noteId: 'n', text: 'test', score: 1, matchedBy: ['rule'] }] } as unknown as RAGOrchestrator;
    const self = new SelfRag(new ModelRouter({ isAvailable: async () => true, complete }), rag);
    await expect(self.ask('question', { signal: controller.signal, onToken: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('aborts timed-out generation and returns the established excerpt fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const complete = vi.fn((request: ModelCompletionRequest) => {
      signal = request.signal;
      return new Promise<string>((_, reject) => request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true }));
    });
    const rag = { retrieve: async () => [{ chunkId: 'c', noteId: 'n', text: 'original excerpt', score: 1, matchedBy: ['rule'] }] } as unknown as RAGOrchestrator;
    try {
      const self = new SelfRag(new ModelRouter({ isAvailable: async () => true, complete }), rag, { ...defaultSelfRagOptions, generateTimeoutMs: 5 });
      expect(await self.ask('question')).toMatchObject({ ok: false, answer: 'original excerpt' });
      expect(signal?.aborted).toBe(true);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
});

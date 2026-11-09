import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '@infrastructure/model-runtime/ollama-provider';

const request = { model: 'qwen3:14b', prompt: 'synthetic test' };
describe('Ollama request lifecycle', () => {
  it('already cancelled requests never reach the service', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OllamaProvider({ fetchImpl });
    await expect(provider.complete({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.embed(['test'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['plain', 'stream', 'embedding'])('cancellation after headers aborts body consumption: %s', async mode => {
    const controller = new AbortController();
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    let networkSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      networkSignal = init?.signal;
      return new Response(new ReadableStream({ start(stream) {
        networkSignal?.addEventListener('abort', () => stream.error(networkSignal?.reason), { once: true });
        started();
      } }));
    };
    const provider = new OllamaProvider({ fetchImpl });
    const result = mode === 'embedding' ? provider.embed(['a', 'b'], controller.signal)
      : provider.complete({ ...request, signal: controller.signal, onToken: mode === 'stream' ? () => {} : undefined });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await ready; controller.abort(); await rejected;
    expect(networkSignal?.aborted).toBe(true);
  });
  it.each([false, true])('deadline covers a stalled body after headers (stream=%s)', async streaming => {
    const fetchImpl: typeof fetch = async (_url, init) => new Response(new ReadableStream({ start(stream) {
      init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason), { once: true });
    } }));
    const provider = new OllamaProvider({ fetchImpl, timeoutMs: 25 });
    await expect(provider.complete({ ...request, onToken: streaming ? () => {} : undefined })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
  const response = (text: string) => new Response(text);
  it('cancelling in the first callback suppresses later buffered output', async () => {
    const controller = new AbortController(); const tokens: string[] = [];
    const provider = new OllamaProvider({ fetchImpl: async () => response('{"response":"first"}\n{"response":"second","done":true}\n') });
    await expect(provider.complete({ ...request, signal: controller.signal,
      onToken: token => { tokens.push(token); controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(tokens).toEqual(['first']);
  });
  it.each([
    ['{"response":"partial"}\n', '输出中断'],
    ['{"response":"partial"}\n{"error":"model failed"}\n', 'model failed'],
    ['{"response":"partial"}\nnot json\n', 'JSON'],
  ])('does not accept incomplete or broken NDJSON: %s', async (body, error) => {
    const provider = new OllamaProvider({ fetchImpl: async () => response(body) });
    await expect(provider.complete({ ...request, onToken: () => {} })).rejects.toThrow(error);
  });
  it('callback failures propagate instead of being treated as JSON noise', async () => {
    const provider = new OllamaProvider({ fetchImpl: async () => response('{"response":"hello","done":true}\n') });
    await expect(provider.complete({ ...request, onToken: () => { throw new Error('consumer failed'); } })).rejects.toThrow('consumer failed');
  });
  it('terminal frame ends reading without waiting for connection EOF', async () => {
    const cancelled = vi.fn();
    const provider = new OllamaProvider({ fetchImpl: async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"response":"完成","done":true}\n')); }, cancel: cancelled,
    })) });
    expect(await provider.complete({ ...request, onToken: () => {} })).toBe('完成');
    expect(cancelled).toHaveBeenCalledOnce();
  });
});

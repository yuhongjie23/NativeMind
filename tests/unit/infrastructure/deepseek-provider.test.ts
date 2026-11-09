/**
 * DeepSeekProvider 单测
 *
 * mock fetch 验证：complete 请求体、鉴权头、JSON 模式、流式解析、
 * isAvailable（key 有无）、isReady（/models 探活）、档位映射。
 * 不真连 DeepSeek 服务器。
 */
import { describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '@infrastructure/model-runtime/deepseek-provider';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 可编程 fetch：记录请求，返回预设响应 */
const fakeFetch = (respond: (url: string, init: RequestInit) => Response) =>
  ((url: string, init?: RequestInit) => {
    const captured = { url, init };
    const response = respond(url, init as RequestInit);
    Object.defineProperty(response, '__captured', { value: captured });
    return Promise.resolve(response);
  }) as typeof fetch;

describe('DeepSeekProvider', () => {
  it('isAvailable 只认「已配置 key」', async () => {
    const empty = new DeepSeekProvider({});
    expect(await empty.isAvailable('deepseek-v4-flash')).toBe(false);

    const withKey = new DeepSeekProvider({ apiKey: 'sk-test' });
    expect(await withKey.isAvailable('deepseek-v4-flash')).toBe(true);
  });

  it('isReady 打 /models 验证 key 有效（401 = 无效）', async () => {
    const ok = new DeepSeekProvider({
      apiKey: 'sk-good',
      fetchImpl: fakeFetch(() => okJson({ data: [] })),
    });
    expect(await ok.isReady()).toBe(true);

    const bad = new DeepSeekProvider({
      apiKey: 'sk-bad',
      fetchImpl: fakeFetch(() => new Response('{}', { status: 401 })),
    });
    expect(await bad.isReady()).toBe(false);
  });

  it('complete 走 chat/completions，带 Bearer 鉴权', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const provider = new DeepSeekProvider({
      apiKey: 'sk-secret',
      fetchImpl: fakeFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return okJson({ choices: [{ message: { content: '完成了' } }] });
      }),
    });

    const text = await provider.complete({
      model: 'deepseek-v4-flash',
      prompt: '你好',
      system: '你是教练',
    });

    expect(capturedUrl).toContain('https://api.deepseek.com/v1/chat/completions');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(text).toBe('完成了');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[0]).toMatchObject({ role: 'system', content: '你是教练' });
    expect(body.messages[1]).toMatchObject({ role: 'user', content: '你好' });
  });

  it('v4-pro 档位映射到 deepseek-v4-pro', async () => {
    let sentModel = '';
    const provider = new DeepSeekProvider({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch((_url, init) => {
        sentModel = JSON.parse(String(init?.body)).model;
        return okJson({ choices: [{ message: { content: 'ok' } }] });
      }),
    });

    await provider.complete({ model: 'deepseek-v4-pro', prompt: 'x' });
    expect(sentModel).toBe('deepseek-v4-pro');
  });

  it('思考模式开启时请求带 thinking 参数', async () => {
    let body: Record<string, unknown> = {};
    const provider = new DeepSeekProvider({
      apiKey: 'sk-x',
      thinking: true,
      fetchImpl: fakeFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return okJson({ choices: [{ message: { content: 'ok' } }] });
      }),
    });

    await provider.complete({ model: 'deepseek-v4-pro', prompt: 'x' });
    expect(body.thinking).toEqual({ type: 'enabled' });
  });

  it('json 模式带 response_format json_object', async () => {
    let body: Record<string, unknown> = {};
    const provider = new DeepSeekProvider({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return okJson({ choices: [{ message: { content: '{"a":1}' } }] });
      }),
    });

    await provider.complete({ model: 'deepseek-v4-flash', prompt: 'x', json: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('将结构规范发给云端，覆盖 JSON 模式和流式 JSON 模式', async () => {
    const schema = { type: 'object', required: ['grounded'], properties: { grounded: { type: 'boolean' } } };
    for (const streaming of [false, true]) {
      let messages: { role: string; content: string }[] = [];
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch((_url, init) => {
        messages = JSON.parse(String(init.body)).messages;
        return streaming ? new Response('data: [DONE]\n\n') : okJson({ choices: [{ message: { content: '{"grounded":true}' } }] });
      }) });
      await provider.complete({ model: 'deepseek-v4-flash', system: '只按资料评判', prompt: '待评回答', json: true, jsonSchema: schema,
        onToken: streaming ? () => undefined : undefined,
      });
      expect(messages[0]).toEqual({ role: 'system', content: expect.stringContaining(JSON.stringify(schema)) });
      expect(messages[0].content).toContain('只按资料评判');
      expect(messages[1]).toEqual({ role: 'user', content: '待评回答' });
    }
  });

  it('流式解析 SSE 增量并触发 onToken', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    // 构造可读流 Response
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const provider = new DeepSeekProvider({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch(() => new Response(stream)),
    });

    const tokens: string[] = [];
    const full = await provider.complete({
      model: 'deepseek-v4-flash',
      prompt: 'x',
      onToken: (delta) => tokens.push(delta),
    });

    expect(tokens).toEqual(['你', '好']);
    expect(full).toBe('你好');
  });

  it('未配 key 时 complete 抛错', async () => {
    const provider = new DeepSeekProvider({});
    await expect(provider.complete({ model: 'deepseek-v4-flash', prompt: 'x' })).rejects.toThrow(
      /API key/
    );
  });

  it('取消前的请求不联网，未配 key 的流式请求也不联网', async () => {
    const fetchImpl = vi.fn();
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', fetchImpl });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.complete({ model: 'deepseek-v4-flash', prompt: 'x', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const empty = new DeepSeekProvider({ fetchImpl });
    await expect(empty.complete({ model: 'deepseek-v4-flash', prompt: 'x', onToken: () => undefined })).rejects.toThrow(/API key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('响应头之后取消，仍中止非流式响应体读取', async () => {
    const controller = new AbortController();
    let bodyStarted!: () => void;
    const ready = new Promise<void>(resolve => { bodyStarted = resolve; });
    let networkSignal: AbortSignal | undefined;
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch((_url, init) => {
      networkSignal = init.signal!;
      return new Response(new ReadableStream({ start(stream) {
        init.signal!.addEventListener('abort', () => stream.error(init.signal!.reason), { once: true });
        bodyStarted();
      } }));
    }) });
    const request = provider.complete({ model: 'deepseek-v4-flash', prompt: 'x', signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    controller.abort();
    await rejected;
    expect(networkSignal?.aborted).toBe(true);
  });

  it('取消流式输出后不再发出已缓冲的后续文字', async () => {
    const controller = new AbortController();
    const tokens: string[] = [];
    const cancelled = vi.fn();
    const provider = new DeepSeekProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch(() => new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"一"}}]}\n\ndata: {"choices":[{"delta":{"content":"二"}}]}\n\n')); },
      cancel: cancelled,
    }))) });
    await expect(provider.complete({ model: 'deepseek-v4-flash', prompt: 'x', signal: controller.signal,
      onToken: delta => { tokens.push(delta); controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(tokens).toEqual(['一']);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('超时覆盖收到响应头之后的等待', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', timeoutMs: 50, fetchImpl: fakeFetch((_url, init) => new Response(new ReadableStream({
        start(stream) { init.signal!.addEventListener('abort', () => stream.error(init.signal!.reason), { once: true }); },
      }))) });
      const request = provider.complete({ model: 'deepseek-v4-flash', prompt: 'x', onToken: () => undefined });
      const rejected = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});

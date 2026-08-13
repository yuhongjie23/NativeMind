/**
 * 模型运行时流式输出测试
 *
 * 用 fake fetch 返回带 ReadableStream 的 Response，验证：
 * - OllamaProvider：NDJSON 逐行解析，增量按序回调，最终拼全文
 * - LlamaCppProvider：SSE 事件解析，同上
 * - 不带 onToken 时走原非流式路径（一次性 JSON）
 */
import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '@infrastructure/model-runtime/ollama-provider';
import { LlamaCppProvider } from '@infrastructure/model-runtime/llama-cpp-provider';
import type { ModelCompletionRequest } from '@ai/types';

const streamResponse = (lines: string[]): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
};

describe('OllamaProvider 流式', () => {
  const request: ModelCompletionRequest = {
    model: 'qwen2.5:7b',
    prompt: '你好',
  };

  it('NDJSON 逐行解析：增量按序回调，返回拼好的全文', async () => {
    const deltas: string[] = [];
    const fetchImpl = async () =>
      streamResponse([
        '{"response":"LoRA","done":false}\n',
        '{"response":" 是","done":false}\n',
        '{"done":true,"response":""}\n',
      ]);

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', fetchImpl });
    const full = await provider.complete({ ...request, onToken: (d) => deltas.push(d) });

    expect(deltas).toEqual(['LoRA', ' 是']);
    expect(full).toBe('LoRA 是');
  });

  it('跨 chunk 的半行被缓冲拼接，结尾残行也处理', async () => {
    const deltas: string[] = [];
    const fetchImpl = async () =>
      streamResponse(['{"response":"L', 'oRA"}', '\n{"response":" 是","done":true}\n']);

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', fetchImpl });
    const full = await provider.complete({ ...request, onToken: (d) => deltas.push(d) });

    expect(deltas).toEqual(['LoRA', ' 是']);
    expect(full).toBe('LoRA 是');
  });

  it('不带 onToken 走非流式路径，一次性返回 JSON', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ response: '全文结果' }), { status: 200 });

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', fetchImpl });
    const full = await provider.complete(request);

    expect(full).toBe('全文结果');
  });
});

describe('LlamaCppProvider 流式', () => {
  const request: ModelCompletionRequest = {
    model: 'llama-server',
    prompt: '你好',
  };

  it('SSE 解析：choices[0].delta.content 增量回调，结束标记忽略', async () => {
    const deltas: string[] = [];
    const fetchImpl = async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"LoRA"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" 是"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);

    const provider = new LlamaCppProvider({ baseUrl: 'http://localhost:8080', fetchImpl });
    const full = await provider.complete({ ...request, onToken: (d) => deltas.push(d) });

    expect(deltas).toEqual(['LoRA', ' 是']);
    expect(full).toBe('LoRA 是');
  });
});

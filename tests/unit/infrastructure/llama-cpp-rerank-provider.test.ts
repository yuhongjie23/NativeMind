/**
 * llama.cpp 专用重排（cross-encoder）Provider 测试
 */
import { describe, expect, it } from 'vitest';
import { LlamaCppRerankProvider } from '@infrastructure/model-runtime/llama-cpp-rerank-provider';

describe('LlamaCppRerankProvider', () => {
  it('按 index 对齐返回分数（顺序与 docs 一致）', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        }),
        { status: 200 }
      );

    const provider = new LlamaCppRerankProvider({ baseUrl: 'http://localhost:8080', fetchImpl });
    const scores = await provider.rerank('LoRA', ['第一段', '第二段']);

    expect(scores).toEqual([0.2, 0.9]);
  });

  it('空文档直接返回空，不发请求', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };

    const provider = new LlamaCppRerankProvider({ fetchImpl });
    expect(await provider.rerank('q', [])).toEqual([]);
    expect(called).toBe(false);
  });

  it('服务端非 2xx 抛错（由调用方回退生成式重排）', async () => {
    const fetchImpl = async () => new Response('err', { status: 500 });

    const provider = new LlamaCppRerankProvider({ fetchImpl });
    await expect(provider.rerank('q', ['a'])).rejects.toThrow('返回 500');
  });

  it('拒绝远端地址（C6 本地优先）', () => {
    expect(() => new LlamaCppRerankProvider({ baseUrl: 'http://evil.example.com' })).toThrow(
      '只允许连本机'
    );
  });
});

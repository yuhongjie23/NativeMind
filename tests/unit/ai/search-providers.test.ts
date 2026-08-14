/**
 * 外部搜索 Provider 测试
 *
 * 覆盖 Google Custom Search API 的 JSON 解析（成功/错误/空结果），
 * 以及 createSearchProvider 的引擎选择（google 未配 key 时报错、bing 正常）。
 */
import { describe, expect, it } from 'vitest';
import {
  createSearchProvider,
  type HttpFetcher,
} from '@ai/search/search-providers';
import type { SearchEngineConfig } from '@shared-types/search-config';

/** 造一个返回预设文本的 HttpFetcher */
const fakeHttp = (text: string): HttpFetcher => ({
  fetchText: async () => text,
});

describe('Google Custom Search API Provider', () => {
  const googleConfig: SearchEngineConfig = {
    id: 'google',
    googleApiKey: 'test-key',
    googleCx: 'test-cx',
  };

  it('解析正常结果（title/link/snippet/site）', async () => {
    const provider = createSearchProvider(
      googleConfig,
      fakeHttp(
        JSON.stringify({
          items: [
            {
              title: 'LoRA 低秩分解',
              link: 'https://example.com/lora',
              snippet: '关于 LoRA 的说明',
              displayLink: 'example.com',
            },
            {
              title: 'QLoRA 量化',
              link: 'https://example.org/qlora',
              snippet: 'QLoRA 方案',
            },
          ],
        })
      )
    );

    const { results, reason } = await provider.search('LoRA', 5);

    expect(reason).toBeUndefined();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: 'LoRA 低秩分解',
      url: 'https://example.com/lora',
      snippet: '关于 LoRA 的说明',
      site: 'example.com',
    });
  });

  it('API 返回 error 对象时给出可读原因', async () => {
    const provider = createSearchProvider(
      googleConfig,
      fakeHttp(
        JSON.stringify({
          error: { code: 403, message: 'Requests from this client are blocked' },
        })
      )
    );

    const { results, reason } = await provider.search('x', 5);
    expect(results).toEqual([]);
    expect(reason).toBeTruthy();
  });

  it('超限（429）时提示额度', async () => {
    const http: HttpFetcher = {
      fetchText: async () => {
        throw new Error('HTTP 429');
      },
    };
    const provider = createSearchProvider(googleConfig, http);

    const { reason } = await provider.search('x', 5);
    expect(reason).toContain('额度');
  });

  it('空结果返回 reason 且不抛错', async () => {
    const provider = createSearchProvider(googleConfig, fakeHttp(JSON.stringify({ items: [] })));
    const { results, reason } = await provider.search('x', 5);
    expect(results).toEqual([]);
    expect(reason).toBeTruthy();
  });
});

describe('createSearchProvider 引擎选择', () => {
  it('google 未配置 key/CX 时报错（引导用户去设置）', () => {
    expect(() =>
      createSearchProvider({ id: 'google' }, fakeHttp('{}'))
    ).toThrow(/API key/);
  });

  it('bing 正常创建（无需配置）', async () => {
    const provider = createSearchProvider(
      { id: 'bing' },
      fakeHttp('<li class="b_algo"><h2><a href="https://e.com/a">标题</a></h2></li>')
    );
    const { results } = await provider.search('x', 5);
    expect(Array.isArray(results)).toBe(true);
  });
});

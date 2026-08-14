/**
 * 外部搜索引擎 Provider 实现
 *
 * 只保留两个能稳定工作的引擎：
 * - Bing：抓 HTML 结果页（对无 JS 客户端最宽容，无 key 可用）
 * - Google：Custom Search JSON API（稳定无反爬，但需要 API key + 搜索引擎 ID）
 *
 * 其余引擎（DuckDuckGo / 百度 / 自定义 URL）对纯 HTTP 客户端反爬严重已移除。
 * C6：只发关键词，不带笔记原文。结果临时保留，用户选中的才落库。
 */
import type { RawSearchResult } from './result-filter';
import type { ProviderResult, SearchProvider } from './search-gate';
import type { SearchEngineConfig } from '@shared-types/search-config';

/* ---------- HTTP 抓取端口 ---------- */

/** 绕开 WebView CORS 的 HTTP 通道。Tauri 通过 invoke 调 Rust 命令；浏览器降级为直接 fetch */
export interface HttpFetcher {
  fetchText(url: string): Promise<string>;
}

/* ---------- HTML 解析工具 ---------- */

/**
 * 验证页强标记。普通结果页里也可能出现 `challenge`/`captcha` 字样（脚本、
 * 文案），单独命中会误判成反爬；只有命中这些**结构性**标记才算验证页。
 */
const BLOCKED_PAGE_MARKERS = [
  // Bing 验证码页的特征容器 / 表单
  'id="b_pole"',
  'id="PuzzleChannel"',
  'class="captcha"',
  // 明确的人机验证标题
  '<title>验证码',
  '<title>Captcha',
  // CAPTCHA 表单按钮
  'name="Captcha"',
];

/** 反爬验证页：命中强标记才判定（结果页里偶发的 challenge 字样不算） */
const isBlockedPage = (html: string): boolean =>
  BLOCKED_PAGE_MARKERS.some((marker) => html.includes(marker));

/** 去掉 HTML 标签，保留文本 */
const stripTags = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, (entity) => {
    const map: Record<string, string> = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&#x27;': "'", '&nbsp;': ' ', '&rsquo;': "'", '&ldquo;': '"',
      '&rdquo;': '"', '&mdash;': '—', '&ndash;': '–', '&#39;': "'",
    };
    return map[entity.toLowerCase()] ?? entity;
  }).replace(/\s+/g, ' ').trim();

/** 尝试从相对路径或跳转链接中还原绝对 URL */
const resolveUrl = (raw: string, baseHost: string): string => {
  let trimmed = raw.trim();
  const urlMatch = trimmed.match(/[?&](?:url|u|q|to)=([^&]+)/i);
  if (urlMatch) {
    try {
      trimmed = decodeURIComponent(urlMatch[1]);
    } catch { /* 解码失败用原值 */ }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://${baseHost}${trimmed}`;
  return `https://${baseHost}/${trimmed}`;
};

/* ---------- Bing Provider ---------- */

class BingProvider implements SearchProvider {
  constructor(private readonly http: HttpFetcher) {}

  async search(query: string, limit: number): Promise<ProviderResult> {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`;
      const html = await this.http.fetchText(url);
      const results = parseBingHtml(html, limit);
      // 有结果直接返回；没结果再判断是否验证页（避免误报）或纯结构变化
      if (results.length > 0) return { results };
      if (isBlockedPage(html)) {
        return { results: [], reason: 'Bing 返回了反爬验证页，可能被限流' };
      }
      return { results, reason: 'Bing 没有返回可解析的结果（结构变化或反爬）' };
    } catch (error) {
      console.warn('[Bing] 搜索失败:', error);
      return { results: [], reason: 'Bing 搜索请求失败' };
    }
  }
}

/** Bing 搜索结果：提取 h2 标题 + 链接 + 摘要 */
const BING_RESULT_RE = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
const BING_TITLE_RE = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
const BING_SNIPPET_RE = /<p[^>]*class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>|<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i;

function parseBingHtml(html: string, limit: number): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const blocks = html.matchAll(BING_RESULT_RE);

  for (const block of blocks) {
    if (results.length >= limit) break;

    const body = block[1];
    const titleMatch = body.match(BING_TITLE_RE);
    if (!titleMatch) continue;

    const url = resolveUrl(titleMatch[1], 'www.bing.com');
    const title = stripTags(titleMatch[2]);
    if (!title) continue;

    const snippetMatch = body.match(BING_SNIPPET_RE);
    const snippet = snippetMatch ? stripTags(snippetMatch[1] || snippetMatch[2] || '') : undefined;

    results.push({ title, url, snippet, site: extractHost(url) });
  }

  return results;
}

/* ---------- Google Custom Search JSON API Provider ---------- */

/**
 * Google Custom Search JSON API：官方接口，稳定无反爬。
 * 需要用户配置：API key（Google Cloud）+ 搜索引擎 ID（CX，Programmable Search Engine）。
 * 免费额度 100 次/天，个人学习够用。
 */
class GoogleApiProvider implements SearchProvider {
  constructor(
    private readonly http: HttpFetcher,
    private readonly apiKey: string,
    private readonly cx: string
  ) {}

  async search(query: string, limit: number): Promise<ProviderResult> {
    try {
      const url =
        `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.apiKey)}` +
        `&cx=${encodeURIComponent(this.cx)}&q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}`;
      const json = await this.http.fetchText(url);
      return parseGoogleApiJson(json, limit);
    } catch (error) {
      console.warn('[Google API] 搜索失败:', error);
      return {
        results: [],
        reason: error instanceof Error && error.message.includes('429')
          ? 'Google API 超出免费额度（100 次/天）'
          : 'Google API 请求失败（检查 key/CX 是否正确）',
      };
    }
  }
}

/** 解析 Google Custom Search API 返回的 JSON */
function parseGoogleApiJson(json: string, limit: number): ProviderResult {
  try {
    const data = JSON.parse(json) as {
      items?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        displayLink?: string;
      }>;
      error?: { code?: number; message?: string };
    };

    if (data.error) {
      const message = data.error.message ?? '';
      return {
        results: [],
        reason: message.includes('API key') || message.includes('key')
          ? 'Google API key 无效'
          : `Google API 返回错误：${message}`,
      };
    }

    const results = (data.items ?? [])
      .filter((item) => item.title && item.link)
      .slice(0, limit)
      .map<RawSearchResult>((item) => ({
        title: item.title!,
        url: item.link!,
        snippet: item.snippet || undefined,
        site: item.displayLink || extractHost(item.link!),
      }));

    return {
      results,
      reason: results.length === 0 ? 'Google 没有返回结果' : undefined,
    };
  } catch (error) {
    console.warn('[Google API] JSON 解析失败:', error);
    return { results: [], reason: 'Google API 返回了无法解析的数据' };
  }
}

/* ---------- 工具函数 ---------- */

function extractHost(url: string): string {
  try {
    const match = url.match(/^https?:\/\/([^/?#]+)/i);
    return match ? match[1].replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/* ---------- 工厂 ---------- */

export function createSearchProvider(
  config: SearchEngineConfig,
  http: HttpFetcher
): SearchProvider {
  switch (config.id) {
    case 'bing':
      return new BingProvider(http);
    case 'google':
      if (!config.googleApiKey || !config.googleCx) {
        throw new Error('Google 搜索需要配置 API key 和搜索引擎 ID（设置 → 搜索）');
      }
      return new GoogleApiProvider(http, config.googleApiKey, config.googleCx);
    default:
      return new BingProvider(http);
  }
}

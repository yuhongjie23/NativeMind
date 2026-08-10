/**
 * 外部搜索引擎 Provider 实现
 *
 * 每个引擎对应一个类，实现 SearchProvider 接口。
 * HTML 解析用纯函数，不去引 DOM parser（在 WebView 外可能不存在），
 * 正则足够应付搜索结果页的结构化提取。
 *
 * C6：只发关键词，不带笔记原文。结果临时保留，用户选中的才落库。
 */
import type { RawSearchResult } from './result-filter';
import type { SearchProvider } from './search-gate';
import type { SearchEngineConfig } from '@shared-types/search-config';

/* ---------- HTTP 抓取端口 ---------- */

/** 绕开 WebView CORS 的 HTTP 通道。Tauri 通过 invoke 调 Rust 命令；浏览器降级为直接 fetch */
export interface HttpFetcher {
  fetchText(url: string): Promise<string>;
}

/* ---------- HTML 解析工具 ---------- */

/** 搜索引擎反爬/JS 墙的常见标记。命中时说明拿到的不是结果页，直接判空并告警 */
const isBlockedPage = (html: string, markers: string[]): boolean =>
  markers.some((marker) => html.includes(marker));

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
  // 去掉搜索引擎的跳转包装
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

/* ---------- DuckDuckGo Provider ---------- */

/**
 * DuckDuckGo HTML 版（非 JS 版）。
 * 语义化 class 名，解析最稳定。
 */
class DuckDuckGoProvider implements SearchProvider {
  constructor(private readonly http: HttpFetcher) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await this.http.fetchText(url);
      if (isBlockedPage(html, ['anomaly', 'challenge'])) {
        console.warn('[DuckDuckGo] 返回了反爬挑战页，无法解析结果');
        return [];
      }
      return parseDuckDuckGoHtml(html, limit);
    } catch (error) {
      console.warn('[DuckDuckGo] 搜索失败:', error);
      return [];
    }
  }
}

/** DuckDuckGo HTML 版的搜索结果块匹配 */
const DUCK_RESULT_RE = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/td>/gi;
const DUCK_URL_RE = /uddg=([^&"']+)/;

function parseDuckDuckGoHtml(html: string, limit: number): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const matches = html.matchAll(DUCK_RESULT_RE);

  for (const match of matches) {
    if (results.length >= limit) break;

    let rawUrl = match[1];
    // DuckDuckGo 用 uddg= 包装真实 URL
    const realMatch = rawUrl.match(DUCK_URL_RE);
    if (realMatch) {
      try { rawUrl = decodeURIComponent(realMatch[1]); } catch { /* keep raw */ }
    }

    const title = stripTags(match[2]);
    const snippet = stripTags(match[3]);

    if (!title || !rawUrl) continue;

    results.push({
      title,
      url: rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`,
      snippet: snippet || undefined,
      site: extractHost(rawUrl),
    });
  }

  return results;
}

/* ---------- Bing Provider ---------- */

class BingProvider implements SearchProvider {
  constructor(private readonly http: HttpFetcher) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`;
      const html = await this.http.fetchText(url);
      return parseBingHtml(html, limit);
    } catch (error) {
      console.warn('[Bing] 搜索失败:', error);
      return [];
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

/* ---------- Google Provider ---------- */

class GoogleProvider implements SearchProvider {
  constructor(private readonly http: HttpFetcher) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN`;
      const html = await this.http.fetchText(url);
      if (isBlockedPage(html, ['enablejs', 'sorry', 'consent.google'])) {
        console.warn('[Google] 返回了 JS/拦截页，无法解析结果（Google 反爬严格，建议换 Bing）');
        return [];
      }
      return parseGoogleHtml(html, limit);
    } catch (error) {
      console.warn('[Google] 搜索失败:', error);
      return [];
    }
  }
}

/** Google 结果在 <a> 里有 h3 标题，摘要跟着在后面的 div */
const GOOGLE_RESULT_RE = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
const GOOGLE_SNIPPET_RE = /<span class="[^"]*st[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;

function parseGoogleHtml(html: string, limit: number): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const matches = html.matchAll(GOOGLE_RESULT_RE);

  for (const match of matches) {
    if (results.length >= limit) break;

    const rawUrl = match[1];
    const title = stripTags(match[2]);
    if (!title || !rawUrl) continue;

    const url = decodeURIComponent(rawUrl);
    // 从标题周围找摘要
    const afterTitle = html.slice(match.index! + match[0].length, match.index! + match[0].length + 800);
    const snippetMatch = afterTitle.match(GOOGLE_SNIPPET_RE);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : undefined;

    results.push({ title, url, snippet, site: extractHost(url) });
  }

  return results;
}

/* ---------- Baidu Provider ---------- */

class BaiduProvider implements SearchProvider {
  constructor(private readonly http: HttpFetcher) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    try {
      const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
      const html = await this.http.fetchText(url);
      if (isBlockedPage(html, ['captcha', 'verify', 'passport.baidu'])) {
        console.warn('[Baidu] 返回了验证码页，无法解析结果（建议换 Bing）');
        return [];
      }
      return parseBaiduHtml(html, limit);
    } catch (error) {
      console.warn('[Baidu] 搜索失败:', error);
      return [];
    }
  }
}

/** 百度结果：h3 标题 + c-abstract 摘要 */
const BAIDU_RESULT_RE = /<div[^>]*class="[^"]*result[^"]*c-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
const BAIDU_TITLE_RE = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
const BAIDU_SNIPPET_RE = /class="c-abstract"[^>]*>([\s\S]*?)<\/span>/i;

function parseBaiduHtml(html: string, limit: number): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  const blocks = html.matchAll(BAIDU_RESULT_RE);

  for (const block of blocks) {
    if (results.length >= limit) break;

    const body = block[1];
    const titleMatch = body.match(BAIDU_TITLE_RE);
    if (!titleMatch) continue;

    const url = resolveUrl(titleMatch[1], 'www.baidu.com');
    const title = stripTags(titleMatch[2]);
    if (!title) continue;

    const snippetMatch = body.match(BAIDU_SNIPPET_RE);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : undefined;

    results.push({ title, url, snippet, site: extractHost(url) });
  }

  return results;
}

/* ---------- Custom URL Provider ---------- */

class CustomUrlProvider implements SearchProvider {
  constructor(
    private readonly http: HttpFetcher,
    private readonly urlTemplate: string
  ) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    try {
      const url = this.urlTemplate.replace(/\{query\}/g, encodeURIComponent(query));
      const html = await this.http.fetchText(url);
      return parseGenericHtml(html, limit);
    } catch (error) {
      console.warn('[Custom] 搜索失败:', error);
      return [];
    }
  }
}

/**
 * 通用 HTML 解析 —— 用于自定义 URL。
 * 退化策略：提取所有 <a> 里有文本的链接，按文本长度排序，
 * 去重后作为结果返回。没有 snippet 但至少能看到链接和标题。
 */
const GENERIC_LINK_RE = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

function parseGenericHtml(html: string, limit: number): RawSearchResult[] {
  const seen = new Set<string>();
  const candidates: RawSearchResult[] = [];

  const matches = html.matchAll(GENERIC_LINK_RE);
  for (const match of matches) {
    const rawUrl = match[1];
    const text = stripTags(match[2]);

    // 跳过明显的导航链接
    if (!text || text.length < 4) continue;
    if (rawUrl.startsWith('#') || rawUrl.startsWith('javascript:')) continue;
    if (seen.has(rawUrl)) continue;

    seen.add(rawUrl);
    candidates.push({
      title: text.slice(0, 120),
      url: resolveUrl(rawUrl, ''),
      site: extractHost(rawUrl),
    });
  }

  // 按标题长度排序：长标题通常更有信息量
  return candidates
    .sort((a, b) => b.title.length - a.title.length)
    .slice(0, limit);
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
    case 'duckduckgo':
      return new DuckDuckGoProvider(http);
    case 'bing':
      return new BingProvider(http);
    case 'google':
      return new GoogleProvider(http);
    case 'baidu':
      return new BaiduProvider(http);
    case 'custom':
      if (!config.customUrl) {
        throw new Error('自定义搜索引擎需要填 URL');
      }
      return new CustomUrlProvider(http, config.customUrl);
    default:
      return new DuckDuckGoProvider(http);
  }
}

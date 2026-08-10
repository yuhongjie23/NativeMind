/**
 * 搜索引擎配置类型
 *
 * 本地优先，联网只是补充。默认用 DuckDuckGo（最尊重隐私）。
 * 自定义 URL 用 {query} 占位，搜索时替换为编码后的检索词。
 */
export type SearchEngineId = 'duckduckgo' | 'bing' | 'google' | 'baidu' | 'custom';

export interface SearchEngineConfig {
  id: SearchEngineId;
  /** 自定义搜索引擎的 URL 模板，{query} 会被替换为 URL 编码后的检索词 */
  customUrl?: string;
  /** 自定义引擎的显示名，留空显示为「自定义」 */
  customLabel?: string;
}

export const defaultSearchEngineConfig: SearchEngineConfig = {
  // DuckDuckGo HTML 版现在对纯 HTTP 客户端返回 202 反爬页，默认改用 Bing
  id: 'bing',
};

/** 预设搜索引擎的元数据 */
export interface SearchEngineMeta {
  id: SearchEngineId;
  label: string;
  /** 默认搜索 URL 模板 */
  defaultUrl?: string;
}

export const ENGINE_LIST: SearchEngineMeta[] = [
  { id: 'duckduckgo', label: 'DuckDuckGo', defaultUrl: 'https://html.duckduckgo.com/html/?q={query}' },
  { id: 'bing', label: 'Bing', defaultUrl: 'https://www.bing.com/search?q={query}' },
  { id: 'google', label: 'Google', defaultUrl: 'https://www.google.com/search?q={query}' },
  { id: 'baidu', label: '百度', defaultUrl: 'https://www.baidu.com/s?wd={query}' },
  { id: 'custom', label: '自定义', defaultUrl: undefined },
];

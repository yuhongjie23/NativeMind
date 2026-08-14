/**
 * 搜索引擎配置类型
 *
 * 本地优先，联网只是补充。
 * 只保留两个能稳定工作的选项：
 * - Bing：HTML 抓取，无反爬（默认）
 * - Google：Custom Search JSON API（需要 API key + 搜索引擎 ID），稳定无反爬
 *
 * 其余引擎（DuckDuckGo / 百度 / 自定义 URL）对纯 HTTP 客户端反爬严重，
 * 已移除——与其让用户面对「无结果」，不如只提供真正能用的。
 */
export type SearchEngineId = 'bing' | 'google';

export interface SearchEngineConfig {
  id: SearchEngineId;
  /** Google Custom Search JSON API key（google 引擎用，与 DeepSeek key 同模式） */
  googleApiKey?: string;
  /** Google Custom Search Engine ID（google 引擎用，Google Cloud 控制台获取） */
  googleCx?: string;
}

export const defaultSearchEngineConfig: SearchEngineConfig = {
  // Bing HTML 版对纯 HTTP 客户端最宽容，作为默认
  id: 'bing',
};

/** 预设搜索引擎的元数据 */
export interface SearchEngineMeta {
  id: SearchEngineId;
  label: string;
  /** 是否需要配置（google 需要 key+CX） */
  needsConfig?: boolean;
}

export const ENGINE_LIST: SearchEngineMeta[] = [
  { id: 'bing', label: 'Bing' },
  { id: 'google', label: 'Google（官方 API）', needsConfig: true },
];

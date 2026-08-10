/**
 * EnhanceSearchResultsUseCase - 搜索结果 AI 整理
 *
 * 先对每条结果用快速模型异步出摘要，再用教师模型做软推荐排序。
 * 模型不可用时由端口降级（截断原文 + 原顺序），这里不抛错。
 */
import type { SearchResultEnhancement, SearchResultEnhancerPort } from '../../ports';

export interface EnhanceSearchResultsInput {
  results: { id: string; title: string; text: string }[];
}

export class EnhanceSearchResultsUseCase {
  constructor(private readonly enhancer: SearchResultEnhancerPort) {}

  async execute(input: EnhanceSearchResultsInput): Promise<SearchResultEnhancement[]> {
    if (input.results.length === 0) return [];
    return this.enhancer.enhance(input.results);
  }
}

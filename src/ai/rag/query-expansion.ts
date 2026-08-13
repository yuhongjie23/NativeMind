/**
 * 查询扩展（Multi-Query / Sub-Query 的启发式实现）
 *
 * 不依赖模型、零额外延迟，纯文本改写：
 * - Sub-Query：按并列连词把复合查询拆成子问题，分别召回再合并；
 * - Multi-Query：提取关键词生成一条更短、更聚焦的查询，扩大召回面。
 * 这样大文件检索时能多角度命中，而不是只依赖原句的字面匹配。
 *
 * 模型可用时可再叠加 HyDE（假设性文档嵌入），见 RetrievalStrategy 的
 * hypotheticalGenerator 扩展位。
 */
import { extractKeywords } from './retrieval-strategy';

export interface QueryExpansionOptions {
  /** 一个查询最多生成几个变体（含原查询） */
  maxVariants: number;
}

export const defaultQueryExpansionOptions: QueryExpansionOptions = { maxVariants: 3 };

/** 并列连词：按这些词把复合查询拆成子问题 */
const COORDINATING = /[、，,和与及/]/;

/**
 * 生成查询变体，第一项永远是原查询。
 * 返回去重后的变体列表，最多 maxVariants 个。
 */
export function expandQuery(
  text: string,
  options: QueryExpansionOptions = defaultQueryExpansionOptions
): string[] {
  const variants: string[] = [text];

  // Sub-Query：拆成子问题
  const parts = text
    .split(COORDINATING)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (parts.length > 1) variants.push(...parts.slice(0, 3));

  // Multi-Query：关键词聚焦版（拆出的关键词比原句更容易命中向量/规则层）
  const keywords = extractKeywords(text, 6);
  const keywordQuery = keywords.join(' ');
  if (keywords.length >= 2 && keywordQuery !== text.trim()) {
    variants.push(keywordQuery);
  }

  return [...new Set(variants)].slice(0, options.maxVariants);
}

/**
 * 检索式生成（fast / 1.5B）
 *
 * C6：只生成关键词，绝不把笔记原文塞进出站请求。
 * 模型不可用时退化为本地关键词抽取，保证联网功能不因模型缺失而完全不可用。
 */
import { extractKeywords } from '../rag/retrieval-strategy';
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';

export interface KeywordResult {
  queries: string[];
  /** true 表示模型不可用，用了本地规则兜底 */
  fallback: boolean;
}

const MAX_QUERIES = 4;
const MAX_QUERY_CHARS = 60;

const SYSTEM = [
  '你在为搜索引擎生成检索式。',
  '只输出 JSON 字符串数组，不解释。',
  '每条检索式不超过 12 个词，聚焦一个角度，彼此不要重复。',
  '不要加「详解」「教程」这类凑字的词。',
].join('\n');

export class KeywordGenerator {
  constructor(private readonly router: ModelRouter) {}

  /**
   * @param topic 用户想了解的主题
   * @param localGaps 本地资料缺失的方面，帮模型聚焦；调用方需确保这里不含笔记原文
   */
  async generate(topic: string, localGaps: string[] = []): Promise<KeywordResult> {
    const gapHint = localGaps.length > 0 ? `\n本地资料在这些方面不足：${localGaps.join('、')}` : '';

    const result = await this.router.run<{ topic: string }, string[]>({
      taskType: 'search_keywords',
      input: { topic },
      inlinePrompt: {
        system: SYSTEM,
        user: `主题：${truncate(topic, 200)}${gapHint}\n\n生成 2 到 ${MAX_QUERIES} 条检索式，输出如 ["LoRA QLoRA 区别", "QLoRA 量化原理"]`,
      },
    });

    const queries = Array.isArray(result.output)
      ? result.output
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .map((q) => truncate(q.trim(), MAX_QUERY_CHARS))
          .slice(0, MAX_QUERIES)
      : [];

    if (queries.length > 0) return { queries, fallback: false };

    // 兜底：本地关键词拼成一条检索式，够用且完全不依赖模型
    const local = extractKeywords(topic, 6).join(' ').trim();
    return { queries: local ? [local] : [truncate(topic, MAX_QUERY_CHARS)], fallback: true };
  }
}

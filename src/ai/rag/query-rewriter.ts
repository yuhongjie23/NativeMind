import { withModelDeadline } from '../shared/model-deadline';
/**
 * 查询改写器（LLM 版 Multi-Query + HyDE）
 *
 * 一次模型调用同时产出：
 * - 3-5 个不同角度的查询变体（Multi-Query / Sub-Query）；
 * - 一段「假设性答案」（HyDE），用它的向量去检索，语义更丰富。
 *
 * 深度检索专用：模型不可用 / 超时 / 输出不合法一律回退到启发式 expandQuery，
 * 绝不阻塞或拖慢普通检索。
 */
import type { ModelRouter } from '../router/model-router';
import { expandQuery } from './query-expansion';

export interface RewriteResult {
  variants: string[];
  hypothetical?: string;
}

const QUERY_RE = /^查询\s*[1-5]\s*[:：]\s*(.+)$/;
const HYDE_RE = /^假设性答案\s*[:：]\s*(.+)$/;

/** 解析模型输出：按行取「查询N：」与「假设性答案：」，宽松容错 */
export function parseRewriteOutput(raw: string): RewriteResult {
  const variants: string[] = [];
  let hypothetical: string | undefined;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const queryMatch = trimmed.match(QUERY_RE);
    if (queryMatch) {
      variants.push(queryMatch[1].trim());
      continue;
    }
    const hydeMatch = trimmed.match(HYDE_RE);
    if (hydeMatch) hypothetical = hydeMatch[1].trim();
  }
  return { variants: variants.filter(Boolean), hypothetical };
}

export class QueryRewriter {
  constructor(
    private readonly router: ModelRouter,
    private readonly timeoutMs = 3000
  ) {}

  async rewrite(text: string, signal?: AbortSignal): Promise<RewriteResult> {
    signal?.throwIfAborted();
    try {
      const result = await withModelDeadline(
        (requestSignal) => this.router.run<{ query: string }, string>({
          taskType: 'query_rewrite',
          signal: requestSignal,
          input: { query: text },
          promptVars: { query: text },
        }),
        this.timeoutMs,
        '查询改写',
        signal
      );
      const parsed = result.output ? parseRewriteOutput(result.output) : { variants: [] };
      if (parsed.variants.length === 0) {
        // 模型没产出可用变体 → 启发式兜底
        return { variants: expandQuery(text) };
      }
      return {
        variants: [...new Set([text, ...parsed.variants])].slice(0, 5),
        hypothetical: parsed.hypothetical,
      };
    } catch {
      signal?.throwIfAborted();
      // 模型不可用 / 超时 / 解析失败：一律回退启发式
      return { variants: expandQuery(text) };
    }
  }
}

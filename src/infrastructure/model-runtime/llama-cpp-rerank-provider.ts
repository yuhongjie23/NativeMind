/**
 * llama.cpp 专用重排（cross-encoder）Provider
 *
 * llama-server 加载 rerank 类模型（如 bge-reranker）时提供 /rerank 端点：
 *   POST /rerank  { model, query, documents: [...] }
 *   → { results: [{ index, relevance_score }] }
 *
 * 与 LlamaCppProvider 的差别：那个是 chat 模型（/v1/chat/completions），
 * 这个是 rerank 模型（/rerank），通常是两个独立的 llama-server 进程。
 * C6：只允许连本机。失败由调用方（RetrievalStrategy）回退生成式重排。
 */
import { assertLocalUrl, fetchWithTimeout } from './model-interface';
import type { RerankProvider } from '@ai/types';

export interface LlamaCppRerankOptions {
  baseUrl?: string;
  /** 服务端加载的 rerank 模型名。留空表示「来什么都接」 */
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RerankResponse {
  results?: { index?: number; relevance_score?: number }[];
}

export class LlamaCppRerankProvider implements RerankProvider {
  private readonly baseUrl: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LlamaCppRerankOptions = {}) {
    this.baseUrl = assertLocalUrl(options.baseUrl ?? 'http://localhost:8080');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** 打分并按 index 对齐回 docs 顺序；缺 index 时按返回顺序兜底 */
  async rerank(query: string, docs: string[]): Promise<number[]> {
    if (docs.length === 0) return [];

    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/rerank`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, query, documents: docs }),
      },
      this.timeoutMs
    );
    if (!response.ok) throw new Error(`llama.cpp /rerank 返回 ${response.status}`);

    const data = (await response.json()) as RerankResponse;
    const byIndex = new Map<number, number>();
    (data.results ?? []).forEach((item, order) => {
      byIndex.set(item.index ?? order, item.relevance_score ?? 0);
    });

    return docs.map((_, position) => byIndex.get(position) ?? 0);
  }
}

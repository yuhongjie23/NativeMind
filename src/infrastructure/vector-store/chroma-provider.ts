/**
 * Chroma Provider（备选，需要用户自行启动本地服务）
 *
 * 只连本机地址。这是本地优先工具，向量数据不应该发到远端，
 * 所以构造时就把非本机 host 拦掉，而不是等运行时才发现数据出去了。
 */
import {
  distanceToScore,
  type VectorMatch,
  type VectorRecord,
  type VectorStoreProvider,
} from './vector-store-interface';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export interface ChromaOptions {
  baseUrl?: string;
  collection?: string;
  dimension?: number;
  /** 注入 fetch 便于测试，默认用全局 fetch */
  fetchImpl?: typeof fetch;
}

interface ChromaQueryResponse {
  ids?: string[][];
  distances?: number[][];
  documents?: (string | null)[][];
  metadatas?: ({ note_id?: string } | null)[][];
}

export class ChromaProvider implements VectorStoreProvider {
  readonly name = 'chroma';
  readonly dimension: number;
  readonly didRebuild = false;

  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly fetchImpl: typeof fetch;
  /** collection 的内部 id，Chroma 的读写接口要用它而不是名字 */
  private collectionId: string | null = null;

  constructor(options: ChromaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:8000').replace(/\/+$/, '');
    this.collection = options.collection ?? 'nativemind_notes';
    this.dimension = options.dimension ?? 384;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    const host = new URL(this.baseUrl).hostname;
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Chroma 只允许连本机，收到 ${host}`);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) throw new Error(`Chroma ${path} 返回 ${response.status}`);
    return (await response.json()) as T;
  }

  /** 拿不到就建，幂等 */
  private async ensureCollection(): Promise<string> {
    if (this.collectionId) return this.collectionId;
    const created = await this.request<{ id: string }>('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name: this.collection, get_or_create: true }),
    });
    this.collectionId = created.id;
    return created.id;
  }

  /** 服务没起就返回 false，让上层降级，不抛错 */
  async isAvailable(): Promise<boolean> {
    try {
      await this.request('/api/v1/heartbeat');
      await this.ensureCollection();
      return true;
    } catch {
      return false;
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const id = await this.ensureCollection();

    await this.request(`/api/v1/collections/${id}/upsert`, {
      method: 'POST',
      body: JSON.stringify({
        ids: records.map((record) => record.chunkId),
        embeddings: records.map((record) => record.embedding),
        documents: records.map((record) => record.text),
        metadatas: records.map((record) => ({ note_id: record.noteId })),
      }),
    });
  }

  async query(embedding: number[], limit: number): Promise<VectorMatch[]> {
    const id = await this.ensureCollection();
    const result = await this.request<ChromaQueryResponse>(`/api/v1/collections/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({
        query_embeddings: [embedding],
        n_results: limit,
        include: ['documents', 'distances', 'metadatas'],
      }),
    });

    // Chroma 的返回是「每个查询一组」的二维数组，我们只发了一个查询
    const ids = result.ids?.[0] ?? [];
    return ids.map((chunkId, index) => ({
      chunkId,
      noteId: result.metadatas?.[0]?.[index]?.note_id ?? '',
      text: result.documents?.[0]?.[index] ?? '',
      score: distanceToScore(result.distances?.[0]?.[index] ?? Number.POSITIVE_INFINITY),
    }));
  }

  async deleteByNote(noteId: string): Promise<void> {
    const id = await this.ensureCollection();
    await this.request(`/api/v1/collections/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ where: { note_id: noteId } }),
    });
  }

  /** 删整个 collection 再重建，比逐条删干净 */
  async clear(): Promise<void> {
    await this.request(`/api/v1/collections/${this.collection}`, { method: 'DELETE' }).catch(
      () => undefined
    );
    this.collectionId = null;
    await this.ensureCollection();
  }
}

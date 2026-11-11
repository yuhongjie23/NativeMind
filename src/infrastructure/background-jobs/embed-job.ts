/**
 * embed_chunks：生成向量并写入向量库
 *
 * 这是整条流水线里最耗资源的一步，所以：
 * - 分批处理，每批之间让出事件循环，避免 UI 卡住
 * - 向量库不可用时不算失败：标记 indexed 让笔记可用，检索降级到关键词层（C3）
 * - 写入成功才记 embeddingVersion，版本变了下次会整体重建
 */
import type { JobType } from '@application/ports';
import type { EmbeddingProvider } from '@ai/types';
import type { SqliteNoteRepository } from '../db/repositories/note-repository';
import type { VectorRecord, VectorStoreProvider } from '../vector-store/vector-store-interface';
import type { Job, JobHandler } from './job-queue';

export interface EmbedJobOptions {
  /** 每批向量化的 chunk 数。太大占显存，太小请求开销高 */
  batchSize?: number;
  /** 一篇笔记标记为 indexed 后回调（UI 刷新用；索引完成列表要刷新） */
  onIndexed?: (noteId: string, chunkCount: number) => void;
}

export class EmbedChunksJob implements JobHandler {
  readonly type: JobType = 'embed_chunks';
  private readonly batchSize: number;
  private onIndexed: ((noteId: string, chunkCount: number) => void) | undefined;

  constructor(
    private readonly notes: Pick<SqliteNoteRepository, 'findForIndex' | 'isIndexCurrent' | 'listChunks' | 'updateIndexStatus'>,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectorStore: VectorStoreProvider,
    options: EmbedJobOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 16;
    this.onIndexed = options.onIndexed;
  }

  /** 后期接线：装配阶段 eventBus 还没建好时用（见 bootstrap） */
  setOnIndexed(fn: (noteId: string, chunkCount: number) => void): void {
    this.onIndexed = fn;
  }

  async run(job: Job, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const source = await this.notes.findForIndex(job.entityId);
    if (!source) return;
    const { note, revision } = source;
    if (job.payload.contentRevision !== undefined && job.payload.contentRevision !== revision) return;

    const chunks = await this.notes.listChunks(note.id);
    const snapshot = { revision, chunkIds: chunks.map(chunk => chunk.id) };
    if (!await this.notes.isIndexCurrent(note.id, snapshot)) return;
    if (chunks.length === 0) {
      // A non-empty saved note without chunks needs chunking, not a false success.
      if (note.content.trim()) return;
      if (await this.notes.updateIndexStatus(note.id, 'indexed', { chunkCount: 0 }, snapshot)) this.onIndexed?.(note.id, 0);
      return;
    }

    // 向量库不可用就到此为止：笔记正文和关键词检索仍然可用
    if (!(await this.vectorStore.isAvailable())) {
      const committed = await this.notes.updateIndexStatus(note.id, 'indexed', {
        chunkCount: chunks.length,
        error: `向量库 ${this.vectorStore.name} 不可用，已降级为关键词检索`,
      }, snapshot);
      if (committed) this.onIndexed?.(note.id, chunks.length);
      return;
    }

    if (!await this.notes.updateIndexStatus(note.id, 'indexing', {}, snapshot)) return;

    try {
      for (let start = 0; start < chunks.length; start += this.batchSize) {
        signal?.throwIfAborted();
        const batch = chunks.slice(start, start + this.batchSize);
        const vectors = await this.embeddings.embed(batch.map((chunk) => chunk.text), signal);
        signal?.throwIfAborted();
        if (!await this.notes.isIndexCurrent(note.id, snapshot)) return;
        if (vectors.length !== batch.length || vectors.some(vector => vector.length === 0 || vector.some(value => !Number.isFinite(value)) || !vector.some(value => value !== 0))) {
          throw new Error('模型返回的向量缺失或无效，未完成索引，请检查向量模型后重试');
        }

        const records: VectorRecord[] = batch.map((chunk, index) => ({
          chunkId: chunk.id,
          noteId: chunk.noteId,
          text: chunk.text,
          embedding: vectors[index],
        }));
        await this.vectorStore.upsert(records);

        // 让出一帧，长文档索引时 UI 还能响应
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const committed = await this.notes.updateIndexStatus(note.id, 'indexed', {
        chunkCount: chunks.length,
        embeddingVersion: this.embeddings.version,
      }, snapshot);
      if (!committed) return;
    } catch (error) {
      signal?.throwIfAborted();
      const committed = await this.notes.updateIndexStatus(note.id, 'failed', { error: error instanceof Error ? error.message : String(error) }, snapshot);
      if (!committed) return;
      throw error;
    }
    this.onIndexed?.(note.id, chunks.length);
  }
}

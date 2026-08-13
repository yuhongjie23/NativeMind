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
    private readonly notes: SqliteNoteRepository,
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

  async run(job: Job): Promise<void> {
    const note = await this.notes.findById(job.entityId);
    if (!note) return;

    const chunks = await this.notes.listChunks(note.id);
    if (chunks.length === 0) {
      await this.notes.updateIndexStatus(note.id, 'indexed', { chunkCount: 0 });
      this.onIndexed?.(note.id, 0);
      return;
    }

    // 向量库不可用就到此为止：笔记正文和关键词检索仍然可用
    if (!(await this.vectorStore.isAvailable())) {
      await this.notes.updateIndexStatus(note.id, 'indexed', {
        chunkCount: chunks.length,
        error: `向量库 ${this.vectorStore.name} 不可用，已降级为关键词检索`,
      });
      this.onIndexed?.(note.id, chunks.length);
      return;
    }

    await this.notes.updateIndexStatus(note.id, 'indexing');

    for (let start = 0; start < chunks.length; start += this.batchSize) {
      const batch = chunks.slice(start, start + this.batchSize);
      const vectors = await this.embeddings.embed(batch.map((chunk) => chunk.text));

      const records: VectorRecord[] = batch
        // 个别 chunk 向量化失败时跳过它，不拖累整篇笔记
        .map((chunk, index) => ({
          chunkId: chunk.id,
          noteId: chunk.noteId,
          text: chunk.text,
          embedding: vectors[index] ?? [],
        }))
        .filter((record) => record.embedding.length > 0);

      await this.vectorStore.upsert(records);

      // 让出一帧，长文档索引时 UI 还能响应
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await this.notes.updateIndexStatus(note.id, 'indexed', {
      chunkCount: chunks.length,
      embeddingVersion: this.embeddings.version,
    });
    this.onIndexed?.(note.id, chunks.length);
  }
}

/**
 * chunk_note：正文切片并落库
 *
 * 切分算法复用 ai/rag/chunk-strategy（纯函数），这里只做 IO：
 * 换算 sourceType、写 note_chunks、清理向量库里的旧向量、排下一个 Job。
 *
 * 旧向量必须在这一步删：新 chunk 的 id 是新生成的，
 * 不删的话旧向量会永远留在库里，检索到已经不存在的片段。
 */
import { chunkText } from '@ai/rag/chunk-strategy';
import type { JobType, NoteSourceType } from '@application/ports';
import type { NoteChunk, SqliteNoteRepository } from '../db/repositories/note-repository';
import type { VectorStoreProvider } from '../vector-store/vector-store-interface';
import type { Job, JobHandler, JobQueue } from './job-queue';

/** 库里的 source_type 比切分器需要的粒度细，这里收敛一次 */
const toChunkSource = (sourceType: NoteSourceType): 'markdown' | 'pdf' | 'text' => {
  if (sourceType === 'imported_markdown') return 'markdown';
  if (sourceType === 'imported_pdf') return 'pdf';
  // 手写笔记按 Markdown 处理：用户习惯用 # 组织结构
  return sourceType === 'manual' ? 'markdown' : 'text';
};

export class ChunkNoteJob implements JobHandler {
  readonly type: JobType = 'chunk_note';

  constructor(
    private readonly notes: SqliteNoteRepository,
    private readonly queue: JobQueue,
    private readonly vectorStore?: VectorStoreProvider
  ) {}

  async run(job: Job): Promise<void> {
    const note = await this.notes.findById(job.entityId);
    if (!note) return;

    await this.notes.updateIndexStatus(note.id, 'chunking');

    const drafts = chunkText(note.content, toChunkSource(note.sourceType));
    if (drafts.length === 0) {
      // 空内容不算失败，直接标完成，否则会一直重试。
      // 同时清理向量库旧向量：内容清空后旧 chunk 还在库里，RAG 会命中过期片段。
      await this.notes.replaceChunks(note.id, []);
      await this.vectorStore?.deleteByNote(note.id).catch(() => undefined);
      await this.notes.updateIndexStatus(note.id, 'indexed', { chunkCount: 0 });
      return;
    }

    const now = new Date().toISOString();
    const chunks: NoteChunk[] = drafts.map((draft) => ({
      id: crypto.randomUUID(),
      noteId: note.id,
      text: draft.text,
      headingPath: draft.headingPath,
      charStart: draft.offset,
      charEnd: draft.offset + draft.text.length,
      // chunk 继承笔记标签，RAG 的规则层靠它做标签重叠打分
      tags: note.tags,
      createdAt: now,
    }));

    await this.notes.replaceChunks(note.id, chunks);
    await this.vectorStore?.deleteByNote(note.id).catch(() => undefined);

    await this.queue.enqueue({ type: 'embed_chunks', entityId: note.id });
  }
}

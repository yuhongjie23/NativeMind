/**
 * parse_note：把源文件解析成正文
 *
 * 只处理有 sourceUri 的笔记（手写笔记的正文已经在库里，不需要解析）。
 * 解析完发现内容哈希没变就直接跳到切分 —— 重复导入同一份文件不该重跑整条流水线。
 */
import type { JobType } from '@application/ports';
import type { FileImportPort } from '@application/ports';
import type { SqliteNoteRepository } from '../db/repositories/note-repository';
import type { Job, JobHandler, JobQueue } from './job-queue';

export class ParseNoteJob implements JobHandler {
  readonly type: JobType = 'parse_note';

  constructor(
    private readonly notes: SqliteNoteRepository,
    private readonly fileImport: FileImportPort,
    private readonly queue: JobQueue
  ) {}

  async run(job: Job): Promise<void> {
    const note = await this.notes.findById(job.entityId);
    if (!note) return; // 笔记已被删除，静默结束

    await this.notes.updateIndexStatus(note.id, 'parsing');

    // 手动创建或粘贴导入的笔记没有源文件，正文即已有内容，直接进切块
    if (!note.sourceUri) {
      await this.queue.enqueue({ type: 'chunk_note', entityId: note.id });
      return;
    }

    // 手动编辑过的源文件笔记（indexStatus=stale）：不要重解析源文件 ——
    // 那会用文件原文覆盖用户的编辑。直接用库内当前内容进切块。
    if (note.indexStatus === 'stale') {
      await this.queue.enqueue({ type: 'chunk_note', entityId: note.id });
      return;
    }

    // 走到这里 sourceUri 一定是文件路径：粘贴导入的笔记不会写这个字段
    const parsed = await this.fileImport.parse({ kind: 'path', path: note.sourceUri });

    const hash = await this.fileImport.hash(parsed.content);

    if (hash !== note.contentHash) {
      await this.notes.save({
        ...note,
        title: parsed.title || note.title,
        content: parsed.content,
        contentHash: hash,
        indexStatus: 'parsing',
        updatedAt: new Date().toISOString(),
      });
    }

    await this.queue.enqueue({ type: 'chunk_note', entityId: note.id });
  }
}

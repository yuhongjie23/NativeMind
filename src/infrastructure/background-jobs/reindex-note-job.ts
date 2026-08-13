/**
 * reindex_note：编辑笔记内容后，把这篇再走一遍 parse → chunk → embed 流水线。
 *
 * 自己不做任何解析，只是入队 parse_note 复用现有链路。
 * 没有这个处理器时，NoteUpdated 事件入队的 reindex_note 会因找不到处理器
 * 而被队列标记失败，编辑后的笔记永远停在 stale 状态。
 */
import type { JobType } from '@application/ports';
import type { Job, JobHandler, JobQueue } from './job-queue';

export class ReindexNoteJob implements JobHandler {
  readonly type: JobType = 'reindex_note';

  constructor(private readonly queue: JobQueue) {}

  async run(job: Job): Promise<void> {
    // 复用 parse_note：有源文件的会重解析文件，粘贴导入的直接进切块
    await this.queue.enqueue({ type: 'parse_note', entityId: job.entityId });
  }
}

/**
 * reindex_note：编辑笔记内容后，使用已保存正文走 chunk → embed 流水线。
 *
 * 不重新解析源文件：索引阶段会改变，不能靠 stale 状态保护用户的编辑。
 * 没有这个处理器时，NoteUpdated 事件入队的 reindex_note 会因找不到处理器
 * 而被队列标记失败，编辑后的笔记永远停在 stale 状态。
 */
import type { JobType } from '@application/ports';
import type { Job, JobHandler, JobQueue } from './job-queue';

export class ReindexNoteJob implements JobHandler {
  readonly type: JobType = 'reindex_note';

  constructor(private readonly queue: JobQueue) {}

  async run(job: Job): Promise<void> {
    await this.queue.enqueue({ type: 'chunk_note', entityId: job.entityId });
  }
}

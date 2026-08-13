/**
 * DeleteNoteUseCase - 删除笔记
 *
 * 破坏性操作，走确认弹窗。确认后：删正文 + chunk（仓储内事务），并清理向量库里的
 * 旧向量——vec0 虚拟表不走外键级联，留着会让 RAG 命中已删除片段。
 * 知识链接同理：笔记没了，指向它的边就是悬空数据，一并物理删除（归档没必要）。
 */
import type { UUID } from '@shared-types/common';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { KnowledgeLinkRepository, NoteRepository, NoteVectorCleanupPort } from '../../ports';
import { now } from '../../shared/utils';

export class DeleteNoteUseCase {
  constructor(
    private readonly noteRepo: NoteRepository,
    private readonly vectorCleanup?: NoteVectorCleanupPort,
    private readonly confirmation?: ConfirmationService,
    private readonly eventBus?: EventBus,
    private readonly linkRepo?: KnowledgeLinkRepository
  ) {}

  /** 删正文 + chunk（仓储内事务） + 清向量 + 清知识链接 + 发事件；清理失败不阻塞删除 */
  private async deleteNote(noteId: UUID): Promise<void> {
    await this.noteRepo.delete(noteId);
    await this.vectorCleanup?.deleteByNote(noteId).catch(() => undefined);
    // 笔记没了，关联边就是悬空数据：删掉，图谱才不会残留假节点
    await this.linkRepo?.deleteByEntity({ type: 'note', id: noteId }).catch(() => undefined);
    // 破坏性写操作同样要发事件：否则审计/订阅对「删了笔记」不可见
    await this.eventBus?.publish({
      type: 'NoteDeleted',
      noteId,
      timestamp: now(),
    });
  }

  async execute(noteId: UUID): Promise<boolean> {
    // 未接入确认门（web 演示等）时直接删
    if (!this.confirmation) {
      await this.deleteNote(noteId);
      return true;
    }

    const { confirmed } = await this.confirmation.confirmAndRun(
      {
        title: '删除笔记',
        message: '删除这篇笔记？笔记和它的切块、向量会被一起清掉。',
        confirmLabel: '删除',
        danger: true,
      },
      async () => {
        await this.deleteNote(noteId);
        return true;
      }
    );

    return confirmed;
  }
}

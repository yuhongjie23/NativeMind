/**
 * DeleteNoteUseCase - 删除笔记
 *
 * 破坏性操作，走确认弹窗。确认后：删正文 + chunk（仓储内事务），并清理向量库里的
 * 旧向量——vec0 虚拟表不走外键级联，留着会让 RAG 命中已删除片段。
 */
import type { UUID } from '@shared-types/common';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { NoteRepository, NoteVectorCleanupPort } from '../../ports';
import { now } from '../../shared/utils';

export class DeleteNoteUseCase {
  constructor(
    private readonly noteRepo: NoteRepository,
    private readonly vectorCleanup?: NoteVectorCleanupPort,
    private readonly confirmation?: ConfirmationService,
    private readonly eventBus?: EventBus
  ) {}

  /** 删正文 + chunk（仓储内事务） + 清向量 + 发事件；向量库不可用不阻塞删除 */
  private async deleteNote(noteId: UUID): Promise<void> {
    await this.noteRepo.delete(noteId);
    await this.vectorCleanup?.deleteByNote(noteId).catch(() => undefined);
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

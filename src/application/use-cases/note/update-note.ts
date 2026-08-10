/**
 * UpdateNoteUseCase - 编辑笔记
 * 内容变化时标记索引为 stale，并发布事件触发重建索引。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { FileImportPort, Note, NoteRepository } from '../../ports';
import { now } from '../../shared/utils';

export interface UpdateNotePatch {
  title?: string;
  content?: string;
  tags?: string[];
}

export class UpdateNoteUseCase {
  constructor(
    private readonly noteRepo: NoteRepository,
    private readonly fileImport: FileImportPort,
    private readonly eventBus: EventBus
  ) {}

  async execute(noteId: UUID, patch: UpdateNotePatch): Promise<Note> {
    const note = await this.noteRepo.findById(noteId);
    if (!note) throw new Error(`笔记不存在: ${noteId}`);

    const contentChanged = patch.content !== undefined && patch.content !== note.content;
    const contentHash = contentChanged
      ? await this.fileImport.hash(patch.content as string)
      : note.contentHash;

    const updated: Note = {
      ...note,
      ...patch,
      contentHash,
      indexStatus: contentChanged ? 'stale' : note.indexStatus,
      updatedAt: now(),
    };
    await this.noteRepo.save(updated);

    await this.eventBus.publish({
      type: 'NoteUpdated',
      noteId,
      contentChanged,
      timestamp: updated.updatedAt,
    });

    return updated;
  }
}

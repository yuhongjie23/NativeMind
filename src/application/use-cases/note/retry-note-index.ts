import type { NoteIndexRetryPort } from '../../ports';

/** User-requested index repair. Uses the saved note, without an AI write proposal. */
export class RetryNoteIndexUseCase {
  constructor(private readonly indexing?: NoteIndexRetryPort) {}

  async execute(noteId: string): Promise<'queued' | 'busy' | 'unsupported'> {
    if (!this.indexing) return 'unsupported';
    const result = await this.indexing.retryIndex(noteId);
    if (result === 'missing') throw new Error('笔记已不存在，请刷新列表');
    if (result === 'empty') throw new Error('笔记正文为空，无法建立索引');
    return result;
  }
}

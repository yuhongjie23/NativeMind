/**
 * ImportNoteUseCase - 导入笔记
 * 正文与首个索引任务一起提交；提交后再通知审计等订阅者。
 */
import type { EventBus } from '../../events/event-bus';
import type {
  FileImportPort,
  ImportSource,
  Note,
  NoteImportRepository,
  NoteSourceType,
  NoteImportOptions,
} from '../../ports';
import { abortable } from '../../shared/abortable';
import { newId, now } from '../../shared/utils';


const SOURCE_TYPE_MAP: Record<'pdf' | 'markdown' | 'text', NoteSourceType> = {
  pdf: 'imported_pdf',
  markdown: 'imported_markdown',
  text: 'imported_text',
};

export class ImportNoteUseCase {
  constructor(
    private readonly noteRepo: NoteImportRepository,
    private readonly fileImport: FileImportPort,
    private readonly eventBus: EventBus
  ) {}

  async execute(source: ImportSource, options: NoteImportOptions = {}): Promise<Note> {
    const { signal, onPhase } = options;
    signal?.throwIfAborted();
    onPhase?.('parsing');
    const parsed = await abortable(this.fileImport.parse(source, { signal }), signal);
    signal?.throwIfAborted();
    // Enforce this at the write boundary for every parser/runtime, including mocks
    // and future import adapters. Do not alter content or PDF character offsets.
    if (!parsed.content.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()) {
      throw new Error(parsed.sourceType === 'pdf'
        ? 'PDF 未提取到可用正文，未保存笔记。若为扫描件，请先在本机进行文字识别（OCR），再导入含文字的 PDF 或文本。'
        : '导入内容为空，未保存笔记。请检查文件正文或粘贴内容后重试。');
    }
    onPhase?.('checking');
    const contentHash = await abortable(this.fileImport.hash(parsed.content), signal);
    signal?.throwIfAborted();

    // 幂等：同内容不重复导入
    const existing = await abortable(this.noteRepo.findByContentHash(contentHash), signal);
    signal?.throwIfAborted();
    if (existing) {
      options.onDuplicate?.();
      return existing;
    }

    const timestamp = now();
    const note: Note = {
      id: newId(),
      title: parsed.title,
      content: parsed.content,
      contentHash,
      sourceType: SOURCE_TYPE_MAP[parsed.sourceType],
      // 只有来自文件的才有源路径。粘贴的文本没有出处，
      // 硬塞一份正文进 sourceUri 会让「重新解析源文件」之类的后续功能拿到垃圾值
      sourceUri: source.kind === 'path' ? source.path : undefined,
      pageRanges: parsed.pageRanges,

      indexStatus: 'pending',
      tags: source.tags ? [...new Set(source.tags.map((tag) => tag.trim()).filter(Boolean))] : [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    // Cancellation ends here: once saving starts, finish the write and indexing event.
    onPhase?.('saving');
    const committed = await this.noteRepo.commitImport(note);
    if (committed.id !== note.id) {
      options.onDuplicate?.();
      return committed;
    }

    await this.eventBus.publish({
      type: 'NoteImported',
      noteId: note.id,
      sourceType: parsed.sourceType,
      timestamp,
    });

    return note;
  }
}

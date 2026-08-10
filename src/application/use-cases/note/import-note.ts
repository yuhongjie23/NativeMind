/**
 * ImportNoteUseCase - 导入笔记
 * 只落库并发事件；切分与 embedding 由订阅者入队后台任务处理。
 */
import type { EventBus } from '../../events/event-bus';
import type {
  FileImportPort,
  ImportSource,
  Note,
  NoteRepository,
  NoteSourceType,
} from '../../ports';
import { newId, now } from '../../shared/utils';


const SOURCE_TYPE_MAP: Record<'pdf' | 'markdown' | 'text', NoteSourceType> = {
  pdf: 'imported_pdf',
  markdown: 'imported_markdown',
  text: 'imported_text',
};

export class ImportNoteUseCase {
  constructor(
    private readonly noteRepo: NoteRepository,
    private readonly fileImport: FileImportPort,
    private readonly eventBus: EventBus
  ) {}

  async execute(source: ImportSource): Promise<Note> {
    const parsed = await this.fileImport.parse(source);
    const contentHash = await this.fileImport.hash(parsed.content);

    // 幂等：同内容不重复导入
    const existing = await this.noteRepo.findByContentHash(contentHash);
    if (existing) return existing;

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
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.noteRepo.save(note);

    await this.eventBus.publish({
      type: 'NoteImported',
      noteId: note.id,
      sourceType: parsed.sourceType,
      timestamp,
    });

    return note;
  }
}

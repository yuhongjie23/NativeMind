/**
 * SuggestKnowledgeLinksUseCase - 为新笔记查找相关旧笔记并建议建链
 *
 * 对应架构 §11.3 的「检索相似 → 判断关系 → 建议 → 用户确认 → 写入」。
 * 建议只到确认弹窗为止，真正写库交给 CreateKnowledgeLinkUseCase（复用其
 * 幂等 UPSERT 与确认机制）。
 */
import type {
  KnowledgeLink,
  KnowledgeLinkRepository,
  KnowledgeLinkSuggestionPort,
  NoteRepository,
} from '../../ports';
import { CreateKnowledgeLinkUseCase, type LinkSuggestion } from './create-link';

export interface SuggestResult {
  /** 用户确认前提出的建议条数（可能因已存在被过滤） */
  suggested: number;
  /** 确认后实际写入的关系 */
  created: KnowledgeLink[];
}

export class SuggestKnowledgeLinksUseCase {
  constructor(
    private readonly noteRepo: NoteRepository,
    private readonly linkRepo: KnowledgeLinkRepository,
    private readonly suggestionPort: KnowledgeLinkSuggestionPort,
    private readonly createLink: CreateKnowledgeLinkUseCase
  ) {}

  async execute(noteId: string): Promise<SuggestResult> {
    const note = await this.noteRepo.findById(noteId);
    if (!note) throw new Error(`笔记不存在: ${noteId}`);

    // 把笔记已有的标签一并传给检索层：标签是用户自己打的内容摘要，
    // 比正文关键词更可靠，HyDE 生成时也会把它们纳入假设（LinkHydeGenerator 合并）。
    const candidates = await this.suggestionPort.suggestForNote(note.content, [noteId], undefined, note.tags);

    // 过滤已存在的关系：含已归档的也要跳过，否则同一条关系会被反复建议、反复被否
    const fresh: LinkSuggestion[] = [];
    for (const candidate of candidates) {
      const existing = await this.linkRepo.findEdge({
        fromType: 'note',
        fromId: noteId,
        toType: candidate.toType,
        toId: candidate.toId,
        relationType: candidate.relationType,
      });
      if (!existing) {
        fresh.push({
          fromType: 'note',
          fromId: noteId,
          toType: candidate.toType,
          toId: candidate.toId,
          relationType: candidate.relationType,
          reason: candidate.reason,
          confidence: candidate.confidence,
        });
      }
    }

    if (fresh.length === 0) return { suggested: 0, created: [] };

    const created = await this.createLink.executeFromSuggestions(fresh);
    return { suggested: fresh.length, created };
  }
}

import type { LearningKnowledge, LearningRepository, RecallRating, NoteRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export class TrackKnowledgeUseCase {
  constructor(private readonly repo: LearningRepository, private readonly notes: NoteRepository) {}
  list() { return this.repo.listKnowledge(); }
  async record(input: { id?: string; revision?: number; title: string; noteId?: string; rating: RecallRating; difficulty: string; result: string }): Promise<LearningKnowledge> {
    const title = input.title.trim();
    if (!title || title.length > 120) throw new Error('知识名称请填写 1～120 字。');
    if (!['new', 'difficult', 'forgotten', 'familiar', 'confident'].includes(input.rating)) throw new Error('请选择本次自评。');
    if (input.difficulty.length > 1000 || input.result.length > 1000) throw new Error('困难点和结果各不超过 1000 字。');
    const current = input.id ? await this.repo.findKnowledge(input.id) : null;
    if (input.id && (!current || current.revision !== input.revision)) throw new Error('知识记录已变化，请刷新后重试。');
    if (!current && input.noteId && !await this.notes.findById(input.noteId)) throw new Error('关联笔记已不存在。');
    const timestamp = now();
    const value: LearningKnowledge = { id: current?.id ?? newId(), title, noteId: current?.noteId ?? input.noteId,
      createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp, revision: (current?.revision ?? 0) + 1,
      observations: [...(current?.observations ?? []), { at: timestamp, rating: input.rating, difficulty: input.difficulty.trim(), result: input.result.trim() }] };
    if (!await this.repo.saveKnowledge(value, current?.revision ?? null)) throw new Error('知识记录已变化，请刷新后重试。');
    return value;
  }
}

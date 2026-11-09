import type { Todo, TodoDraft } from '../../ports';
import { newId, now } from '../../shared/utils';

export interface CreateTodoInput extends TodoDraft {
  scheduledDate?: string;
  linkedNoteIds?: string[];
}

export const normalizeTodoTitle = (input: string): string => {
  const title = input.trim();
  if (!title) throw new Error('Todo 标题不能为空');
  if (title.length > 200) throw new Error('Todo 标题不能超过 200 字符');
  return title;
};

export const validateTodoMinutes = (minutes?: number): void => {
  if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)) {
    throw new Error('估计时长必须为有限的正数');
  }
};

export const toTodo = (draft: CreateTodoInput): Todo => {
  const title = normalizeTodoTitle(draft.title);
  validateTodoMinutes(draft.estimatedMinutes);
  const timestamp = now();
  return {
    id: newId(), title, description: draft.description, status: 'pending',
    priority: draft.priority ?? 'medium', estimatedMinutes: draft.estimatedMinutes,
    scheduledDate: draft.scheduledDate, tags: draft.tags ?? [], linkedNoteIds: draft.linkedNoteIds ?? [],
    createdAt: timestamp, updatedAt: timestamp,
  };
};

/** Validate the entire batch before persistence; retain the existing blank-item fallback. */
export const filterDraftTitles = (drafts: CreateTodoInput[]): CreateTodoInput[] => {
  const valid = drafts.filter(draft => (draft.title ?? '').trim().length > 0);
  if (!valid.length) throw new Error('AI 拆出的任务标题都是空的，已保留原任务。可手动添加。');
  const titles = valid.map(draft => normalizeTodoTitle(draft.title));
  if (new Set(titles).size !== titles.length) throw new Error('拆解结果包含重复任务，请调整后再采用。');
  return valid;
};

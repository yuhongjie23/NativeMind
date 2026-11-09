import type { FocusRepository, LearningRepository, TodoRepository } from '../../ports';
import { formatLocalDate } from '../../shared/utils';

/** Build a short grounded letter without asking a model to infer progress or emotions. */
export async function learningLetter(
  repos: { todo: TodoRepository; focus: FocusRepository; learning?: LearningRepository },
  today: string, language: 'zh' | 'en'
): Promise<string | undefined> {
  const end = new Date(`${today}T00:00:00`);
  const start = new Date(end); start.setDate(start.getDate() - 6);
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  end.setDate(end.getDate() + 1);
  const cutoff = Math.min(Date.now(), end.getTime() - 1);
  const inWindow = (at?: string): boolean => Boolean(at && Date.parse(at) >= start.getTime() && Date.parse(at) <= cutoff);
  const [todos, sessions, knowledge] = await Promise.all([
    repos.todo.findCompletedByDateRange?.(from, today) ?? repos.todo.findByDateRange(from, today), repos.focus.findByDateRange(from, today), repos.learning?.listKnowledge() ?? [],
  ]);
  // Only the latest assessment per topic can describe its current recorded difficulty.
  const observations = knowledge.flatMap(item => {
    const latest = item.observations.filter(observation => Date.parse(observation.at) <= cutoff)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    return latest ? [{ title: item.title, ...latest }] : [];
  })
    .filter(item => inWindow(item.at) && ['difficult', 'forgotten'].includes(item.rating))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const last = observations[0];
  if (last && ['difficult', 'forgotten'].includes(last.rating)) {
    const date = formatLocalDate(new Date(last.at));
    // Keep an English letter English without silently translating the user's own wording.
    if (language === 'en' && /[\u3400-\u9fff]/u.test(last.title + last.difficulty)) {
      return `In your self-assessment on ${date}, you recorded a difficulty. If you feel like it, you could revisit that one point next time.\n\nBased on: your saved self-assessment on ${date}.`;
    }
    const topic = last.title.slice(0, 100);
    const detail = last.difficulty.slice(0, 160);
    return language === 'en'
      ? `In your self-assessment of “${topic}” on ${date}, you recorded ${detail ? `this difficulty: “${detail}”` : 'a difficulty'}. Would you like to revisit just this point next time?\n\nBased on: your saved self-assessment on ${date}.`
      : `你在 ${date} 对「${topic}」的自评记录了${detail ? `这个困难：「${detail}」` : '一个困难点'}。下次要不要只回顾这个点？\n\n依据：${date} 保存的知识自评。`;
  }
  const completedTodos = todos.filter(todo => todo.status === 'completed' && inWindow(todo.completedAt))
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));
  const completed = completedTodos.length;
  const focused = sessions.filter(session => session.status === 'completed' && inWindow(session.startedAt) && inWindow(session.completedAt)).length;
  if (!completed && !focused) return undefined;
  const task = completedTodos[0];
  const example = task && !(language === 'en' && /[\u3400-\u9fff]/u.test(task.title))
    ? language === 'en' ? ` One was “${task.title.slice(0, 100)}”.` : `其中一项是「${task.title.slice(0, 100)}」。` : '';
  return language === 'en'
    ? `Your available records from ${from} to ${today} show ${completed} completed task${completed === 1 ? '' : 's'} and ${focused} completed focus session${focused === 1 ? '' : 's'}.${example} If you feel like it, pick one thing you would like to remember.\n\nBased on: saved task and focus completion timestamps. Completion alone does not establish mastery.`
    : `${from} 至 ${today} 的可用记录里，有 ${completed} 项已完成任务和 ${focused} 段已完成专注。${example}如果愿意，可以挑一件你想记住的小事。\n\n依据：任务和专注记录的完成时间；完成记录不代表已经掌握。`;
}

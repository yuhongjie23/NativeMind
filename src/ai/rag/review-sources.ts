import type { ReviewEvidenceSource, ReviewFollowUp, Todo } from '@application/ports';
import type { ReviewEvidence } from './review-evidence';
import { completedWithin } from './review-evidence';
import { truncate } from '../shared/utils';
import { reviewKnowledgeContext } from './review-knowledge-context';

const statusLabels = { pending: '未开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消', deleted: '任务已删除' };

export function buildReviewSources(evidence: ReviewEvidence, todos: Todo[], followUps: ReviewFollowUp[] = [], knowledge?: string): ReviewEvidenceSource[] {
  const sources: ReviewEvidenceSource[] = [
    { id: 'period', kind: 'period', description: `${evidence.period.startDate} 至 ${evidence.period.endDate}，${evidence.period.expectedDays} 天；任务 ${evidence.totals.tasksTotal} 项，其中有日期记录且截至区间末已完成 ${evidence.totals.tasksCompleted} 项；完成专注 ${evidence.totals.completedSessions} 段、${evidence.totals.completedFocusMinutes} 分钟，中断 ${evidence.totals.abortedSessions} 段。` },
    { id: 'coverage', kind: 'coverage', description: `使用时长有记录 ${evidence.coverage.usageRecordedDays}/${evidence.period.expectedDays} 天。缺少记录不能解释成没学习；任务完成不等于掌握，专注时间不证明学习效果。缺少完成日期的任务不计入有日期依据的完成数。` },
    ...evidence.daily.map(day => ({ id: `day:${day.date}`, kind: 'day' as const,
      description: `${day.date}：该日安排/创建的任务 ${day.tasksTotal} 项，截至区间末有日期依据完成 ${day.tasksCompleted} 项；完成专注 ${day.completedFocusMinutes} 分钟，中断 ${day.abortedSessions} 次；应用使用${day.appMinutes === undefined ? '未记录' : ` ${day.appMinutes} 分钟`}。` })),
  ];
  const taskMap = new Map(todos.map(todo => [todo.id, todo]));
  for (const fact of evidence.taskFacts.slice(0, 50)) {
    const todo = taskMap.get(fact.id)!;
    const hasCompletionTime = Boolean(todo.completedAt && Number.isFinite(Date.parse(todo.completedAt)));
    const completion = completedWithin(todo, evidence.period.endDate) ? `截至区间末已完成，记录的完成时间 ${todo.completedAt}`
      : todo.status === 'completed' ? hasCompletionTime
        ? `当前标记完成，记录的完成时间 ${todo.completedAt} 晚于区间末，不计入区间完成数`
        : '当前标记完成，完成时间未知，无法判断是否在区间内完成；不计入区间完成数不代表任务未完成'
        : statusLabels[todo.status];
    sources.push({ id: `task:${fact.id}`, kind: 'task', description: `「${truncate(fact.title, 100)}」：${completion}；区间内关联完成专注 ${fact.focusMinutes} 分钟、中断 ${fact.abortCount} 次。` });
  }
  for (const entry of followUps.slice(0, 20)) sources.push({ id: `followup:${entry.id}`, kind: 'follow_up',
    description: `已采用建议「${truncate(entry.suggestion, 120)}」，采用时间 ${entry.adoptedAt}；生成本次复盘时状态：${statusLabels[entry.status]}${entry.completedAt ? `，完成时间 ${entry.completedAt}` : ''}。这只表示执行情况，不证明建议有效。` });
  const context = knowledge?.trim() ? reviewKnowledgeContext(knowledge) : '';
  if (context) sources.push({ id: 'knowledge', kind: 'knowledge', description: truncate(context, 1500) });
  return sources;
}

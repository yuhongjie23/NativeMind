/**
 * ReviewEvidence - 复盘证据构建（确定性数据组织）
 *
 * 设计哲学：周/月复盘要求模型分析「哪天投入多、哪天空窗、反复中断」等趋势，
 * 但模型拿到的原始数据没有日期维度，只能编造「看起来合理」的趋势。
 * 这里在 ai 层用 TypeScript 把原始数据组织成按日分桶的证据——
 * 日期分组、完成率、峰值、空窗日、连续天数全部程序计算；
 * 模型只负责把这些证据选重点、组织成人话（「数字由程序算，模型负责表达」）。
 */
import type { FocusSession, Todo } from '@application/ports';

export interface ReviewDailyBucket {
  date: string;
  tasksTotal: number;
  tasksCompleted: number;
  completedFocusMinutes: number;
  abortedSessions: number;
  appMinutes?: number;
}

export interface ReviewEvidence {
  period: {
    type: 'daily' | 'weekly' | 'monthly';
    startDate: string;
    endDate: string;
    expectedDays: number;
  };
  coverage: {
    usageRecordedDays: number;
    todoDataAvailable: boolean;
    focusDataAvailable: boolean;
  };
  totals: {
    tasksTotal: number;
    tasksCompleted: number;
    tasksCancelled: number;
    completedFocusMinutes: number;
    abortedFocusMinutes: number;
    completedSessions: number;
    abortedSessions: number;
  };
  daily: ReviewDailyBucket[];
  /** 每个任务的累计事实（跨日期维度，供「反复中断/长期未完成」判断） */
  taskFacts: Array<{
    title: string;
    scheduledDate?: string;
    status: string;
    completedInPeriod: boolean;
    focusMinutes: number;
    abortCount: number;
  }>;
  signals: Array<{
    id: string;
    kind: 'empty_day' | 'focus_peak' | 'repeated_abort' | 'carry_over';
    description: string;
  }>;
  /** 按日分桶的原始文本（给模型看，保留日期锚点） */
  text: string;
}

export interface EvidenceInput {
  reviewType: 'daily' | 'weekly' | 'monthly';
  /** 区间内所有日期（含无数据的日期，用于算空窗） */
  dates: string[];
  todos: Todo[];
  focusSessions: FocusSession[];
  /** 每日 app 使用分钟：date → minutes（无记录的天不包含） */
  usageByDate?: Map<string, number>;
}

/** 按日分桶 + 计算信号。纯函数，不碰 IO。 */
export function buildReviewEvidence(input: EvidenceInput): ReviewEvidence {
  const { reviewType, dates, todos, focusSessions, usageByDate } = input;
  const startDate = dates[dates.length - 1];
  const endDate = dates[0];

  // 按日分桶 todo：当日排期或当日创建的任务归入当日
  const todosByDay = new Map<string, Todo[]>();
  for (const todo of todos) {
    const key = todo.scheduledDate ?? todo.createdAt.slice(0, 10);
    const list = todosByDay.get(key) ?? [];
    list.push(todo);
    todosByDay.set(key, list);
  }

  // 按日分桶专注
  const focusByDay = new Map<string, FocusSession[]>();
  for (const session of focusSessions) {
    const key = session.startedAt.slice(0, 10);
    const list = focusByDay.get(key) ?? [];
    list.push(session);
    focusByDay.set(key, list);
  }

  const daily: ReviewDailyBucket[] = dates.map((date) => {
    const dayTodos = todosByDay.get(date) ?? [];
    const daySessions = focusByDay.get(date) ?? [];
    return {
      date,
      tasksTotal: dayTodos.length,
      tasksCompleted: dayTodos.filter((t) => t.status === 'completed').length,
      completedFocusMinutes: daySessions
        .filter((s) => s.status === 'completed')
        .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
      abortedSessions: daySessions.filter((s) => s.status === 'aborted').length,
      appMinutes: usageByDate?.get(date),
    };
  });

  const totals = {
    tasksTotal: todos.length,
    tasksCompleted: todos.filter((t) => t.status === 'completed').length,
    tasksCancelled: todos.filter((t) => t.status === 'cancelled').length,
    completedFocusMinutes: focusSessions
      .filter((s) => s.status === 'completed')
      .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
    abortedFocusMinutes: focusSessions
      .filter((s) => s.status === 'aborted')
      .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
    completedSessions: focusSessions.filter((s) => s.status === 'completed').length,
    abortedSessions: focusSessions.filter((s) => s.status === 'aborted').length,
  };

  const usageRecordedDays = usageByDate ? usageByDate.size : 0;
  const coverage = {
    usageRecordedDays,
    todoDataAvailable: todos.length > 0,
    focusDataAvailable: focusSessions.length > 0,
  };

  // 任务级事实：按 todoId 聚合专注分钟与中断次数
  const taskMap = new Map<
    string,
    ReviewEvidence['taskFacts'][number]
  >();
  for (const todo of todos) {
    taskMap.set(todo.id, {
      title: todo.title,
      scheduledDate: todo.scheduledDate,
      status: todo.status,
      completedInPeriod: todo.status === 'completed',
      focusMinutes: 0,
      abortCount: 0,
    });
  }
  for (const session of focusSessions) {
    const fact = session.todoId ? taskMap.get(session.todoId) : undefined;
    if (!fact) continue;
    if (session.status === 'completed') {
      fact.focusMinutes += session.actualMinutes ?? session.durationMinutes;
    } else if (session.status === 'aborted') {
      fact.abortCount += 1;
    }
  }
  const taskFacts = [...taskMap.values()];

  // 信号：程序算出来的可验证观察
  const signals: ReviewEvidence['signals'] = [];
  daily.forEach((bucket, index) => {
    const hasAny =
      bucket.tasksTotal > 0 || bucket.completedFocusMinutes > 0 || bucket.appMinutes !== undefined;
    if (!hasAny && index < dates.length - 1) {
      signals.push({
        id: `empty-${bucket.date}`,
        kind: 'empty_day',
        description: `${bucket.date} 无任务、无专注记录${usageByDate?.has(bucket.date) ? '' : '，且无使用记录'}`,
      });
    }
  });
  const peak = [...daily].sort(
    (a, b) => b.completedFocusMinutes - a.completedFocusMinutes
  )[0];
  if (peak && peak.completedFocusMinutes > 0) {
    signals.push({
      id: `peak-${peak.date}`,
      kind: 'focus_peak',
      description: `专注高峰在 ${peak.date}（${peak.completedFocusMinutes} 分钟）`,
    });
  }
  const repeated = taskFacts.filter((f) => f.abortCount >= 2);
  repeated.forEach((fact) => {
    signals.push({
      id: `abort-${fact.title.slice(0, 12)}`,
      kind: 'repeated_abort',
      description: `「${fact.title}」关联专注中断 ${fact.abortCount} 次`,
    });
  });
  const carried = todos.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.createdAt.slice(0, 10) < startDate
  );
  carried.slice(0, 5).forEach((todo) => {
    signals.push({
      id: `carry-${todo.id}`,
      kind: 'carry_over',
      description: `任务「${todo.title}」从区间前带入仍未完成`,
    });
  });

  // 给模型的按日文本（日期锚点 + 关键数字，周/月视角用）
  const dayLines = daily
    .map((bucket) => {
      const parts = [bucket.date];
      if (bucket.completedFocusMinutes > 0) parts.push(`专注 ${bucket.completedFocusMinutes} 分钟`);
      if (bucket.tasksTotal > 0) parts.push(`任务 ${bucket.tasksCompleted}/${bucket.tasksTotal}`);
      if (bucket.abortedSessions > 0) parts.push(`中断 ${bucket.abortedSessions} 次`);
      if (bucket.appMinutes !== undefined) parts.push(`使用 ${bucket.appMinutes} 分钟`);
      if (parts.length === 1) parts.push('（空窗）');
      return `- ${parts.join('，')}`;
    })
    .join('\n');

  const text = [
    `区间：${startDate} ~ ${endDate}（共 ${dates.length} 天）`,
    `任务：共 ${totals.tasksTotal}（完成 ${totals.tasksCompleted}，取消 ${totals.tasksCancelled}）`,
    `专注：完成 ${totals.completedSessions} 段 ${totals.completedFocusMinutes} 分钟；中断 ${totals.abortedSessions} 段 ${totals.abortedFocusMinutes} 分钟`,
    `使用时长覆盖 ${usageRecordedDays}/${dates.length} 天`,
    '',
    '每日明细：',
    dayLines,
    '',
    '可观察信号：',
    signals.length > 0 ? signals.map((s) => `- [${s.kind}] ${s.description}`).join('\n') : '- （无显著信号）',
  ].join('\n');

  return {
    period: { type: reviewType, startDate, endDate, expectedDays: dates.length },
    coverage,
    totals,
    daily,
    taskFacts,
    signals,
    text,
  };
}

/** 日复盘简化文本（单日，不需要分桶趋势，但要使用覆盖率与信号） */
export function buildDailyReviewText(
  date: string,
  todos: Todo[],
  focusSessions: FocusSession[],
  appMinutes: number | undefined
): string {
  const evidence = buildReviewEvidence({
    reviewType: 'daily',
    dates: [date],
    todos,
    focusSessions,
    usageByDate:
      appMinutes !== undefined ? new Map([[date, appMinutes]]) : new Map(),
  });
  return evidence.text;
}

/** 判断一个完成状态是否在区间内完成（历史任务 completedAt 判定，防统计漂移） */
export const completedWithin = (todo: Todo, endDate: string): boolean =>
  todo.status === 'completed' && (todo.completedAt?.slice(0, 10) ?? endDate) <= endDate;

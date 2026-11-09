export type ReminderKind = 'study' | 'review' | 'reflection';
export type ReminderRepeat = 'once' | 'daily' | 'weekly';
export type ReminderAction = 'snooze' | 'skip' | 'stop' | 'complete';
export interface LearningReminder {
  id: string;
  title: string;
  kind: ReminderKind;
  dueAt: string;
  anchorAt: string;
  repeat: ReminderRepeat;
  state: 'scheduled' | 'stopped' | 'completed' | 'skipped';
  knowledgeId?: string;
  reviewId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  history: { at: string; action: ReminderAction; previousDueAt: string }[];
}

/** Advance the local calendar, retaining the chosen wall-clock time across DST. */
export function nextReminderDate(anchorAt: string, repeat: ReminderRepeat, after: string): string | undefined {
  if (repeat === 'once') return undefined;
  const date = new Date(anchorAt);
  const step = repeat === 'daily' ? 1 : 7;
  const elapsedDays = Math.floor((Date.parse(after) - date.getTime()) / 86400000);
  if (elapsedDays > step) date.setDate(date.getDate() + Math.floor(elapsedDays / step) * step);
  do { date.setDate(date.getDate() + step); } while (date.getTime() <= Date.parse(after));
  return date.toISOString();
}

export function actOnReminder(reminder: LearningReminder, action: ReminderAction, at: string, snoozeUntil?: string): LearningReminder {
  if (!['snooze', 'skip', 'stop', 'complete'].includes(action)) throw new Error('提醒操作不正确。');
  if (reminder.state !== 'scheduled') throw new Error('提醒已经结束，请刷新列表。');
  if (action === 'snooze' && (!snoozeUntil || !Number.isFinite(Date.parse(snoozeUntil)) || Date.parse(snoozeUntil) <= Math.max(Date.parse(at), Date.parse(reminder.dueAt)))) {
    throw new Error('延后时间必须晚于现在和原定时间。');
  }
  const next = action === 'skip' || action === 'complete' ? nextReminderDate(reminder.anchorAt, reminder.repeat, at) : undefined;
  return {
    ...reminder,
    state: action === 'stop' ? 'stopped' : action === 'snooze' || next ? 'scheduled' : action === 'skip' ? 'skipped' : 'completed',
    dueAt: action === 'snooze' ? snoozeUntil! : next ?? reminder.dueAt,
    anchorAt: next ?? reminder.anchorAt,
    revision: reminder.revision + 1, updatedAt: at,
    history: [...reminder.history, { at, action, previousDueAt: reminder.dueAt }],
  };
}

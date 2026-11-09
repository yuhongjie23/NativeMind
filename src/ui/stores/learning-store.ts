import { create } from 'zustand';
import type { LearningReminder, LearningKnowledge, ReminderDeliveryStatus, ReminderAction } from '@application/ports';
import { describeError, useCases } from './runtime';
import type { ManageRemindersUseCase, TrackKnowledgeUseCase } from '@application/use-cases/learning';

interface LearningState {
  reminders: LearningReminder[];
  knowledge: LearningKnowledge[];
  delivery?: ReminderDeliveryStatus;
  busy: boolean;
  error?: string;
  clock: number;
  refresh: () => Promise<void>;
  createReminder: (input: Parameters<ManageRemindersUseCase['create']>[0]) => Promise<boolean>;
  act: (reminder: LearningReminder, action: ReminderAction, until?: string) => Promise<boolean>;
  record: (input: Parameters<TrackKnowledgeUseCase['record']>[0]) => Promise<boolean>;
  enableSystem: (enabled: boolean) => Promise<boolean>;
  retrySystem: () => Promise<boolean>;
}
export const useLearningStore = create<LearningState>((set, get) => {
  const write = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (get().busy) return false;
    set({ busy: true, error: undefined });
    try { await action(); if (refreshing) await refreshing; await get().refresh(); return true; }
    catch (error) { set({ error: describeError(error) }); return false; }
    finally { set({ busy: false }); }
  };
  let refreshing: Promise<void> | undefined;
  return {
    reminders: [], knowledge: [], busy: false, clock: Date.now(),
    refresh: async () => {
      if (!useCases.learningReminders || !useCases.trackKnowledge) return;
      refreshing ??= (async () => {
        try {
          const [reminders, knowledge, delivery] = await Promise.all([
            useCases.learningReminders!.list(), useCases.trackKnowledge!.list(), useCases.learningReminders!.sync(),
          ]);
          set({ reminders, knowledge, delivery, clock: Date.now() });
        } catch (error) { set({ error: describeError(error) }); }
      })().finally(() => { refreshing = undefined; });
      await refreshing;
    },
    createReminder: input => write(() => useCases.learningReminders!.create(input)),
    act: (reminder, action, until) => write(() => useCases.learningReminders!.act(reminder.id, action, reminder.revision, until)),
    record: input => write(() => useCases.trackKnowledge!.record(input)),
    enableSystem: enabled => write(() => useCases.learningReminders!.setSystemEnabled(enabled)),
    retrySystem: () => write(() => useCases.learningReminders!.retrySync()),
  };
});

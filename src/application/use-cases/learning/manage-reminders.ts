import { actOnReminder } from '@domain/learning';
import type { LearningRepository, LearningReminder, ReminderAction, ReminderKind, ReminderRepeat, ReminderNotificationPort, ReminderDeliveryStatus, SettingsKeyValuePort } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { newId, now } from '../../shared/utils';

const ENABLED_KEY = 'learning.closedNotifications';
export class ManageRemindersUseCase {
  private syncing: Promise<void> = Promise.resolve();
  private fingerprint = '';
  status: ReminderDeliveryStatus = { supported: false, enabled: false, scheduled: 0, message: '系统提醒未启用；应用内仍显示到期事项。' };
  constructor(private readonly repo: LearningRepository, private readonly settings: SettingsKeyValuePort,
    private readonly notifications: ReminderNotificationPort, private readonly focus: FocusModePolicy) {}

  list() { return this.repo.listReminders(); }
  async create(input: { title: string; kind: ReminderKind; dueAt: string; repeat: ReminderRepeat; knowledgeId?: string; reviewId?: string }): Promise<LearningReminder> {
    const title = input.title.trim();
    if (!title || title.length > 120) throw new Error('提醒标题请填写 1～120 字。');
    if (!['study', 'review', 'reflection'].includes(input.kind) || !['once', 'daily', 'weekly'].includes(input.repeat)) throw new Error('提醒类型不正确。');
    const timestamp = now();
    if (!Number.isFinite(Date.parse(input.dueAt)) || Date.parse(input.dueAt) <= Date.parse(timestamp)) throw new Error('请选择未来的提醒时间。');
    if ((await this.repo.listReminders()).filter(item => item.state === 'scheduled').length >= 64) throw new Error('最多同时保留 64 条待办提醒，请先停止不再需要的提醒。');
    if (input.knowledgeId && !await this.repo.findKnowledge(input.knowledgeId)) throw new Error('知识条目已不存在。');
    const dueAt = new Date(input.dueAt).toISOString();
    const reminder: LearningReminder = { ...input, title, id: newId(), dueAt, anchorAt: dueAt, state: 'scheduled', revision: 1, createdAt: timestamp, updatedAt: timestamp, history: [] };
    if (!await this.repo.saveReminder(reminder, null)) throw new Error('未能保存提醒，请重试。');
    await this.sync(); return reminder;
  }
  async act(id: string, action: ReminderAction, expectedRevision: number, snoozeUntil?: string): Promise<void> {
    const current = await this.repo.findReminder(id);
    if (!current || current.revision !== expectedRevision) throw new Error('提醒已变化，请刷新后再操作。');
    const updated = actOnReminder(current, action, now(), snoozeUntil);
    if (!await this.repo.saveReminder(updated, expectedRevision)) throw new Error('提醒已变化，请刷新后再操作。');
    await this.sync();
  }
  async setSystemEnabled(enabled: boolean): Promise<void> {
    await this.settings.set(ENABLED_KEY, enabled ? 'true' : 'false');
    this.fingerprint = ''; await this.sync();
  }
  /** Serialized reconciliation prevents an old snooze snapshot restoring a stopped notification. */
  async sync(): Promise<ReminderDeliveryStatus> {
    const work = async () => {
      const enabled = await this.settings.get(ENABLED_KEY) === 'true';
      const quiet = this.focus.isActive();
      const future = enabled && !quiet ? (await this.repo.listReminders())
        .filter(item => item.state === 'scheduled')
        .map(({ id, title, dueAt }) => ({ id, title, dueAt })).sort((a, b) => a.id.localeCompare(b.id)) : [];
      const fingerprint = JSON.stringify({ enabled, quiet, future });
      if (fingerprint === this.fingerprint) return;
      try {
        const status = await this.notifications.sync(future);
        this.status = { ...status, enabled, message: quiet && enabled ? '专注期间暂停系统提醒，结束专注后恢复。' : !enabled ? '系统提醒已关闭；到期事项仍保留在应用内。' : status.message };
        this.fingerprint = fingerprint;
      } catch (error) {
        this.status = { supported: false, enabled, scheduled: 0, message: `提醒已保存在本地，但系统通知同步失败：${error instanceof Error ? error.message : String(error)}。请重新同步。` };
      }
    };
    this.syncing = this.syncing.then(work, work);
    await this.syncing; return this.status;
  }
  async retrySync() { this.fingerprint = ''; return this.sync(); }
}

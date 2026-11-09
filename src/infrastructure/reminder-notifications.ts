import type { ReminderNotificationPort, ReminderDeliveryStatus } from '@application/ports';
export function createReminderNotifications(invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>): ReminderNotificationPort {
  return { sync: reminders => invoke<ReminderDeliveryStatus>('learning_notifications_sync', { reminders }) };
}

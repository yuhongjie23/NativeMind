/**
 * 审计订阅者 - 记录所有写入型事件
 */
import type { AuditRepository } from '../../ports';
import type { EventBus } from '../event-bus';
import type { DomainEventType } from '../event-types';

const WRITE_EVENTS: DomainEventType[] = [
  'TodoConfirmed',
  'TodoCompleted',
  'KnowledgeLinkConfirmed',
  'FocusSessionCompleted',
  'FocusSessionAborted',
  'NoteImported',
  'NoteUpdated',
  'NoteDeleted',
  'ReviewGenerated',
];

export function registerAuditSubscriber(
  eventBus: EventBus,
  auditRepo: AuditRepository
): () => void {
  const unsubscribes = WRITE_EVENTS.map((eventType) =>
    eventBus.subscribe(eventType, async (event) => {
      await auditRepo.log({
        eventType: event.type,
        payload: event,
        timestamp: event.timestamp,
      });
    })
  );

  return () => unsubscribes.forEach((off) => off());
}

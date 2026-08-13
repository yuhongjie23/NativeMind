/**
 * 领域事件总线
 * 同步派发；订阅者失败不影响主流程。
 */
import type { DomainEvent, DomainEventType, EventHandler } from './event-types';

/** 由事件名映射到具体事件类型，订阅者回调因此获得精确类型 */
export type EventOf<K extends DomainEventType> = Extract<DomainEvent, { type: K }>;

export interface EventBus {
  subscribe<K extends DomainEventType>(eventType: K, handler: EventHandler<EventOf<K>>): () => void;
  publish(event: DomainEvent): Promise<void>;
  clear(): void;
}

export class SimpleEventBus implements EventBus {
  private handlers = new Map<DomainEventType, EventHandler[]>();

  subscribe<K extends DomainEventType>(eventType: K, handler: EventHandler<EventOf<K>>) {
    const list = this.handlers.get(eventType) ?? [];

    list.push(handler as EventHandler);
    this.handlers.set(eventType, list);

    return () => {
      const current = this.handlers.get(eventType);
      if (!current) return;
      const index = current.indexOf(handler as EventHandler);
      if (index > -1) current.splice(index, 1);
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    const results = await Promise.allSettled(
      handlers.map((handler) => Promise.resolve(handler(event)))
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`[EventBus] subscriber #${index} failed for ${event.type}:`, result.reason);
      }
    });
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** 全局单例 */
export const eventBus: EventBus = new SimpleEventBus();

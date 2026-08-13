/**
 * 领域事件类型（转发 + UI 侧事件）
 *
 * 领域事件的定义在 application/events/event-types，这里转发出来，
 * 再补几个只在 UI 内部流转、不进事件总线的类型。
 */
export type {
  DomainEvent,
  DomainEventType,
  EventHandler,
} from '@application/events/event-types';

/** UI 提示条。用例失败时给用户一句人话，不弹阻塞式对话框 */
export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/** 宠物动画触发。CompanionWidget 消费，接入真实资源后映射到动画名 */
export type CompanionAnimation =
  | 'idle'
  | 'greet'
  | 'cheer'
  | 'sleep'
  | 'concerned';

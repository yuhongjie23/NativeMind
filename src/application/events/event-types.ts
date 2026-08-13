/**
 * 领域事件类型定义
 * 原则：事件是通知而非命令，只带必要字段，详情由订阅者自行查询。
 */
import type { ISO8601DateTime, UUID } from '@shared-types/common';

interface BaseEvent {
  timestamp: ISO8601DateTime;
}

/* ---------- 应用生命周期 ---------- */

export interface AppEnteredEvent extends BaseEvent {
  type: 'AppEntered';
  isFirstLaunch: boolean;
}

export interface AppExitingEvent extends BaseEvent {
  type: 'AppExiting';
  unsavedChanges: boolean;
}

/* ---------- 专注 ---------- */

export interface FocusSessionStartedEvent extends BaseEvent {
  type: 'FocusSessionStarted';
  sessionId: UUID;
  todoId?: UUID;
  durationMinutes: number;
}

export interface FocusSessionCompletedEvent extends BaseEvent {
  type: 'FocusSessionCompleted';
  sessionId: UUID;
  todoId?: UUID;
  actualMinutes: number;
}

export interface FocusSessionAbortedEvent extends BaseEvent {
  type: 'FocusSessionAborted';
  sessionId: UUID;
  todoId?: UUID;
  elapsedMinutes: number;
  reason?: string;
}

export interface TaskRepeatedlyAbortedEvent extends BaseEvent {
  type: 'TaskRepeatedlyAborted';
  todoId: UUID;
  abortCount: number;
}

/* ---------- Todo ---------- */

export interface TodoConfirmedEvent extends BaseEvent {
  type: 'TodoConfirmed';
  todoIds: UUID[];
  source: 'ai_suggestion' | 'user_manual';
}

export interface TodoCompletedEvent extends BaseEvent {
  type: 'TodoCompleted';
  todoId: UUID;
  completedAt: ISO8601DateTime;
}

export interface TodoUpdatedEvent extends BaseEvent {
  type: 'TodoUpdated';
  todoId: UUID;
}

export interface TodoDeletedEvent extends BaseEvent {
  type: 'TodoDeleted';
  todoId: UUID;
}

/* ---------- 笔记 ---------- */

export interface NoteImportedEvent extends BaseEvent {
  type: 'NoteImported';
  noteId: UUID;
  sourceType: 'pdf' | 'markdown' | 'text';
}

export interface NoteIndexedEvent extends BaseEvent {
  type: 'NoteIndexed';
  noteId: UUID;
  chunkCount: number;
}

export interface NoteUpdatedEvent extends BaseEvent {
  type: 'NoteUpdated';
  noteId: UUID;
  contentChanged: boolean;
}

export interface NoteDeletedEvent extends BaseEvent {
  type: 'NoteDeleted';
  noteId: UUID;
}

/* ---------- 知识链接 ---------- */

export interface KnowledgeLinkConfirmedEvent extends BaseEvent {
  type: 'KnowledgeLinkConfirmed';
  linkIds: UUID[];
}

/* ---------- 复盘 ---------- */

export interface ReviewGeneratedEvent extends BaseEvent {
  type: 'ReviewGenerated';
  reviewId: UUID;
  reviewType: 'daily' | 'weekly' | 'monthly';
  date: string;
}

export interface ReviewDeletedEvent extends BaseEvent {
  type: 'ReviewDeleted';
  reviewId: UUID;
}

/* ---------- 陪伴角色 ---------- */

/** 任意互动创建后发布：UI 订阅它把台词送到主场景（P0-2，统一事件通道） */
export interface CompanionInteractionCreatedEvent extends BaseEvent {
  type: 'CompanionInteractionCreated';
  interactionId: UUID;
  scene: string;
  /** 模型的快捷回应（随这句话展示，UI 状态机用） */
  quickReplies?: string[];
}

export interface CompanionInteractionCompletedEvent extends BaseEvent {
  type: 'CompanionInteractionCompleted';
  interactionId: UUID;
  response: string;
}

/* ---------- 苏格拉底提问 ---------- */

export interface SocraticSessionStartedEvent extends BaseEvent {
  type: 'SocraticSessionStarted';
  sessionId: UUID;
  topic: string;
}

export type DomainEvent =
  | AppEnteredEvent
  | AppExitingEvent
  | FocusSessionStartedEvent
  | FocusSessionCompletedEvent
  | FocusSessionAbortedEvent
  | TaskRepeatedlyAbortedEvent
  | TodoConfirmedEvent
  | TodoCompletedEvent
  | TodoUpdatedEvent
  | TodoDeletedEvent
  | NoteImportedEvent
  | NoteIndexedEvent
  | NoteUpdatedEvent
  | NoteDeletedEvent
  | KnowledgeLinkConfirmedEvent
  | ReviewGeneratedEvent
  | ReviewDeletedEvent
  | CompanionInteractionCreatedEvent
  | CompanionInteractionCompletedEvent
  | SocraticSessionStartedEvent;

export type DomainEventType = DomainEvent['type'];

export type EventHandler<T extends DomainEvent = DomainEvent> = (
  event: T
) => void | Promise<void>;

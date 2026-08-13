# 领域事件系统设计

## 概述

领域事件系统是 NativeMind 模块解耦的核心机制。通过事件总线，各模块无需直接依赖即可响应业务变化。

## 核心原则

1. **事件是通知，不是命令**：发布者不关心有没有订阅者
2. **订阅者失败不回滚主流程**：陪伴动画失败不能影响番茄钟计时
3. **事件只带必要字段**：需要详情由订阅者自己查询
4. **同步派发**：不引入消息队列，保持简单
5. **受专注模式约束**：订阅者触发 AI 行为前必须过 `FocusModePolicy`

---

## 事件定义

### 应用生命周期事件

```typescript
// 进入应用
interface AppEnteredEvent {
  type: 'AppEntered';
  timestamp: string;
  isFirstLaunch: boolean;
}

// 退出应用
interface AppExitingEvent {
  type: 'AppExiting';
  timestamp: string;
  unsavedChanges: boolean;
}
```

### 专注相关事件

```typescript
// 开始专注
interface FocusSessionStartedEvent {
  type: 'FocusSessionStarted';
  sessionId: string;
  todoId?: string;
  durationMinutes: number;
  timestamp: string;
}

// 完成专注
interface FocusSessionCompletedEvent {
  type: 'FocusSessionCompleted';
  sessionId: string;
  todoId?: string;
  actualMinutes: number;
  timestamp: string;
}

// 中断专注
interface FocusSessionAbortedEvent {
  type: 'FocusSessionAborted';
  sessionId: string;
  todoId?: string;
  elapsedMinutes: number;
  reason?: string;
  timestamp: string;
}

// 任务反复中断
interface TaskRepeatedlyAbortedEvent {
  type: 'TaskRepeatedlyAborted';
  todoId: string;
  abortCount: number;
  timestamp: string;
}
```

### Todo 相关事件

```typescript
// Todo 已确认写入
interface TodoConfirmedEvent {
  type: 'TodoConfirmed';
  todoIds: string[];
  source: 'ai_suggestion' | 'user_manual';
  timestamp: string;
}

// Todo 完成
interface TodoCompletedEvent {
  type: 'TodoCompleted';
  todoId: string;
  completedAt: string;
  timestamp: string;
}
```

### 笔记相关事件

```typescript
// 导入笔记
interface NoteImportedEvent {
  type: 'NoteImported';
  noteId: string;
  sourceType: 'pdf' | 'markdown' | 'text';
  timestamp: string;
}

// 笔记已索引
interface NoteIndexedEvent {
  type: 'NoteIndexed';
  noteId: string;
  chunkCount: number;
  timestamp: string;
}
```

### 知识链接事件

```typescript
// 知识链接已确认
interface KnowledgeLinkConfirmedEvent {
  type: 'KnowledgeLinkConfirmed';
  linkIds: string[];
  timestamp: string;
}
```

### 复盘相关事件

```typescript
// 生成复盘
interface ReviewGeneratedEvent {
  type: 'ReviewGenerated';
  reviewId: string;
  reviewType: 'daily' | 'weekly';
  date: string;
  timestamp: string;
}
```

---

## 事件总线实现

### EventBus 接口

```typescript
// src/application/events/event-bus.ts

type DomainEvent = 
  | AppEnteredEvent
  | AppExitingEvent
  | FocusSessionStartedEvent
  | FocusSessionCompletedEvent
  | FocusSessionAbortedEvent
  | TaskRepeatedlyAbortedEvent
  | TodoConfirmedEvent
  | TodoCompletedEvent
  | NoteImportedEvent
  | NoteIndexedEvent
  | KnowledgeLinkConfirmedEvent
  | ReviewGeneratedEvent;

type EventHandler<T extends DomainEvent> = (event: T) => void | Promise<void>;

interface EventBus {
  // 订阅事件
  subscribe<T extends DomainEvent>(
    eventType: T['type'],
    handler: EventHandler<T>
  ): () => void; // 返回取消订阅函数

  // 发布事件
  publish(event: DomainEvent): Promise<void>;

  // 清空所有订阅（测试用）
  clear(): void;
}
```

### 实现要点

```typescript
class SimpleEventBus implements EventBus {
  private handlers = new Map<string, EventHandler<any>[]>();

  subscribe<T extends DomainEvent>(
    eventType: T['type'],
    handler: EventHandler<T>
  ) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  async publish(event: DomainEvent) {
    const handlers = this.handlers.get(event.type) || [];
    
    // 同步派发，但允许异步处理
    await Promise.allSettled(
      handlers.map(handler => {
        try {
          return Promise.resolve(handler(event));
        } catch (error) {
          // 订阅者失败不影响主流程
          console.error(`Event handler failed for ${event.type}:`, error);
          return Promise.resolve();
        }
      })
    );
  }

  clear() {
    this.handlers.clear();
  }
}

// 全局单例
export const eventBus = new SimpleEventBus();
```

---

## 事件订阅者

### 1. 陪伴角色订阅者

```typescript
// src/application/events/subscribers/companion-subscriber.ts

import { eventBus } from '../event-bus';
import { CompanionStateMachine } from '@/domain/companion/state-machine';
import { FocusModePolicy } from '@/application/policies/focus-mode-policy';

export function registerCompanionSubscriber(
  stateMachine: CompanionStateMachine,
  focusPolicy: FocusModePolicy
) {
  // 进入应用
  eventBus.subscribe('AppEntered', async (event) => {
    if (!focusPolicy.canInterrupt('companion_dialogue')) return;
    await stateMachine.transition('enter', event);
  });

  // 开始专注
  eventBus.subscribe('FocusSessionStarted', async (event) => {
    // 专注开始时可以短暂鼓励，然后进入安静状态
    await stateMachine.transition('focus_start', event);
  });

  // 完成专注
  eventBus.subscribe('FocusSessionCompleted', async (event) => {
    if (!focusPolicy.canInterrupt('companion_dialogue')) return;
    await stateMachine.transition('focus_complete', event);
  });

  // 中断专注
  eventBus.subscribe('FocusSessionAborted', async (event) => {
    if (!focusPolicy.canInterrupt('companion_dialogue')) return;
    await stateMachine.transition('focus_abort', event);
  });

  // 反复中断
  eventBus.subscribe('TaskRepeatedlyAborted', async (event) => {
    if (!focusPolicy.canInterrupt('companion_dialogue')) return;
    // 询问是否需要降低任务难度
    await stateMachine.transition('encourage', event);
  });

  // 退出应用
  eventBus.subscribe('AppExiting', async (event) => {
    await stateMachine.transition('exit', event);
  });
}
```

### 2. 复盘订阅者

```typescript
// src/application/events/subscribers/review-subscriber.ts

import { eventBus } from '../event-bus';
import { GenerateDailyReviewUseCase } from '@/application/use-cases/review/generate-daily-review';

export function registerReviewSubscriber(
  generateDailyReview: GenerateDailyReviewUseCase
) {
  // 完成专注后可能触发复盘
  eventBus.subscribe('FocusSessionCompleted', async (event) => {
    // 检查今天是否还没有复盘
    const today = new Date().toISOString().split('T')[0];
    const existingReview = await reviewRepository.findByDate(today);
    
    if (!existingReview) {
      // 生成复盘草稿（不自动写库）
      await generateDailyReview.execute({ date: today });
    }
  });

  // Todo 完成也可能触发
  eventBus.subscribe('TodoCompleted', async (event) => {
    // 类似逻辑
  });
}
```

### 3. 审计订阅者

```typescript
// src/application/events/subscribers/audit-subscriber.ts

import { eventBus } from '../event-bus';
import { AuditRepository } from '@/infrastructure/db/repositories/audit-repository';

export function registerAuditSubscriber(auditRepo: AuditRepository) {
  // 记录所有写入型事件
  const writeEvents = [
    'TodoConfirmed',
    'KnowledgeLinkConfirmed',
    'FocusSessionCompleted',
    'FocusSessionAborted'
  ];

  writeEvents.forEach(eventType => {
    eventBus.subscribe(eventType as any, async (event) => {
      await auditRepo.log({
        eventType: event.type,
        payload: event,
        timestamp: event.timestamp
      });
    });
  });
}
```

### 4. RAG 订阅者

```typescript
// src/application/events/subscribers/rag-subscriber.ts

import { eventBus } from '../event-bus';
import { BackgroundJobQueue } from '@/infrastructure/background-jobs/job-queue';

export function registerRAGSubscriber(jobQueue: BackgroundJobQueue) {
  // 导入笔记后触发切分和 embedding
  eventBus.subscribe('NoteImported', async (event) => {
    // 入队，不在这里直接执行
    await jobQueue.enqueue({
      type: 'parse_note',
      entityId: event.noteId,
      payload: { noteId: event.noteId }
    });
  });

  // Todo 确认后检索相关笔记
  eventBus.subscribe('TodoConfirmed', async (event) => {
    // 为新 Todo 查找相关知识（非阻塞）
    for (const todoId of event.todoIds) {
      await ragOrchestrator.suggestRelatedNotes(todoId);
    }
  });
}
```

---

## 订阅者注册

在应用启动时统一注册：

```typescript
// src/main.tsx 或 src/application/bootstrap.ts

import { eventBus } from '@/application/events/event-bus';
import { registerCompanionSubscriber } from '@/application/events/subscribers/companion-subscriber';
import { registerReviewSubscriber } from '@/application/events/subscribers/review-subscriber';
import { registerAuditSubscriber } from '@/application/events/subscribers/audit-subscriber';
import { registerRAGSubscriber } from '@/application/events/subscribers/rag-subscriber';

export function bootstrapEventSystem(dependencies) {
  registerCompanionSubscriber(
    dependencies.companionStateMachine,
    dependencies.focusPolicy
  );

  registerReviewSubscriber(
    dependencies.generateDailyReview
  );

  registerAuditSubscriber(
    dependencies.auditRepository
  );

  registerRAGSubscriber(
    dependencies.jobQueue
  );
}
```

---

## 在用例中发布事件

```typescript
// src/application/use-cases/focus/complete-focus.ts

import { eventBus } from '@/application/events/event-bus';

export class CompleteFocusUseCase {
  async execute(sessionId: string) {
    // 1. 业务逻辑
    const session = await this.focusRepository.findById(sessionId);
    session.complete();
    await this.focusRepository.save(session);

    // 2. 发布事件
    await eventBus.publish({
      type: 'FocusSessionCompleted',
      sessionId: session.id,
      todoId: session.todoId,
      actualMinutes: session.actualMinutes,
      timestamp: new Date().toISOString()
    });

    // 3. 返回结果
    return session;
  }
}
```

---

## 重任务处理

对于耗时操作（切分、embedding、重建索引），订阅者只负责入队：

```typescript
eventBus.subscribe('NoteImported', async (event) => {
  // 不要在这里直接执行耗时操作
  // ❌ await chunkNote(event.noteId);
  
  // ✅ 入队，交给后台任务处理
  await jobQueue.enqueue({
    type: 'parse_note',
    entityId: event.noteId
  });
});
```

后台任务系统负责：
- 幂等性：同一任务重复执行不产生重复数据
- 重试：失败后指数退避重试
- 可观测：用户能看到任务进度和失败原因
- 受专注约束：专注期间不启动占用模型资源的任务

---

## 测试

### 单元测试

```typescript
describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new SimpleEventBus();
  });

  it('should notify subscribers', async () => {
    const handler = jest.fn();
    bus.subscribe('FocusSessionCompleted', handler);

    await bus.publish({
      type: 'FocusSessionCompleted',
      sessionId: 'session_001',
      actualMinutes: 25,
      timestamp: new Date().toISOString()
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should allow unsubscribe', async () => {
    const handler = jest.fn();
    const unsubscribe = bus.subscribe('FocusSessionCompleted', handler);
    
    unsubscribe();

    await bus.publish({
      type: 'FocusSessionCompleted',
      sessionId: 'session_001',
      actualMinutes: 25,
      timestamp: new Date().toISOString()
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not fail when subscriber throws', async () => {
    bus.subscribe('FocusSessionCompleted', () => {
      throw new Error('Subscriber failed');
    });

    // 不应该抛出异常
    await expect(
      bus.publish({
        type: 'FocusSessionCompleted',
        sessionId: 'session_001',
        actualMinutes: 25,
        timestamp: new Date().toISOString()
      })
    ).resolves.not.toThrow();
  });
});
```

---

## 可观测性

记录事件发布和订阅者执行情况：

```typescript
async publish(event: DomainEvent) {
  console.debug(`[EventBus] Publishing ${event.type}`, event);
  
  const handlers = this.handlers.get(event.type) || [];
  console.debug(`[EventBus] ${handlers.length} subscribers for ${event.type}`);

  const results = await Promise.allSettled(
    handlers.map(handler => Promise.resolve(handler(event)))
  );

  // 记录失败
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `[EventBus] Subscriber ${index} failed for ${event.type}:`,
        result.reason
      );
    }
  });
}
```

---

## 与宠物互动的集成

宠物主动提问通过事件触发，但必须：

1. **先过 FocusModePolicy**：专注期间不提问
2. **先过 InteractionPolicy**：控制提问频率
3. **问题生成是 AI 任务**：走 AI 编排层
4. **需要用户确认**：不自动打断用户

详见 `docs/宠物互动接口补充方案.md`

---

## 扩展性

加新功能时的标准路径：

| 想做什么 | 怎么做 |
|---------|-------|
| 新统计功能 | 订阅相关事件，独立计算 |
| 新成就系统 | 订阅 TodoCompleted、FocusSessionCompleted 等 |
| 新通知 | 订阅事件，调用通知 Provider |
| 新角色场景 | 在 CompanionSubscriber 中加逻辑 |

核心：**加订阅者，不改发布者**。

---

## 下一步

1. 实现 `EventBus` 和基础订阅者
2. 在所有用例中发布相应事件
3. 编写事件系统的集成测试
4. 配置事件日志（可选，用于调试）

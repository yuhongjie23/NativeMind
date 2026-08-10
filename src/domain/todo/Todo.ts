/**
 * Todo 领域模型
 * 核心规则：
 * - 标题不能为空且长度不超过 200 字符
 * - 估计时长必须为正数
 * - 优先级只能是预定义的枚举值
 * - 状态转换必须符合规则
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * Todo 状态
 */
export enum TodoStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

/**
 * 优先级
 */
export enum TodoPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Todo 实体
 */
export interface Todo extends Entity {
  title: string;
  description?: string;
  sourceGoalId?: UUID;
  status: TodoStatus;
  priority: TodoPriority;
  estimatedMinutes?: number;
  scheduledDate?: ISO8601DateTime;
  tags: string[];
  linkedNoteIds: UUID[];
  completedAt?: ISO8601DateTime;
}

/**
 * Todo 创建参数
 */
export interface CreateTodoParams {
  title: string;
  description?: string;
  sourceGoalId?: UUID;
  priority?: TodoPriority;
  estimatedMinutes?: number;
  scheduledDate?: ISO8601DateTime;
  tags?: string[];
}

/**
 * Todo 领域服务
 */
export class TodoDomainService {
  /**
   * 验证 Todo 标题
   */
  static validateTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new ValidationError('Todo 标题不能为空', ['title: 标题不能为空']);
    }
    if (title.length > 200) {
      throw new ValidationError('Todo 标题过长', ['title: 标题不能超过 200 字符']);
    }
  }

  /**
   * 验证估计时长
   */
  static validateEstimatedMinutes(minutes?: number): void {
    if (minutes !== undefined && minutes <= 0) {
      throw new ValidationError('估计时长必须为正数', [
        'estimatedMinutes: 必须大于 0',
      ]);
    }
  }

  /**
   * 验证 Todo 创建参数
   */
  static validateCreateParams(params: CreateTodoParams): void {
    this.validateTitle(params.title);
    this.validateEstimatedMinutes(params.estimatedMinutes);
  }

  /**
   * 检查状态转换是否合法
   */
  static canTransitionTo(from: TodoStatus, to: TodoStatus): boolean {
    const allowedTransitions: Record<TodoStatus, TodoStatus[]> = {
      [TodoStatus.PENDING]: [
        TodoStatus.IN_PROGRESS,
        TodoStatus.ABANDONED,
        TodoStatus.COMPLETED,
      ],
      [TodoStatus.IN_PROGRESS]: [
        TodoStatus.COMPLETED,
        TodoStatus.ABANDONED,
        TodoStatus.PENDING,
      ],
      [TodoStatus.COMPLETED]: [], // 完成后不能再转换
      [TodoStatus.ABANDONED]: [TodoStatus.PENDING], // 放弃后可以重新激活
    };

    return allowedTransitions[from].includes(to);
  }

  /**
   * 验证状态转换
   */
  static validateStatusTransition(from: TodoStatus, to: TodoStatus): void {
    if (!this.canTransitionTo(from, to)) {
      throw new ValidationError(`无法从 ${from} 转换到 ${to}`, [
        `status: 不允许从 ${from} 转换到 ${to}`,
      ]);
    }
  }

  /**
   * 创建 Todo
   */
  static create(params: CreateTodoParams, id: UUID, now: ISO8601DateTime): Todo {
    this.validateCreateParams(params);

    return {
      id,
      title: params.title.trim(),
      description: params.description?.trim(),
      sourceGoalId: params.sourceGoalId,
      status: TodoStatus.PENDING,
      priority: params.priority || TodoPriority.MEDIUM,
      estimatedMinutes: params.estimatedMinutes,
      scheduledDate: params.scheduledDate,
      tags: params.tags || [],
      linkedNoteIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 更新 Todo 状态
   */
  static updateStatus(
    todo: Todo,
    newStatus: TodoStatus,
    now: ISO8601DateTime
  ): Todo {
    this.validateStatusTransition(todo.status, newStatus);

    const updated: Todo = {
      ...todo,
      status: newStatus,
      updatedAt: now,
    };

    // 如果转换为完成状态，记录完成时间
    if (newStatus === TodoStatus.COMPLETED) {
      updated.completedAt = now;
    }

    return updated;
  }

  /**
   * 添加标签
   */
  static addTag(todo: Todo, tag: string, now: ISO8601DateTime): Todo {
    const normalizedTag = tag.trim().toLowerCase();
    
    if (!normalizedTag) {
      throw new ValidationError('标签不能为空', ['tag: 标签不能为空']);
    }

    if (todo.tags.includes(normalizedTag)) {
      return todo; // 标签已存在，不重复添加
    }

    return {
      ...todo,
      tags: [...todo.tags, normalizedTag],
      updatedAt: now,
    };
  }

  /**
   * 关联笔记
   */
  static linkNote(todo: Todo, noteId: UUID, now: ISO8601DateTime): Todo {
    if (todo.linkedNoteIds.includes(noteId)) {
      return todo; // 已关联，不重复添加
    }

    return {
      ...todo,
      linkedNoteIds: [...todo.linkedNoteIds, noteId],
      updatedAt: now,
    };
  }
}

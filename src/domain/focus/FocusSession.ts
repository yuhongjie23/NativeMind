/**
 * FocusSession 领域模型
 * 专注会话记录
 * 核心规则：
 * - 专注时长必须为正数
 * - 状态转换必须符合规则
 * - 只有进行中的会话可以暂停或完成
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 专注状态
 */
export enum FocusState {
  ACTIVE = 'active',           // 进行中
  PAUSED = 'paused',           // 暂停
  COMPLETED = 'completed',     // 完成
  ABORTED = 'aborted',         // 中断
}

/**
 * 专注会话实体
 */
export interface FocusSession extends Entity {
  todoId?: UUID;
  plannedMinutes: number;
  actualMinutes?: number;
  state: FocusState;
  startedAt: ISO8601DateTime;
  completedAt?: ISO8601DateTime;
  abortedAt?: ISO8601DateTime;
  abortReason?: string;
  pausedDuration: number; // 累计暂停时长（分钟）
}

/**
 * 创建专注会话参数
 */
export interface CreateFocusSessionParams {
  todoId?: UUID;
  plannedMinutes: number;
}

/**
 * FocusSession 领域服务
 */
export class FocusSessionDomainService {
  /**
   * 验证计划时长
   */
  static validatePlannedMinutes(minutes: number): void {
    if (minutes <= 0) {
      throw new ValidationError('计划时长必须为正数', [
        'plannedMinutes: 必须大于 0',
      ]);
    }
    if (minutes > 240) {
      throw new ValidationError('单次专注时长不应超过 4 小时', [
        'plannedMinutes: 不应超过 240 分钟',
      ]);
    }
  }

  /**
   * 检查状态转换是否合法
   */
  static canTransitionTo(from: FocusState, to: FocusState): boolean {
    const allowedTransitions: Record<FocusState, FocusState[]> = {
      [FocusState.ACTIVE]: [
        FocusState.PAUSED,
        FocusState.COMPLETED,
        FocusState.ABORTED,
      ],
      [FocusState.PAUSED]: [
        FocusState.ACTIVE,
        FocusState.ABORTED,
      ],
      [FocusState.COMPLETED]: [], // 完成后不能转换
      [FocusState.ABORTED]: [],   // 中断后不能转换
    };

    return allowedTransitions[from].includes(to);
  }

  /**
   * 验证状态转换
   */
  static validateStateTransition(from: FocusState, to: FocusState): void {
    if (!this.canTransitionTo(from, to)) {
      throw new ValidationError(`无法从 ${from} 转换到 ${to}`, [
        `state: 不允许从 ${from} 转换到 ${to}`,
      ]);
    }
  }

  /**
   * 创建专注会话
   */
  static create(
    params: CreateFocusSessionParams,
    id: UUID,
    now: ISO8601DateTime
  ): FocusSession {
    this.validatePlannedMinutes(params.plannedMinutes);

    return {
      id,
      todoId: params.todoId,
      plannedMinutes: params.plannedMinutes,
      state: FocusState.ACTIVE,
      startedAt: now,
      pausedDuration: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 暂停专注会话
   */
  static pause(session: FocusSession, now: ISO8601DateTime): FocusSession {
    this.validateStateTransition(session.state, FocusState.PAUSED);

    return {
      ...session,
      state: FocusState.PAUSED,
      updatedAt: now,
    };
  }

  /**
   * 恢复专注会话
   */
  static resume(
    session: FocusSession,
    pausedMinutes: number,
    now: ISO8601DateTime
  ): FocusSession {
    this.validateStateTransition(session.state, FocusState.ACTIVE);

    return {
      ...session,
      state: FocusState.ACTIVE,
      pausedDuration: session.pausedDuration + pausedMinutes,
      updatedAt: now,
    };
  }

  /**
   * 完成专注会话
   */
  static complete(
    session: FocusSession,
    actualMinutes: number,
    now: ISO8601DateTime
  ): FocusSession {
    this.validateStateTransition(session.state, FocusState.COMPLETED);

    if (actualMinutes <= 0) {
      throw new ValidationError('实际时长必须为正数', [
        'actualMinutes: 必须大于 0',
      ]);
    }

    return {
      ...session,
      state: FocusState.COMPLETED,
      actualMinutes,
      completedAt: now,
      updatedAt: now,
    };
  }

  /**
   * 中断专注会话
   */
  static abort(
    session: FocusSession,
    reason: string,
    actualMinutes: number,
    now: ISO8601DateTime
  ): FocusSession {
    this.validateStateTransition(session.state, FocusState.ABORTED);

    return {
      ...session,
      state: FocusState.ABORTED,
      abortReason: reason.trim(),
      actualMinutes: actualMinutes > 0 ? actualMinutes : undefined,
      abortedAt: now,
      updatedAt: now,
    };
  }

  /**
   * 计算有效专注时长（扣除暂停时间）
   */
  static calculateEffectiveDuration(session: FocusSession): number {
    if (!session.actualMinutes) {
      return 0;
    }
    return Math.max(0, session.actualMinutes - session.pausedDuration);
  }

  /**
   * 判断是否达到计划时长
   */
  static isPlannedDurationReached(session: FocusSession): boolean {
    const effective = this.calculateEffectiveDuration(session);
    return effective >= session.plannedMinutes;
  }
}

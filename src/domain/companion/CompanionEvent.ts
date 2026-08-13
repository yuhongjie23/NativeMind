/**
 * CompanionEvent 领域模型
 * 陪伴角色事件记录
 * 核心规则：
 * - 记录角色在各场景的触发事件
 * - 用于统计和分析角色互动
 */

import { Entity, UUID, ISO8601DateTime } from '@shared-types/common';
import { CompanionScene, CompanionState } from './CompanionProfile';

/**
 * 陪伴事件实体
 */
export interface CompanionEvent extends Entity {
  companionId: UUID;
  scene: CompanionScene;
  state: CompanionState;
  dialogueText?: string;
  animationKey?: string;
  triggeredBy: 'domain_event' | 'user_action' | 'system';
  metadata: Record<string, unknown>;
}

/**
 * 创建陪伴事件参数
 */
export interface CreateCompanionEventParams {
  companionId: UUID;
  scene: CompanionScene;
  state: CompanionState;
  dialogueText?: string;
  animationKey?: string;
  triggeredBy: 'domain_event' | 'user_action' | 'system';
  metadata?: Record<string, unknown>;
}

/**
 * CompanionEvent 领域服务
 */
export class CompanionEventDomainService {
  /**
   * 创建陪伴事件
   */
  static create(
    params: CreateCompanionEventParams,
    id: UUID,
    now: ISO8601DateTime
  ): CompanionEvent {
    return {
      id,
      companionId: params.companionId,
      scene: params.scene,
      state: params.state,
      dialogueText: params.dialogueText,
      animationKey: params.animationKey,
      triggeredBy: params.triggeredBy,
      metadata: params.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 判断事件是否为用户主动触发
   */
  static isUserInitiated(event: CompanionEvent): boolean {
    return event.triggeredBy === 'user_action';
  }

  /**
   * 判断事件是否为系统运行型写入（不需要用户确认）
   */
  static isSystemWrite(event: CompanionEvent): boolean {
    return event.triggeredBy === 'domain_event' || event.triggeredBy === 'system';
  }
}

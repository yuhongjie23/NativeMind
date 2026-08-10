/**
 * Goal 领域模型
 * 学习目标
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * Goal 实体
 */
export interface Goal extends Entity {
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'abandoned';
  targetDate?: ISO8601DateTime;
  tags: string[];
}

/**
 * Goal 创建参数
 */
export interface CreateGoalParams {
  title: string;
  description?: string;
  targetDate?: ISO8601DateTime;
  tags?: string[];
}

/**
 * Goal 领域服务
 */
export class GoalDomainService {
  /**
   * 验证 Goal 标题
   */
  static validateTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new ValidationError('Goal 标题不能为空', ['title: 标题不能为空']);
    }
    if (title.length > 300) {
      throw new ValidationError('Goal 标题过长', ['title: 标题不能超过 300 字符']);
    }
  }

  /**
   * 创建 Goal
   */
  static create(params: CreateGoalParams, id: UUID, now: ISO8601DateTime): Goal {
    this.validateTitle(params.title);

    return {
      id,
      title: params.title.trim(),
      description: params.description?.trim(),
      status: 'active',
      targetDate: params.targetDate,
      tags: params.tags || [],
      createdAt: now,
      updatedAt: now,
    };
  }
}

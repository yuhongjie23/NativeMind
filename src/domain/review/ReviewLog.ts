/**
 * ReviewLog 领域模型
 * 每日/每周复盘
 * 核心规则：
 * - 复盘基于真实数据（Todo完成情况、专注时长、卡点）
 * - 语气克制、具体、不鸡血、不过度拟人
 * - 复盘草稿必须经用户确认才能落库
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 复盘类型
 */
export enum ReviewType {
  DAILY = 'daily',     // 每日复盘
  WEEKLY = 'weekly',   // 每周复盘
}

/**
 * 复盘状态
 */
export enum ReviewStatus {
  DRAFT = 'draft',           // 草稿（AI生成，未确认）
  CONFIRMED = 'confirmed',   // 已确认
  ARCHIVED = 'archived',     // 已归档
}

/**
 * 复盘日志实体
 */
export interface ReviewLog extends Entity {
  type: ReviewType;
  status: ReviewStatus;
  startDate: ISO8601DateTime;  // 复盘起始日期
  endDate: ISO8601DateTime;    // 复盘结束日期
  content: string;             // 复盘内容（Markdown格式）
  
  // 统计数据
  stats: ReviewStats;
  
  // 卡点记录
  blockers: ReviewBlocker[];
  
  // AI建议的新Todo（草稿，需确认）
  suggestedTodos?: string[];
  
  generatedBy: 'ai' | 'user';
}

/**
 * 复盘统计数据
 */
export interface ReviewStats {
  totalTodos: number;
  completedTodos: number;
  totalFocusMinutes: number;
  totalFocusSessions: number;
  completedSessions: number;
  abortedSessions: number;
  notesAdded: number;
  knowledgeLinksCreated: number;
}

/**
 * 复盘卡点
 */
export interface ReviewBlocker {
  todoId: UUID;
  todoTitle: string;
  reason: string;
  repeatCount: number;  // 重复卡住次数
  relatedNoteIds?: UUID[];  // 相关笔记（可能需要复习）
}

/**
 * 创建复盘日志参数
 */
export interface CreateReviewLogParams {
  type: ReviewType;
  startDate: ISO8601DateTime;
  endDate: ISO8601DateTime;
  content: string;
  stats: ReviewStats;
  blockers: ReviewBlocker[];
  suggestedTodos?: string[];
  generatedBy: 'ai' | 'user';
}

/**
 * ReviewLog 领域服务
 */
export class ReviewLogDomainService {
  /**
   * 验证日期范围
   */
  static validateDateRange(
    startDate: ISO8601DateTime,
    endDate: ISO8601DateTime
  ): void {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new ValidationError('起始日期不能晚于结束日期', [
        'dateRange: 起始日期必须早于或等于结束日期',
      ]);
    }
  }

  /**
   * 验证复盘内容
   */
  static validateContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new ValidationError('复盘内容不能为空', ['content: 内容不能为空']);
    }
    if (content.length > 10000) {
      throw new ValidationError('复盘内容过长', ['content: 内容不能超过 10000 字符']);
    }
  }

  /**
   * 创建复盘日志
   */
  static create(
    params: CreateReviewLogParams,
    id: UUID,
    now: ISO8601DateTime
  ): ReviewLog {
    this.validateDateRange(params.startDate, params.endDate);
    this.validateContent(params.content);

    return {
      id,
      type: params.type,
      status: params.generatedBy === 'ai' ? ReviewStatus.DRAFT : ReviewStatus.CONFIRMED,
      startDate: params.startDate,
      endDate: params.endDate,
      content: params.content.trim(),
      stats: params.stats,
      blockers: params.blockers,
      suggestedTodos: params.suggestedTodos,
      generatedBy: params.generatedBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 用户确认复盘
   */
  static confirm(
    log: ReviewLog,
    editedContent: string,
    now: ISO8601DateTime
  ): ReviewLog {
    this.validateContent(editedContent);

    return {
      ...log,
      content: editedContent.trim(),
      status: ReviewStatus.CONFIRMED,
      updatedAt: now,
    };
  }

  /**
   * 归档复盘
   */
  static archive(
    log: ReviewLog,
    now: ISO8601DateTime
  ): ReviewLog {
    return {
      ...log,
      status: ReviewStatus.ARCHIVED,
      updatedAt: now,
    };
  }

  /**
   * 计算完成率
   */
  static calculateCompletionRate(stats: ReviewStats): number {
    if (stats.totalTodos === 0) return 0;
    return stats.completedTodos / stats.totalTodos;
  }

  /**
   * 计算专注会话完成率
   */
  static calculateFocusCompletionRate(stats: ReviewStats): number {
    if (stats.totalFocusSessions === 0) return 0;
    return stats.completedSessions / stats.totalFocusSessions;
  }

  /**
   * 判断是否有反复卡点
   */
  static hasRepeatedBlockers(log: ReviewLog): boolean {
    return log.blockers.some(b => b.repeatCount >= 2);
  }

  /**
   * 获取最频繁的卡点
   */
  static getTopBlockers(log: ReviewLog, limit: number = 3): ReviewBlocker[] {
    return [...log.blockers]
      .sort((a, b) => b.repeatCount - a.repeatCount)
      .slice(0, limit);
  }

  /**
   * 判断复盘是否需要用户确认
   */
  static needsConfirmation(log: ReviewLog): boolean {
    return log.status === ReviewStatus.DRAFT;
  }
}

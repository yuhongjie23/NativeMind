/**
 * KnowledgeLink 领域模型
 * 知识关系链接
 * 核心规则：
 * - 关系类型必须是预定义的枚举值（架构约束 C9）
 * - 关系端点可以是不同类型的实体
 * - 置信度在 0-1 之间
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 关系端点类型
 */
export enum EntityType {
  NOTE = 'note',           // 整篇笔记
  CHUNK = 'chunk',         // 笔记片段
  CONCEPT = 'concept',     // 抽象概念
  TODO = 'todo',           // 学习任务
  REVIEW_ITEM = 'review_item', // 复盘卡点
}

/**
 * 知识关系类型（固定枚举，模型不得自由发明）
 */
export enum RelationType {
  SAME_CONCEPT = 'same_concept',     // 同一概念
  PREREQUISITE = 'prerequisite',     // 前置知识
  EXAMPLE_OF = 'example_of',         // 例子
  CONTRAST = 'contrast',             // 对比
  EXTENDS = 'extends',               // 延伸
  REVIEW_LATER = 'review_later',     // 需要复习
}

/**
 * 知识链接实体
 */
export interface KnowledgeLink extends Entity {
  fromType: EntityType;
  fromId: UUID;
  toType: EntityType;
  toId: UUID;
  relationType: RelationType;
  reason: string;          // 为什么有这个关系
  confidence: number;      // 0-1 的置信度
  createdBy: 'ai_suggestion' | 'user_manual';
  confirmedByUser: boolean;
}

/**
 * 创建知识链接参数
 */
export interface CreateKnowledgeLinkParams {
  fromType: EntityType;
  fromId: UUID;
  toType: EntityType;
  toId: UUID;
  relationType: RelationType;
  reason: string;
  confidence?: number;
  createdBy: 'ai_suggestion' | 'user_manual';
}

/**
 * KnowledgeLink 领域服务
 */
export class KnowledgeLinkDomainService {
  /**
   * 验证置信度
   */
  static validateConfidence(confidence: number): void {
    if (confidence < 0 || confidence > 1) {
      throw new ValidationError('置信度必须在 0-1 之间', [
        'confidence: 必须在 0 到 1 之间',
      ]);
    }
  }

  /**
   * 验证理由
   */
  static validateReason(reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('关系理由不能为空', ['reason: 理由不能为空']);
    }
    if (reason.length > 500) {
      throw new ValidationError('关系理由过长', ['reason: 理由不能超过 500 字符']);
    }
  }

  /**
   * 验证端点不能相同
   */
  static validateDifferentEndpoints(
    fromType: EntityType,
    fromId: UUID,
    toType: EntityType,
    toId: UUID
  ): void {
    if (fromType === toType && fromId === toId) {
      throw new ValidationError('不能创建指向自己的关系', [
        'endpoints: 起点和终点不能相同',
      ]);
    }
  }

  /**
   * 创建知识链接
   */
  static create(
    params: CreateKnowledgeLinkParams,
    id: UUID,
    now: ISO8601DateTime
  ): KnowledgeLink {
    this.validateReason(params.reason);
    this.validateDifferentEndpoints(
      params.fromType,
      params.fromId,
      params.toType,
      params.toId
    );

    const confidence = params.confidence ?? 0.8;
    this.validateConfidence(confidence);

    return {
      id,
      fromType: params.fromType,
      fromId: params.fromId,
      toType: params.toType,
      toId: params.toId,
      relationType: params.relationType,
      reason: params.reason.trim(),
      confidence,
      createdBy: params.createdBy,
      confirmedByUser: params.createdBy === 'user_manual', // 用户手动创建默认确认
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 用户确认链接
   */
  static confirmByUser(
    link: KnowledgeLink,
    now: ISO8601DateTime
  ): KnowledgeLink {
    return {
      ...link,
      confirmedByUser: true,
      updatedAt: now,
    };
  }

  /**
   * 获取关系类型的中文描述
   */
  static getRelationTypeLabel(type: RelationType): string {
    const labels: Record<RelationType, string> = {
      [RelationType.SAME_CONCEPT]: '同一概念',
      [RelationType.PREREQUISITE]: '前置知识',
      [RelationType.EXAMPLE_OF]: '例子',
      [RelationType.CONTRAST]: '对比',
      [RelationType.EXTENDS]: '延伸',
      [RelationType.REVIEW_LATER]: '需要复习',
    };
    return labels[type];
  }

  /**
   * 检查是否为对称关系
   */
  static isSymmetric(type: RelationType): boolean {
    return (
      type === RelationType.SAME_CONCEPT ||
      type === RelationType.CONTRAST
    );
  }

  /**
   * 获取反向关系类型
   */
  static getReverseRelationType(type: RelationType): RelationType | null {
    // 前置知识的反向关系是延伸
    if (type === RelationType.PREREQUISITE) {
      return RelationType.EXTENDS;
    }
    // 对称关系返回自己
    if (this.isSymmetric(type)) {
      return type;
    }
    // 其他关系没有明确的反向关系
    return null;
  }
}

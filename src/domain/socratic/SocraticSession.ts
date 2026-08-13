/**
 * SocraticSession 领域模型
 * 苏格拉底式提问会话
 * 核心规则：
 * - 只能由用户主动触发，专注中禁止
 * - 用分层问题引导思考，不替用户完成思考
 * - 可引用本地笔记中的相关概念
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 会话状态
 */
export enum SocraticSessionStatus {
  ACTIVE = 'active',       // 进行中
  COMPLETED = 'completed', // 已完成
  ABANDONED = 'abandoned', // 已放弃
}

/**
 * 提问类型
 */
export enum QuestionType {
  CLARIFICATION = 'clarification',   // 澄清概念
  REASONING = 'reasoning',           // 推理引导
  EXAMPLE = 'example',               // 举例说明
  CONTRAST = 'contrast',             // 对比分析
  APPLICATION = 'application',       // 应用场景
  REFLECTION = 'reflection',         // 反思总结
}

/**
 * 苏格拉底会话实体
 */
export interface SocraticSession extends Entity {
  userId: UUID;
  status: SocraticSessionStatus;
  topic: string;                    // 主题
  goalDescription: string;          // 用户想要理解的内容
  questions: SocraticQuestion[];    // 问题列表
  relatedNoteIds: UUID[];           // 相关笔记ID
  startedAt: ISO8601DateTime;
  completedAt?: ISO8601DateTime;
}

/**
 * 苏格拉底问题
 */
export interface SocraticQuestion {
  id: UUID;
  type: QuestionType;
  question: string;
  userAnswer?: string;
  aiFollowUp?: string;              // AI的跟进回应
  relatedConceptIds?: UUID[];       // 关联的概念或笔记片段
  askedAt: ISO8601DateTime;
  answeredAt?: ISO8601DateTime;
}

/**
 * 创建会话参数
 */
export interface CreateSocraticSessionParams {
  userId: UUID;
  topic: string;
  goalDescription: string;
  relatedNoteIds?: UUID[];
}

/**
 * 添加问题参数
 */
export interface AddQuestionParams {
  type: QuestionType;
  question: string;
  relatedConceptIds?: UUID[];
}

/**
 * SocraticSession 领域服务
 */
export class SocraticSessionDomainService {
  /**
   * 验证主题
   */
  static validateTopic(topic: string): void {
    if (!topic || topic.trim().length === 0) {
      throw new ValidationError('主题不能为空', ['topic: 主题不能为空']);
    }
    if (topic.length > 200) {
      throw new ValidationError('主题过长', ['topic: 主题不能超过 200 字符']);
    }
  }

  /**
   * 验证目标描述
   */
  static validateGoalDescription(description: string): void {
    if (!description || description.trim().length === 0) {
      throw new ValidationError('目标描述不能为空', ['goalDescription: 目标描述不能为空']);
    }
    if (description.length > 1000) {
      throw new ValidationError('目标描述过长', [
        'goalDescription: 目标描述不能超过 1000 字符',
      ]);
    }
  }

  /**
   * 验证问题
   */
  static validateQuestion(question: string): void {
    if (!question || question.trim().length === 0) {
      throw new ValidationError('问题不能为空', ['question: 问题不能为空']);
    }
    if (question.length > 500) {
      throw new ValidationError('问题过长', ['question: 问题不能超过 500 字符']);
    }
  }

  /**
   * 创建会话
   */
  static create(
    params: CreateSocraticSessionParams,
    id: UUID,
    now: ISO8601DateTime
  ): SocraticSession {
    this.validateTopic(params.topic);
    this.validateGoalDescription(params.goalDescription);

    return {
      id,
      userId: params.userId,
      status: SocraticSessionStatus.ACTIVE,
      topic: params.topic.trim(),
      goalDescription: params.goalDescription.trim(),
      questions: [],
      relatedNoteIds: params.relatedNoteIds || [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 添加问题
   */
  static addQuestion(
    session: SocraticSession,
    params: AddQuestionParams,
    questionId: UUID,
    now: ISO8601DateTime
  ): SocraticSession {
    this.validateQuestion(params.question);

    if (session.status !== SocraticSessionStatus.ACTIVE) {
      throw new ValidationError('会话已结束，无法添加问题', [
        'status: 只有进行中的会话可以添加问题',
      ]);
    }

    const newQuestion: SocraticQuestion = {
      id: questionId,
      type: params.type,
      question: params.question.trim(),
      relatedConceptIds: params.relatedConceptIds,
      askedAt: now,
    };

    return {
      ...session,
      questions: [...session.questions, newQuestion],
      updatedAt: now,
    };
  }

  /**
   * 用户回答问题
   */
  static answerQuestion(
    session: SocraticSession,
    questionId: UUID,
    answer: string,
    aiFollowUp: string | undefined,
    now: ISO8601DateTime
  ): SocraticSession {
    const questionIndex = session.questions.findIndex(q => q.id === questionId);
    
    if (questionIndex === -1) {
      throw new ValidationError('问题不存在', ['questionId: 问题不存在']);
    }

    if (!answer || answer.trim().length === 0) {
      throw new ValidationError('回答不能为空', ['answer: 回答不能为空']);
    }

    const updatedQuestions = [...session.questions];
    updatedQuestions[questionIndex] = {
      ...updatedQuestions[questionIndex],
      userAnswer: answer.trim(),
      aiFollowUp: aiFollowUp?.trim(),
      answeredAt: now,
    };

    return {
      ...session,
      questions: updatedQuestions,
      updatedAt: now,
    };
  }

  /**
   * 完成会话
   */
  static complete(
    session: SocraticSession,
    now: ISO8601DateTime
  ): SocraticSession {
    return {
      ...session,
      status: SocraticSessionStatus.COMPLETED,
      completedAt: now,
      updatedAt: now,
    };
  }

  /**
   * 放弃会话
   */
  static abandon(
    session: SocraticSession,
    now: ISO8601DateTime
  ): SocraticSession {
    return {
      ...session,
      status: SocraticSessionStatus.ABANDONED,
      completedAt: now,
      updatedAt: now,
    };
  }

  /**
   * 获取未回答的问题数量
   */
  static getUnansweredCount(session: SocraticSession): number {
    return session.questions.filter(q => !q.userAnswer).length;
  }

  /**
   * 获取最后一个问题
   */
  static getLastQuestion(session: SocraticSession): SocraticQuestion | undefined {
    if (session.questions.length === 0) return undefined;
    return session.questions[session.questions.length - 1];
  }

  /**
   * 判断会话是否可以添加新问题
   */
  static canAddQuestion(session: SocraticSession): boolean {
    if (session.status !== SocraticSessionStatus.ACTIVE) return false;
    
    // 如果有未回答的问题，不能添加新问题
    const unansweredCount = this.getUnansweredCount(session);
    return unansweredCount === 0;
  }

  /**
   * 判断会话是否处于活跃状态
   */
  static isActive(session: SocraticSession): boolean {
    return session.status === SocraticSessionStatus.ACTIVE;
  }

  /**
   * 获取会话持续时间（分钟）
   */
  static getDurationMinutes(session: SocraticSession): number {
    const endTime = session.completedAt 
      ? new Date(session.completedAt)
      : new Date();
    const startTime = new Date(session.startedAt);
    return Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
  }
}

/**
 * CompanionProfile 领域模型
 * 陪伴角色资料
 * 核心规则：
 * - 角色做成资源包，新增角色不改代码
 * - 支持多个角色，用户可切换
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 陪伴角色实体
 */
export interface CompanionProfile extends Entity {
  name: string;
  description: string;
  tone: string;              // 语气风格描述
  resourcePackPath: string;  // 资源包路径（动画、音频等）
  isActive: boolean;         // 当前是否激活
  metadata: Record<string, unknown>;
}

/**
 * 角色场景类型
 */
export enum CompanionScene {
  APP_ENTERED = 'app_entered',           // 进入应用
  APP_EXITING = 'app_exiting',           // 退出应用
  FOCUS_STARTED = 'focus_started',       // 开始专注
  FOCUS_ACTIVE = 'focus_active',         // 专注中
  FOCUS_COMPLETED = 'focus_completed',   // 专注完成
  FOCUS_ABORTED = 'focus_aborted',       // 专注中断
  TASK_REPEATED_ABORT = 'task_repeated_abort', // 反复放弃
  REST = 'rest',                         // 休息
  ENCOURAGE = 'encourage',               // 鼓励
}

/**
 * 角色状态
 */
export enum CompanionState {
  IDLE = 'idle',               // 待机
  GREETING = 'greeting',       // 问候
  QUIET = 'quiet',             // 安静（专注中）
  CELEBRATING = 'celebrating', // 庆祝
  COMFORTING = 'comforting',   // 安慰
  ASKING = 'asking',           // 询问
  FAREWELL = 'farewell',       // 告别
}

/**
 * 角色对话
 */
export interface CompanionDialogue {
  scene: CompanionScene;
  state: CompanionState;
  text: string;
  animationKey?: string;  // 对应的动画资源键
  duration?: number;      // 持续时间（毫秒）
}

/**
 * 创建角色参数
 */
export interface CreateCompanionProfileParams {
  name: string;
  description: string;
  tone: string;
  resourcePackPath: string;
  metadata?: Record<string, unknown>;
}

/**
 * CompanionProfile 领域服务
 */
export class CompanionProfileDomainService {
  /**
   * 验证名称
   */
  static validateName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new ValidationError('角色名称不能为空', ['name: 名称不能为空']);
    }
    if (name.length > 50) {
      throw new ValidationError('角色名称过长', ['name: 名称不能超过 50 字符']);
    }
  }

  /**
   * 验证资源包路径
   */
  static validateResourcePackPath(path: string): void {
    if (!path || path.trim().length === 0) {
      throw new ValidationError('资源包路径不能为空', ['resourcePackPath: 路径不能为空']);
    }
  }

  /**
   * 创建角色
   */
  static create(
    params: CreateCompanionProfileParams,
    id: UUID,
    now: ISO8601DateTime
  ): CompanionProfile {
    this.validateName(params.name);
    this.validateResourcePackPath(params.resourcePackPath);

    return {
      id,
      name: params.name.trim(),
      description: params.description.trim(),
      tone: params.tone.trim(),
      resourcePackPath: params.resourcePackPath,
      isActive: false,
      metadata: params.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 激活角色
   */
  static activate(
    profile: CompanionProfile,
    now: ISO8601DateTime
  ): CompanionProfile {
    return {
      ...profile,
      isActive: true,
      updatedAt: now,
    };
  }

  /**
   * 停用角色
   */
  static deactivate(
    profile: CompanionProfile,
    now: ISO8601DateTime
  ): CompanionProfile {
    return {
      ...profile,
      isActive: false,
      updatedAt: now,
    };
  }

  /**
   * 获取场景的默认状态
   */
  static getDefaultStateForScene(scene: CompanionScene): CompanionState {
    const stateMap: Record<CompanionScene, CompanionState> = {
      [CompanionScene.APP_ENTERED]: CompanionState.GREETING,
      [CompanionScene.APP_EXITING]: CompanionState.FAREWELL,
      [CompanionScene.FOCUS_STARTED]: CompanionState.GREETING,
      [CompanionScene.FOCUS_ACTIVE]: CompanionState.QUIET,
      [CompanionScene.FOCUS_COMPLETED]: CompanionState.CELEBRATING,
      [CompanionScene.FOCUS_ABORTED]: CompanionState.COMFORTING,
      [CompanionScene.TASK_REPEATED_ABORT]: CompanionState.ASKING,
      [CompanionScene.REST]: CompanionState.IDLE,
      [CompanionScene.ENCOURAGE]: CompanionState.IDLE,
    };
    return stateMap[scene];
  }

  /**
   * 判断场景是否允许在专注模式中显示
   */
  static isAllowedInFocusMode(scene: CompanionScene): boolean {
    // 只有专注中的场景允许在专注模式显示
    return scene === CompanionScene.FOCUS_ACTIVE;
  }

  /**
   * 判断状态是否为低存在感
   */
  static isLowPresence(state: CompanionState): boolean {
    // 安静和待机状态为低存在感
    return state === CompanionState.QUIET || state === CompanionState.IDLE;
  }
}

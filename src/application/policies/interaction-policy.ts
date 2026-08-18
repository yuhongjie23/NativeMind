/**
 * InteractionPolicy - 宠物互动策略
 * 控制主动提问的场景、频率与每日上限。
 */
import type { CompanionInteractionRepository } from '../ports';
import { minutesSince } from '../shared/utils';
import type { FocusModePolicy } from './focus-mode-policy';

export interface InteractionPolicyConfig {
  minIntervalMinutes: number;
  maxQuestionsPerDay: number;
  /** 每个主动场景每天最多几次（idle_checkin / stuck_encourage / milestone_celebrate） */
  maxProactivePerDay: number;
  /** 健康提醒每天上限（30 分钟一轮 ≈ 12 次/6 小时，与 agent 阈值对齐） */
  maxHealthRemindersPerDay: number;
  allowedScenes: string[];
}

export const defaultInteractionConfig: InteractionPolicyConfig = {
  minIntervalMinutes: 30,
  maxQuestionsPerDay: 5,
  maxProactivePerDay: 3,
  maxHealthRemindersPerDay: 12,
  // enter：进入应用的欢迎语，同样走节流，避免每次启动都吵
  allowedScenes: ['enter', 'focus_complete', 'repeatedly_aborted', 'review_generated'],
};

export class InteractionPolicy {
  constructor(
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly focusPolicy: FocusModePolicy,
    private readonly config: InteractionPolicyConfig = defaultInteractionConfig
  ) {}

  async canAskQuestion(scene: string): Promise<boolean> {
    if (!this.focusPolicy.canInterrupt('companion_question')) return false;
    if (!this.config.allowedScenes.includes(scene)) return false;

    const last = await this.interactionRepo.findLastQuestion();
    if (last && minutesSince(last.createdAt) < this.config.minIntervalMinutes) return false;

    const todayCount = await this.interactionRepo.countTodayQuestions();
    return todayCount < this.config.maxQuestionsPerDay;
  }

  /**
   * 健康提醒（久坐关怀）能否发起：
   * 独立于普通互动的节流（30 分钟健康节律不被闲聊打断），
   * 专注中仍遵守「不打扰」哲学（且全屏专注时宠物本就不可见，
   * 由全屏层自己的健康贴士负责）；今日次数按场景计上限。
   */
  async allowHealthReminder(scene: string): Promise<boolean> {
    if (!this.focusPolicy.canInterrupt('companion_dialogue')) return false;

    const todayCount = await this.interactionRepo.countTodayByScene(scene);
    return todayCount < this.config.maxHealthRemindersPerDay;
  }

  /**
   * 主动调度（陪伴 agent）能否发起某场景的互动：
   * 专注中一律不打扰；距上次任意互动够久；该场景今日次数未超上限。
   */
  async allowProactiveInitiation(scene: string): Promise<boolean> {
    if (!this.focusPolicy.canInterrupt('companion_question')) return false;

    const last = await this.interactionRepo.findLast();
    if (last && minutesSince(last.createdAt) < this.config.minIntervalMinutes) return false;

    const todayCount = await this.interactionRepo.countTodayByScene(scene);
    return todayCount < this.config.maxProactivePerDay;
  }
}

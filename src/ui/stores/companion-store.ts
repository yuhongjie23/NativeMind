/**
 * 陪伴角色 store
 *
 * 宠物是否说话由 InteractionPolicy 决定（专注中一律不打扰、每天有次数上限），
 * store 只负责把用例返回的那条互动摆到界面上。trigger 返回 null 是正常结果，
 * 不是错误：意思就是「这次别出声」。
 */
import { create } from 'zustand';
import type { CompanionInteraction } from '@shared-types/domain';
import type { CompanionAnimation } from '@shared-types/events';
import { audioPlayer, describeError, repositories, useCases } from './runtime';
import { useSettingsStore } from './settings-store';

interface CompanionState {
  /** 当前等待用户回应的那条互动，null 表示宠物没在问话 */
  current: CompanionInteraction | null;
  animation: CompanionAnimation;
  history: CompanionInteraction[];
  /** 正在调本地模型生成回应（点宠物 / 回应后），UI 据此显示等待转圈 */
  generating: boolean;
  error?: string;
  refresh: () => Promise<void>;
  trigger: (scene: string, triggerEvent?: string) => Promise<void>;
  /** 陪伴 agent 主动调度一拍：策略放行则让宠物主动说一句 */
  proactiveTick: () => Promise<void>;
  respond: (response: string) => Promise<void>;
  dismiss: () => void;
  setAnimation: (animation: CompanionAnimation) => void;
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  current: null,
  animation: 'idle',
  history: [],
  generating: false,


  refresh: async () => {
    try {
      set({ history: await repositories.companionInteraction.listAll() });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  trigger: async (scene, triggerEvent) => {
    // 开关归 settings-store（唯一数据源），这里只读不存
    if (!useSettingsStore.getState().companion.enabled) return;

    // 调本地模型期间显示等待转圈
    set({ generating: true });
    try {
      const interaction = await useCases.triggerInteraction.execute({
        scene,
        triggerEvent,
        // 用户主动点宠物（user_invoked）→ 实时调模型，跳过策略节流
        userInitiated: scene === 'user_invoked',
      });
      // null = 策略判定此刻不该打扰，保持静默
      if (!interaction) return;

      // 宠物出声。专注完成时已播 completion cue，不叠加招呼音
      if (scene !== 'focus_complete') void audioPlayer.play('companion_greet');
      set({ current: interaction, animation: scene === 'focus_complete' ? 'cheer' : 'greet' });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ generating: false });
    }
  },

  proactiveTick: async () => {
    if (!useSettingsStore.getState().companion.enabled) return;

    try {
      const interaction = await useCases.proactiveCompanionTick.execute();
      // null = 政策判定此刻不该主动说话，保持安静
      if (!interaction) return;

      set({ current: interaction, animation: 'greet' });
      void audioPlayer.play('companion_greet');
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  respond: async (response) => {
    const { current } = get();
    if (!current) return;

    set({ generating: true });
    try {
      await useCases.handleUserResponse.execute(current.id, response);
      set({ current: null, animation: 'idle' });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ generating: false });
    }
  },

  dismiss: () => set({ current: null, animation: 'idle' }),
  setAnimation: (animation) => set({ animation }),
}));



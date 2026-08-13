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
import { audioPlayer, describeError, eventBus, repositories, useCases } from './runtime';
import { useFocusStore } from './focus-store';
import { useSettingsStore } from './settings-store';

/** 自动关闭时长：非提问台词按类型给生命周期（P0-3），不永久停留 */
const AUTO_DISMISS_MS: Record<string, number> = {
  // reaction/notice/dialogue 类：4-8 秒自动回到 idle
  dialogue: 5000,
  animation: 4000,
  // question 等待用户回答，不自动关
};

/** 显式对话状态（四：页面状态驱动宠物动作，不用多个布尔值拼接） */
export type CompanionConversationState =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'asking'; interaction: CompanionInteraction; quickReplies: string[] }
  | { kind: 'replying'; userText: string }
  | { kind: 'responded'; interaction: CompanionInteraction }
  | { kind: 'resting' };

interface CompanionState {
  /** 当前等待用户回应的那条互动，null 表示宠物没在问话 */
  current: CompanionInteraction | null;
  animation: CompanionAnimation;
  history: CompanionInteraction[];
  /** 显式对话状态机（四） */
  conversationState: CompanionConversationState;
  /** 当前句子的快捷回应（来自模型 quickReplies，最多 3 个） */
  quickReplies: string[];
  /** 微型会话轮数（五：2-4 轮自然收束） */
  turnCount: number;
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
  /** 订阅 CompanionInteractionCreated：任意互动创建后送到主场景（P0-2） */
  init: () => () => void;
  /** 内部：把一条新互动展示到主舞台，按类型进入对应状态（asking=可回应 / 其他=自动关闭） */
  showInteraction: (interaction: CompanionInteraction, quickReplies?: string[]) => void;
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  current: null,
  animation: 'idle',
  history: [],
  conversationState: { kind: 'idle' },
  quickReplies: [],
  turnCount: 0,
  generating: false,

  /** 内部：把一条新互动展示到主舞台，按类型进入对应状态（asking=可回应 / 其他=自动关闭） */
  showInteraction: (interaction: CompanionInteraction, quickReplies: string[] = []) => {
    // 动画：优先 interaction.animationName（emotion 驱动），fallback 按场景
    const animation = interaction.animationName
      ? (interaction.animationName as CompanionAnimation)
      : interaction.sceneType === 'focus_complete'
        ? 'cheer'
        : 'greet';
    set({ current: interaction, animation, quickReplies });

    if (interaction.requiresResponse) {
      // 提问：进入 asking，等待回应
      set({
        conversationState: {
          kind: 'asking',
          interaction,
          quickReplies,
        },
      });
    } else {
      // 反馈/台词：进入 responded，展示后自动回 idle
      set({ conversationState: { kind: 'responded', interaction } });
      const id = interaction.id;
      window.setTimeout(() => {
        if (get().current?.id === id) {
          set({ current: null, animation: 'idle', conversationState: { kind: 'idle' } });
        }
      }, AUTO_DISMISS_MS.dialogue ?? 5000);
    }
  },

  init: () => {
    const off = eventBus.subscribe('CompanionInteractionCreated', (event) => {
      void (async () => {
        try {
          const interaction = await repositories.companionInteraction.findById(event.interactionId);
          if (!interaction) return;
          get().showInteraction(interaction, event.quickReplies);
          if (interaction.sceneType !== 'focus_complete') {
            void audioPlayer.play('companion_greet');
          }
        } catch {
          // 互动不存在/读取失败：忽略
        }
      })();
    });
    return off;
  },

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

    // 调本地模型期间显示等待转圈（thinking 状态）
    set({ generating: true, conversationState: { kind: 'thinking' } });
    try {
      // 进行中的专注（内存态）→ 传给上下文构建，让宠物知道「正在专注什么、多久了」
      const focusState = useFocusStore.getState();
      const activeFocus = focusState.active
        ? {
            todoId: focusState.active.todoId,
            elapsedMinutes: Math.max(
              0,
              Math.round(
                (Date.now() - new Date(focusState.active.startedAt).getTime()) / 60000
              ) - Math.round(focusState.pausedSeconds / 60)
            ),
          }
        : undefined;

      const interaction = await useCases.triggerInteraction.execute({
        scene,
        triggerEvent,
        activeFocus,
        // 用户主动点宠物（user_invoked）→ 实时调模型，跳过策略节流
        userInitiated: scene === 'user_invoked',
      });
      // null = 策略判定此刻不该打扰，保持静默（回 idle）
      if (!interaction) {
        set({ conversationState: { kind: 'idle' } });
        return;
      }

      // 宠物出声。专注完成时已播 completion cue，不叠加招呼音
      if (scene !== 'focus_complete') void audioPlayer.play('companion_greet');
      // 通过事件通道由 showInteraction 统一处理（避免双 set）；事件可能先到，这里幂等
      get().showInteraction(interaction);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error), conversationState: { kind: 'idle' } });
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

      void audioPlayer.play('companion_greet');
      get().showInteraction(interaction);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  respond: async (response) => {
    const { current } = get();
    if (!current) return;

    // replying：保留用户刚发送的内容（五：点头、认真听）
    set({ generating: true, conversationState: { kind: 'replying', userText: response } });
    try {
      // P0-1：HandleUserResponse 返回反馈互动，展示 4-6 秒再回到 idle
      const feedback = await useCases.handleUserResponse.execute(current.id, response);
      set({ current: feedback, turnCount: get().turnCount + 1 });
      get().showInteraction(feedback);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error), conversationState: { kind: 'idle' } });
    } finally {
      set({ generating: false });
    }
  },

  dismiss: () =>
    set({ current: null, animation: 'idle', conversationState: { kind: 'idle' }, quickReplies: [] }),
  setAnimation: (animation) => set({ animation }),
}));



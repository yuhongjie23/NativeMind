/**
 * TriggerInteractionUseCase - 宠物主动提问
 * 先过 InteractionPolicy（含专注模式），再由 AI 生成问题，最后落一条待响应记录。
 * 创建后发布 CompanionInteractionCreated：UI 订阅统一事件把台词送到主场景（P0-2）。
 */
import type {
  CompanionInteraction,
  CompanionInteractionRepository,
  CompanionQuestionPort,
  CompanionUtterance,
  FocusSession,
  Todo,
} from '../../ports';
import type { EventBus } from '../../events/event-bus';
import type { InteractionPolicy } from '../../policies/interaction-policy';
import { contextRecentLines, contextToFacts, type CompanionContextBuilder } from './companion-context';
import { newId, now } from '../../shared/utils';

/** 情绪 → 动画（emotion 驱动 Sprite 动作，而不是永远同一套） */
export const emotionToAnimation = (
  emotion: CompanionUtterance['emotion']
): string => {
  switch (emotion) {
    case 'happy':
      return 'cheer';
    case 'curious':
      return 'look_at_girl';
    case 'concerned':
      return 'concerned';
    default:
      return 'examining'; // calm：认真查看/陪读
  }
};

export interface TriggerInteractionInput {
  scene: string;
  triggerEvent?: string;
  recentTodos?: Todo[];
  recentFocusSessions?: FocusSession[];
  companionId?: string;
  /** 用户主动点宠物：跳过策略节流，实时调模型给一句对话 */
  userInitiated?: boolean;
  /** 进行中的专注（内存态，调用方传入；无则 undefined） */
  activeFocus?: { todoId?: string; elapsedMinutes: number };
}

export class TriggerInteractionUseCase {
  constructor(
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly questionPort: CompanionQuestionPort,
    private readonly interactionPolicy: InteractionPolicy,
    private readonly eventBus?: EventBus,
    private readonly contextBuilder?: CompanionContextBuilder
  ) {}

  async execute(input: TriggerInteractionInput): Promise<CompanionInteraction | null> {
    // 用户主动点击 → 不节流、每次都响应（实时对话）；否则按策略控制主动发声频率
    if (!input.userInitiated && !(await this.interactionPolicy.canAskQuestion(input.scene))) return null;

    // P1-5：用 ContextBuilder 构建完整上下文（时段/今日统计/最近轮次/进行中专注）。
    // 只传任务标题与统计，不传笔记正文。
    let facts: string | undefined;
    let recentLines: string[] | undefined;
    if (this.contextBuilder) {
      try {
        const context = await this.contextBuilder.build({
          activeFocus: input.activeFocus,
        });
        facts = contextToFacts(context);
        recentLines = contextRecentLines(context);
      } catch {
        // 上下文构建失败：退化为基本事实（场景 + 当天任务）
        facts = `场景：${input.scene}`;
      }
    }

    const utterance = await this.questionPort.generateQuestion({
      scene: input.scene,
      recentTodos: input.recentTodos ?? [],
      recentFocusSessions: input.recentFocusSessions ?? [],
      facts,
      recentLines,
    });

    const interactionId = newId();
    const interaction = await this.interactionRepo.create({
      id: interactionId,
      companionId: input.companionId ?? 'fulilian',
      sceneType: input.scene,
      triggerEvent: input.triggerEvent,
      interactionType: 'question',
      content: utterance.content,
      requiresResponse: true,
      // 会话起点：反馈与提问共享 conversationId（P1-7），历史可配对
      conversationId: interactionId,
      turnIndex: 0,
      initiator: input.userInitiated ? 'user' : 'event',
      status: 'visible',
      // emotion 驱动动画：直接存动画名（happy→cheer, curious→look_at_girl, concerned→concerned, calm→examining）
      animationName: emotionToAnimation(utterance.emotion ?? 'calm'),
      createdAt: now(),
    });

    // 统一事件：UI 订阅后把台词展示到主场景，不再靠 store 手动触发或硬编码台词
    if (this.eventBus) {
      await this.eventBus.publish({
        type: 'CompanionInteractionCreated',
        interactionId: interaction.id,
        scene: interaction.sceneType,
        quickReplies: utterance.quickReplies,
        timestamp: now(),
      });
    }

    return interaction;
  }
}

/**
 * HandleUserResponseUseCase - 处理用户对宠物提问的回答
 *
 * 生成反馈并**返回**反馈互动（不再只写库）——这样 UI 可以把宠物的回应
 * 展示给用户（P0-1：用户回答后宠物回话可见），而不是气泡直接消失。
 * 微型会话（五）：反馈带 emotion→动画 与 quickReplies，UI 据此决定
 * 「继续追问」还是「自然收束」。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { CompanionInteraction, CompanionInteractionRepository, CompanionQuestionPort } from '../../ports';
import { emotionToAnimation } from './trigger-interaction';
import { newId, now } from '../../shared/utils';

export class HandleUserResponseUseCase {
  constructor(
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly questionPort: CompanionQuestionPort,
    private readonly eventBus: EventBus
  ) {}

  async execute(interactionId: UUID, response: string): Promise<CompanionInteraction> {
    const interaction = await this.interactionRepo.findById(interactionId);
    if (!interaction) throw new Error(`互动记录不存在: ${interactionId}`);

    await this.interactionRepo.updateResponse(interactionId, response);

    // 反馈生成带上宠物刚才问的问题、场景与上下文事实（P1-6）
    const utterance = await this.questionPort.generateFeedback({
      previousQuestion: interaction.content ?? '',
      userResponse: response,
      scene: interaction.sceneType,
      conversationTurn: (interaction.turnIndex ?? 0) + 1,
    });

    const feedbackInteraction: CompanionInteraction = {
      id: newId(),
      companionId: interaction.companionId,
      sceneType: 'feedback',
      interactionType: 'dialogue',
      content: utterance.content,
      requiresResponse: false,
      // 会话关联：反馈与提问属于同一段对话（P1-7）
      conversationId: interaction.conversationId ?? interaction.id,
      replyToId: interaction.id,
      // 轮次：反馈紧随提问（turnIndex 由发起方设定，反馈标记下一轮起点）
      turnIndex: (interaction.turnIndex ?? 0) + 1,
      initiator: interaction.initiator ?? 'user',
      status: 'visible',
      // emotion 驱动动画（微型会话：宠物有「听见 → 思考 → 回应」的生命感）
      animationName: emotionToAnimation(utterance.emotion ?? 'calm'),
      createdAt: now(),
    };
    await this.interactionRepo.create(feedbackInteraction);

    await this.eventBus.publish({
      type: 'CompanionInteractionCreated',
      interactionId: feedbackInteraction.id,
      scene: feedbackInteraction.sceneType,
      quickReplies: utterance.quickReplies,
      timestamp: now(),
    });

    await this.eventBus.publish({
      type: 'CompanionInteractionCompleted',
      interactionId,
      response,
      timestamp: now(),
    });

    return feedbackInteraction;
  }
}

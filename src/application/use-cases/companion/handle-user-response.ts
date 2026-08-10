/**
 * HandleUserResponseUseCase - 处理用户对宠物提问的回答
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { CompanionInteractionRepository, CompanionQuestionPort } from '../../ports';
import { newId, now } from '../../shared/utils';

export class HandleUserResponseUseCase {
  constructor(
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly questionPort: CompanionQuestionPort,
    private readonly eventBus: EventBus
  ) {}

  async execute(interactionId: UUID, response: string): Promise<void> {
    const interaction = await this.interactionRepo.findById(interactionId);
    if (!interaction) throw new Error(`互动记录不存在: ${interactionId}`);

    await this.interactionRepo.updateResponse(interactionId, response);

    const feedback = await this.questionPort.generateFeedback(response);
    await this.interactionRepo.create({
      id: newId(),
      companionId: interaction.companionId,
      sceneType: 'feedback',
      interactionType: 'dialogue',
      content: feedback,
      requiresResponse: false,
      createdAt: now(),
    });

    await this.eventBus.publish({
      type: 'CompanionInteractionCompleted',
      interactionId,
      response,
      timestamp: now(),
    });
  }
}

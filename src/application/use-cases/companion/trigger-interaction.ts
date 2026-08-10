/**
 * TriggerInteractionUseCase - 宠物主动提问
 * 先过 InteractionPolicy（含专注模式），再由 AI 生成问题，最后落一条待响应记录。
 */
import type {
  CompanionInteraction,
  CompanionInteractionRepository,
  CompanionQuestionPort,
  FocusSession,
  Todo,
} from '../../ports';
import type { InteractionPolicy } from '../../policies/interaction-policy';
import { newId, now } from '../../shared/utils';

export interface TriggerInteractionInput {
  scene: string;
  triggerEvent?: string;
  recentTodos?: Todo[];
  recentFocusSessions?: FocusSession[];
  companionId?: string;
  /** 用户主动点宠物：跳过策略节流，实时调模型给一句对话 */
  userInitiated?: boolean;
}

export class TriggerInteractionUseCase {
  constructor(
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly questionPort: CompanionQuestionPort,
    private readonly interactionPolicy: InteractionPolicy
  ) {}

  async execute(input: TriggerInteractionInput): Promise<CompanionInteraction | null> {
    // 用户主动点击 → 不节流、每次都响应（实时对话）；否则按策略控制主动发声频率
    if (!input.userInitiated && !(await this.interactionPolicy.canAskQuestion(input.scene))) return null;

    const question = await this.questionPort.generateQuestion({
      scene: input.scene,
      recentTodos: input.recentTodos ?? [],
      recentFocusSessions: input.recentFocusSessions ?? [],
    });

    return this.interactionRepo.create({
      id: newId(),
      companionId: input.companionId ?? 'fulilian',
      sceneType: input.scene,
      triggerEvent: input.triggerEvent,
      interactionType: 'question',
      content: question,
      requiresResponse: true,
      createdAt: now(),
    });
  }
}

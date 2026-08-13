/**
 * CreateKnowledgeLinkUseCase
 *
 * 两条路径，和 CreateTodoUseCase 保持一致的形状：
 * - 用户手动建立：直接写库，默认已确认。
 * - AI 建议：走 ConfirmationService，确认后才写库（架构约束 C9：AI 不直接写关系）。
 *
 * 幂等：同一条边（起点 + 终点 + 关系类型）在库里唯一。重复建立时更新理由和置信度，
 * 不新增一行 —— AI 每次检索都可能产出同样的建议。
 */
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type {
  KnowledgeLink,
  KnowledgeLinkRepository,
  LinkCreatedBy,
  LinkEntityType,
  LinkRelationType,
} from '../../ports';
import { newId, now } from '../../shared/utils';

export interface CreateLinkInput {
  fromType: LinkEntityType;
  fromId: string;
  toType: LinkEntityType;
  toId: string;
  relationType: LinkRelationType;
  reason?: string;
  confidence?: number;
}

/** AI 给的关系建议，比手动输入多一个必填理由 */
export interface LinkSuggestion extends CreateLinkInput {
  reason: string;
}

const MAX_REASON_LENGTH = 500;

/** 校验放在用例里而不是仓储里：仓储只管存取，不判业务规则 */
const validate = (input: CreateLinkInput): void => {
  if (input.fromType === input.toType && input.fromId === input.toId) {
    throw new Error('不能建立指向自己的关系');
  }
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error('置信度必须在 0 到 1 之间');
  }
  if (input.reason && input.reason.length > MAX_REASON_LENGTH) {
    throw new Error(`关系理由不能超过 ${MAX_REASON_LENGTH} 字`);
  }
};

export class CreateKnowledgeLinkUseCase {
  constructor(
    private readonly linkRepo: KnowledgeLinkRepository,
    private readonly eventBus: EventBus,
    private readonly confirmation: ConfirmationService
  ) {}

  /** 用户手动建立关系 */
  async execute(input: CreateLinkInput): Promise<KnowledgeLink> {
    const link = await this.upsert(input, 'user_manual', true);

    await this.eventBus.publish({
      type: 'KnowledgeLinkConfirmed',
      linkIds: [link.id],
      timestamp: now(),
    });

    return link;
  }

  /**
   * AI 建议的关系，确认后写入。
   * 返回实际写入的关系；用户拒绝则返回空数组。
   */
  async executeFromSuggestions(suggestions: LinkSuggestion[]): Promise<KnowledgeLink[]> {
    if (suggestions.length === 0) return [];

    suggestions.forEach(validate);

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      {
        actionType: 'create_knowledge_link',
        summary: `AI 发现 ${suggestions.length} 条可能的知识关联`,
        payload: suggestions,
      },
      async (payload) => {
        const links: KnowledgeLink[] = [];
        for (const suggestion of payload) {
          // 用户在确认弹窗里点了「同意」，所以这里落库即视为已确认
          links.push(await this.upsert(suggestion, 'ai_suggestion', true));
        }
        return links;
      }
    );

    if (!confirmed || !result || result.length === 0) return [];

    await this.eventBus.publish({
      type: 'KnowledgeLinkConfirmed',
      linkIds: result.map((link) => link.id),
      timestamp: now(),
    });

    return result;
  }

  /** 写入或更新同一条边 */
  private async upsert(
    input: CreateLinkInput,
    createdBy: LinkCreatedBy,
    confirmedByUser: boolean
  ): Promise<KnowledgeLink> {
    validate(input);

    const timestamp = now();
    const existing = await this.linkRepo.findEdge({
      fromType: input.fromType,
      fromId: input.fromId,
      toType: input.toType,
      toId: input.toId,
      relationType: input.relationType,
    });

    const link: KnowledgeLink = {
      // 已存在就复用 id，让 UPSERT 更新同一行而不是制造孤儿记录
      id: existing?.id ?? newId(),
      fromType: input.fromType,
      fromId: input.fromId,
      toType: input.toType,
      toId: input.toId,
      relationType: input.relationType,
      reason: input.reason?.trim() || existing?.reason,
      confidence: input.confidence ?? existing?.confidence ?? 0.8,
      createdBy: existing?.createdBy ?? createdBy,
      // 之前确认过就保持确认，不因为 AI 再建议一次而回退
      confirmedByUser: existing?.confirmedByUser || confirmedByUser,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      // 重新建立等于撤销归档
      archivedAt: undefined,
    };

    await this.linkRepo.save(link);
    return link;
  }
}

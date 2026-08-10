/**
 * DeleteConversationUseCase - 删除一段对话（连同其全部信件，本地删除）
 */
import type { LetterRepository } from '../../ports';
import { buildConversations } from './conversation-utils';

export class DeleteConversationUseCase {
  constructor(private readonly letterRepo: LetterRepository) {}

  async execute(conversationId: string): Promise<number> {
    const conversations = buildConversations(await this.letterRepo.list(1000));
    const target = conversations.find((c) => c.id === conversationId);
    if (!target) return 0;
    return this.letterRepo.deleteMany(target.letterIds);
  }
}

/**
 * ListConversationsUseCase - 对话历史（每段一个会话，最近的在前）
 */
import type { LetterRepository } from '../../ports';
import { buildConversations, type Conversation } from './conversation-utils';

export class ListConversationsUseCase {
  constructor(private readonly letterRepo: LetterRepository) {}

  async execute(): Promise<Conversation[]> {
    return buildConversations(await this.letterRepo.list(1000));
  }
}

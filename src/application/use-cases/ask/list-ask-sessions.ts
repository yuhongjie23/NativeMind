/**
 * ListAskSessionsUseCase - 深度问答历史列表，最近的在前
 */
import type { AskSession, AskSessionRepository } from '../../ports';

export class ListAskSessionsUseCase {
  constructor(private readonly askRepo: AskSessionRepository) {}

  async execute(limit = 50): Promise<AskSession[]> {
    return this.askRepo.list(limit);
  }
}

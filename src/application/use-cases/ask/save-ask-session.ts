/**
 * SaveAskSessionUseCase - 把一次深度问答结果落库（用户主动发起的生成）
 *
 * 只追加不覆盖：问答历史是用户的沉淀，删除由 UI 显式触发。
 * 无相关笔记（empty）不在此拦截，由调用方决定是否存 —— 存下来也有「当时问过什么」的价值。
 */
import type { AskCitation, AskSession, AskSessionRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export interface SaveAskSessionInput {
  question: string;
  answer: string;
  citations: AskCitation[];
  confidence: number;
  judged: boolean;
  regenerated: boolean;
  ok: boolean;
  empty: boolean;
  critique?: string;
}

export class SaveAskSessionUseCase {
  constructor(private readonly askRepo: AskSessionRepository) {}

  async execute(input: SaveAskSessionInput): Promise<AskSession> {
    const question = input.question.trim();
    if (!question) throw new Error('问题不能为空');

    const timestamp = now();
    const session: AskSession = {
      id: newId(),
      question,
      answer: input.answer,
      citations: input.citations,
      confidence: input.confidence,
      judged: input.judged,
      regenerated: input.regenerated,
      ok: input.ok,
      empty: input.empty,
      critique: input.critique,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.askRepo.save(session);
    return session;
  }
}

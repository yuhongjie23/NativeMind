/**
 * ConfirmationService - 统一写入确认机制
 * 所有 AI 建议型写入必须经过此处：先落 proposal，用户确认后才执行 commit。
 */
import type { UUID } from '@shared-types/common';
import { now } from '../shared/utils';
import {
  createProposal,
  type ActionProposal,
  type ActionProposalRepository,
  type ActionType,
} from './action-proposal';

/** UI 侧确认入口：返回 true 表示用户同意 */
export type ConfirmationPrompt = (proposal: ActionProposal) => Promise<boolean>;

/** 简单确认请求（删除等破坏性操作），不落 action_proposal，确认后直接执行 */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** UI 侧简单确认入口：返回 true 表示确认 */
export type ConfirmPrompt = (request: ConfirmRequest) => Promise<boolean>;

export interface ProposeInput<P> {
  actionType: ActionType;
  summary: string;
  payload: P;
  source?: 'ai' | 'rule_based';
  /** 系统运行型写入可跳过确认 */
  requiresConfirmation?: boolean;
}

export interface ConfirmationResult<R> {
  confirmed: boolean;
  proposalId: UUID;
  result?: R;
}

export class ConfirmationService {
  constructor(
    private readonly proposalRepo: ActionProposalRepository,
    private readonly prompt: ConfirmationPrompt,
    /** 删除等破坏性操作的简单确认；未接线时默认拒绝，保证安全 */
    private readonly confirmPrompt: ConfirmPrompt = () => Promise.resolve(false)
  ) {}

  /**
   * 提议并在用户确认后执行写入。
   * commit 只在确认通过时调用，是写库的唯一时机。
   */
  async confirmAndCommit<P, R>(
    input: ProposeInput<P>,
    commit: (payload: P) => Promise<R>
  ): Promise<ConfirmationResult<R>> {
    const proposal = createProposal(input);
    await this.proposalRepo.save(proposal as ActionProposal);

    const approved = proposal.requiresConfirmation
      ? await this.prompt(proposal as ActionProposal)
      : true;

    if (!approved) {
      await this.proposalRepo.updateStatus(proposal.id, 'rejected', now());
      return { confirmed: false, proposalId: proposal.id };
    }

    // 先 commit 成功再标 confirmed：否则 commit 抛错（如过滤后空标题）时，
    // 库里会留下一条「已确认但什么都没写」的假记录，审计就失真了。
    const result = await commit(proposal.payload);
    await this.proposalRepo.updateStatus(proposal.id, 'confirmed', now());

    return { confirmed: true, proposalId: proposal.id, result };
  }

  /** 仅生成草稿提议，交由 UI 稍后决定（如复盘草稿） */
  async propose<P>(input: ProposeInput<P>): Promise<ActionProposal<P>> {
    const proposal = createProposal(input);
    await this.proposalRepo.save(proposal as ActionProposal);
    return proposal;
  }

  /**
   * 简单确认后直接执行（删除等破坏性操作）。
   * 不创建 action_proposal 记录、不走「写入」语义：确认通过就执行 run。
   */
  async confirmAndRun<R>(
    input: ConfirmRequest,
    run: () => Promise<R>
  ): Promise<{ confirmed: boolean; result?: R }> {
    const approved = await this.confirmPrompt(input);
    if (!approved) return { confirmed: false };
    return { confirmed: true, result: await run() };
  }
}

/**
 * ActionProposal - AI / 规则产出的待确认动作
 * AI 层与用例层只产出 Proposal，用户确认后才写入目标表。
 */
import type { ISO8601DateTime, UUID } from '@shared-types/common';
import { newId, now } from '../shared/utils';

export type ActionType =
  | 'create_todos'
  | 'create_knowledge_link'
  | 'generate_review'
  | 'delete_review'
  | 'delete_note'
  | 'import_search_result';

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

export interface ActionProposal<P = unknown> {
  id: UUID;
  actionType: ActionType;
  summary: string;
  payload: P;
  source: 'ai' | 'rule_based';
  status: ProposalStatus;
  requiresConfirmation: boolean;
  createdAt: ISO8601DateTime;
  decidedAt?: ISO8601DateTime;
}

export interface ActionProposalRepository {
  save(proposal: ActionProposal): Promise<void>;
  findById(id: UUID): Promise<ActionProposal | null>;
  updateStatus(id: UUID, status: ProposalStatus, decidedAt: ISO8601DateTime): Promise<void>;
}

export function createProposal<P>(input: {
  actionType: ActionType;
  summary: string;
  payload: P;
  source?: 'ai' | 'rule_based';
  requiresConfirmation?: boolean;
}): ActionProposal<P> {
  return {
    id: newId(),
    actionType: input.actionType,
    summary: input.summary,
    payload: input.payload,
    source: input.source ?? 'ai',
    status: 'pending',
    requiresConfirmation: input.requiresConfirmation ?? true,
    createdAt: now(),
  };
}

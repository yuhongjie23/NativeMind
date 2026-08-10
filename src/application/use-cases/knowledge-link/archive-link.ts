/**
 * ArchiveKnowledgeLinkUseCase
 *
 * 用归档代替物理删除：
 * - 用户否掉一条 AI 建议后，这条记录仍有价值 —— 否则同一条关系会被反复建议、反复被否。
 * - 误删可以撤销，符合「用户始终可撤销」的产品约定。
 *
 * 归档是用户的直接操作，不需要再走一次确认弹窗。
 */
import type { KnowledgeLink, KnowledgeLinkRepository } from '../../ports';
import type { UUID } from '@shared-types/common';
import { now } from '../../shared/utils';

export class ArchiveKnowledgeLinkUseCase {
  constructor(private readonly linkRepo: KnowledgeLinkRepository) {}

  /** 归档一条关系。返回归档后的记录，供 UI 做「已归档，撤销」提示 */
  async execute(id: UUID): Promise<KnowledgeLink> {
    const existing = await this.linkRepo.findById(id);
    if (!existing) throw new Error('关系不存在，可能已被归档或从未创建');

    const timestamp = now();
    await this.linkRepo.archive(id, timestamp);

    return { ...existing, archivedAt: timestamp, updatedAt: timestamp };
  }

  /** 撤销归档 */
  async restore(id: UUID): Promise<KnowledgeLink> {
    const existing = await this.linkRepo.findById(id);
    if (!existing) throw new Error('关系不存在');

    const timestamp = now();
    await this.linkRepo.restore(id, timestamp);

    return { ...existing, archivedAt: undefined, updatedAt: timestamp };
  }
}

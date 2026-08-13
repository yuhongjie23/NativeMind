/**
 * DeleteAskSessionUseCase - 删除一条问答历史
 *
 * 用户显式操作（不是 AI 建议型写入），不走确认门。
 * 返回是否真的删到（false = id 不存在）。
 */
import type { AskSessionRepository } from '../../ports';
import type { UUID } from '@shared-types/common';

export class DeleteAskSessionUseCase {
  constructor(private readonly askRepo: AskSessionRepository) {}

  async execute(id: UUID): Promise<boolean> {
    return this.askRepo.delete(id);
  }
}

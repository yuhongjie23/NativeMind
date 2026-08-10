/**
 * ListLettersUseCase - 信件历史（最近的在前），含待发与已回
 */
import type { Letter, LetterRepository } from '../../ports';

export class ListLettersUseCase {
  constructor(private readonly letterRepo: LetterRepository) {}

  async execute(limit = 100): Promise<Letter[]> {
    return this.letterRepo.list(limit);
  }
}

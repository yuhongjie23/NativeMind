/**
 * 每日/每月来信用例测试
 *
 * 每月一次学习鼓励信；每日 30% 抽签（encourage / whats_up / warm）；
 * whats_up 用网络搜索到的见闻。用 mock Math.random 控制抽签与类型。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Letter, LetterRepository, SettingsKeyValuePort } from '@application/ports';
import { GenerateIncomingLetterUseCase } from '@application/use-cases/flora/generate-incoming-letter';

const makeRepo = (): LetterRepository & { saved: Letter[] } => {
  const saved: Letter[] = [];
  return {
    saved,
    save: async (letter: Letter) => void saved.push(letter),
    list: async () => saved,
    listPendingDue: async () => [],
  } as unknown as LetterRepository & { saved: Letter[] };
};

const makeSettings = (map = new Map<string, string>()): SettingsKeyValuePort => ({
  get: async (key) => map.get(key) ?? null,
  set: async (key, value) => void map.set(key, value),
});

const TODAY = '2026-08-06';

describe('GenerateIncomingLetterUseCase', () => {
  let random: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => random.mockRestore());

  it('每月第一次调用 → 发学习鼓励信并记录月份', async () => {
    const repo = makeRepo();
    const settings = makeSettings();
    const useCase = new GenerateIncomingLetterUseCase(repo, settings);

    const ok = await useCase.execute(TODAY);

    expect(ok).toBe(true);
    expect(repo.saved[0].type).toBe('encourage');
    expect(repo.saved[0].direction).toBe('in');
    expect(await settings.get('letter.lastEncourageMonth')).toBe('2026-08');
  });

  it('同月第二次 → 不发每月信；每日抽签未中则安静', async () => {
    const repo = makeRepo();
    const settings = makeSettings(new Map([['letter.lastEncourageMonth', '2026-08']]));
    const useCase = new GenerateIncomingLetterUseCase(repo, settings);

    const ok = await useCase.execute(TODAY); // random 0.5 >= 0.3 → 不中

    expect(ok).toBe(false);
    expect(repo.saved).toHaveLength(0);
  });

  it('每日抽中 → 生成 direction=in 的信（类型合法）', async () => {
    const repo = makeRepo();
    const settings = makeSettings(new Map([['letter.lastEncourageMonth', '2026-08']]));
    random.mockReturnValue(0.1); // < 0.3 中签
    const useCase = new GenerateIncomingLetterUseCase(repo, settings);

    const ok = await useCase.execute(TODAY);

    expect(ok).toBe(true);
    expect(repo.saved[0].direction).toBe('in');
    expect(['encourage', 'whats_up', 'warm']).toContain(repo.saved[0].type);
  });

  it('whats_up 来信引用网络搜索到的见闻', async () => {
    const repo = makeRepo();
    const settings = makeSettings(new Map([['letter.lastEncourageMonth', '2026-08']]));
    // 第一次 random：0.1 → 中签；第二次：0.5 → whats_up 段
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.5);
    const useCase = new GenerateIncomingLetterUseCase(repo, settings, async () => '一只会敲代码的猫');

    const ok = await useCase.execute(TODAY);

    expect(ok).toBe(true);
    expect(repo.saved[0].type).toBe('whats_up');
    expect(repo.saved[0].letter).toContain('敲代码的猫');
  });
});

/**
 * 问答历史用例测试：保存 / 列表 / 删除
 *
 * 假仓库收集副作用到数组（与 note-delete 测试同一模式），
 * 关注点：保存只追加、空问题拒绝、删除语义（真删 vs 不存在）。
 */
import { describe, expect, it } from 'vitest';
import type { AskSession, AskSessionRepository } from '@application/ports';
import { SaveAskSessionUseCase, type SaveAskSessionInput } from '@application/use-cases/ask/save-ask-session';
import { ListAskSessionsUseCase } from '@application/use-cases/ask/list-ask-sessions';
import { DeleteAskSessionUseCase } from '@application/use-cases/ask/delete-ask-session';

const makeRepo = (): AskSessionRepository & { saved: AskSession[] } => {
  const saved: AskSession[] = [];
  return {
    saved,
    save: async (session) => void saved.push(session),
    list: async () => saved,
    delete: async (id) => {
      const index = saved.findIndex((s) => s.id === id);
      if (index === -1) return false;
      saved.splice(index, 1);
      return true;
    },
  };
};

const validInput = (overrides: Partial<SaveAskSessionInput> = {}): SaveAskSessionInput => ({
  question: 'LoRA 是什么',
  answer: '低秩分解方法，用于高效微调大模型',
  citations: [{ chunkId: 'c1', noteId: 'n1', text: 'LoRA 通过低秩分解…', score: 0.8 }],
  confidence: 0.86,
  judged: true,
  regenerated: false,
  ok: true,
  empty: false,
  ...overrides,
});

describe('SaveAskSessionUseCase', () => {
  it('生成一条会话并写入仓库（只追加）', async () => {
    const repo = makeRepo();

    const session = await new SaveAskSessionUseCase(repo).execute(validInput());

    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0].question).toBe('LoRA 是什么');
    expect(session.id).toBeTruthy();
    expect(session.createdAt).toBeTruthy();
  });

  it('空问题拒绝保存', async () => {
    const repo = makeRepo();

    await expect(
      new SaveAskSessionUseCase(repo).execute(validInput({ question: '   ' }))
    ).rejects.toThrow('问题不能为空');
    expect(repo.saved).toHaveLength(0);
  });
});

describe('ListAskSessionsUseCase', () => {
  it('返回仓库里的全部历史', async () => {
    const repo = makeRepo();
    await new SaveAskSessionUseCase(repo).execute(validInput());
    await new SaveAskSessionUseCase(repo).execute(validInput({ question: 'QLoRA 呢' }));

    const list = await new ListAskSessionsUseCase(repo).execute();

    expect(list).toHaveLength(2);
  });
});

describe('DeleteAskSessionUseCase', () => {
  it('删除存在的返回 true 并从列表消失；不存在返回 false', async () => {
    const repo = makeRepo();
    const session = await new SaveAskSessionUseCase(repo).execute(validInput());

    expect(await new DeleteAskSessionUseCase(repo).execute(session.id)).toBe(true);
    expect(await new ListAskSessionsUseCase(repo).execute()).toHaveLength(0);
    expect(await new DeleteAskSessionUseCase(repo).execute('no-such-id')).toBe(false);
  });
});

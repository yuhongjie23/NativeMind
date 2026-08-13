/**
 * Flora 信件用例测试
 *
 * 写信 → 排队（半天后）；到点 → 生成回信标 sent；未到点 / 模型不可用 → 保持 pending。
 */
import { describe, expect, it } from 'vitest';
import type { FloraPort, Letter, LetterRepository } from '@application/ports';
import { WriteLetterUseCase } from '@application/use-cases/flora/write-letter';
import { ProcessLettersUseCase } from '@application/use-cases/flora/process-letters';
import { ListLettersUseCase } from '@application/use-cases/flora/list-letters';
import { ListConversationsUseCase } from '@application/use-cases/flora/list-conversations';
import { DeleteConversationUseCase } from '@application/use-cases/flora/delete-conversation';

const floraOk: FloraPort = {
  sendLetter: async () => ({
    reply: 'dear love, 加油',
    emotion: { emotion: '累', summary: 's', tone: 't' },
    verified: true,
    regenerated: false,
    ok: true,
  }),
};
const floraFail: FloraPort = {
  sendLetter: async () => ({ reply: '', verified: false, regenerated: false, ok: false }),
};

const makeRepo = (): LetterRepository & { saved: Letter[] } => {
  const saved: Letter[] = [];
  return {
    saved,
    // 与 SQLite 一致：同 id upsert，而非追加
    save: async (letter) => {
      const index = saved.findIndex((entry) => entry.id === letter.id);
      if (index >= 0) saved[index] = letter;
      else saved.push(letter);
    },
    list: async () => saved,
    listPendingDue: async (nowIso) =>
      saved.filter((letter) => letter.status === 'pending' && letter.sendAfter <= nowIso),
    deleteMany: async (ids) => {
      const set = new Set(ids);
      const before = saved.length;
      for (let i = saved.length - 1; i >= 0; i -= 1) {
        if (set.has(saved[i].id)) saved.splice(i, 1);
      }
      return before - saved.length;
    },
  };
};

describe('WriteLetterUseCase', () => {
  it('写信后立即回信并存为 sent，回信成为独立来信', async () => {
    const repo = makeRepo();

    const letter = await new WriteLetterUseCase(repo, floraOk).execute('亲爱的 Flora，最近有点累', 'zh');

    expect(letter.status).toBe('sent');
    expect(letter.sentAt).toBeTruthy();
    // 回信不内联在原信上，而是一条独立的「收到」来信
    const reply = repo.saved.find((entry) => entry.direction === 'in');
    expect(reply).toBeTruthy();
    expect(reply!.letter).toContain('dear love');
    expect(reply!.type).toBe('reply');
    expect(repo.saved).toHaveLength(2);
  });

  it('空信拒绝', async () => {
    const repo = makeRepo();
    await expect(new WriteLetterUseCase(repo, floraOk).execute('   ', 'zh')).rejects.toThrow(
      '信件内容不能为空'
    );
  });

  it('模型不可用 → 留 pending 待补发', async () => {
    const repo = makeRepo();

    const letter = await new WriteLetterUseCase(repo, floraFail).execute('你好', 'zh');

    expect(letter.status).toBe('pending');
    expect(repo.saved[0].status).toBe('pending');
  });
});

describe('ProcessLettersUseCase', () => {
  const makeDue = async (repo: LetterRepository & { saved: Letter[] }): Promise<Letter> => {
    // 用失败端口造一封 pending 信，再把 sendAfter 拨到已到期
    const letter = await new WriteLetterUseCase(repo, floraFail).execute('你好', 'zh');
    repo.saved[0] = { ...letter, sendAfter: new Date(Date.now() - 1000).toISOString() };
    return repo.saved[0];
  };

  it('到点的信生成回信并标 sent，回信成为独立来信', async () => {
    const repo = makeRepo();
    await makeDue(repo);

    const count = await new ProcessLettersUseCase(repo, floraOk).execute();

    expect(count).toBe(1);
    expect(repo.saved[0].status).toBe('sent');
    expect(repo.saved[0].sentAt).toBeTruthy();
    // 回信作为独立来信入「收到」栏
    const reply = repo.saved.find((entry) => entry.direction === 'in');
    expect(reply?.letter).toContain('dear love');
    expect(reply?.type).toBe('reply');
    expect(repo.saved).toHaveLength(2);
  });

  it('未到点的信保持 pending', async () => {
    const repo = makeRepo();
    const letter = await new WriteLetterUseCase(repo, floraFail).execute('你好', 'zh');
    // 把发送时刻拨到未来，模拟「还没到点」
    repo.saved[0] = { ...letter, sendAfter: new Date(Date.now() + 60_000).toISOString() };

    const count = await new ProcessLettersUseCase(repo, floraOk).execute();

    expect(count).toBe(0);
    expect(repo.saved[0].status).toBe('pending');
  });

  it('模型不可用（回信为空）→ 留在 pending 待下次重试', async () => {
    const repo = makeRepo();
    await makeDue(repo);

    const count = await new ProcessLettersUseCase(repo, floraFail).execute();

    expect(count).toBe(0);
    expect(repo.saved[0].status).toBe('pending');
  });
});

describe('ListLettersUseCase', () => {
  it('返回全部信件', async () => {
    const repo = makeRepo();
    await new WriteLetterUseCase(repo, floraOk).execute('第一封', 'zh');
    await new WriteLetterUseCase(repo, floraOk).execute('第二封', 'en');

    const list = await new ListLettersUseCase(repo).execute();

    // 每次写信 = 1 封寄出 + 1 封回信，共 4 条
    expect(list).toHaveLength(4);
    expect(list.filter((entry) => entry.direction === 'out')).toHaveLength(2);
    expect(list.filter((entry) => entry.direction === 'in')).toHaveLength(2);
  });
});

describe('ListConversationsUseCase / DeleteConversationUseCase', () => {
  it('同一会话内多条消息归成一段对话', async () => {
    const repo = makeRepo();
    await new WriteLetterUseCase(repo, floraOk).execute('你好 Flora', 'zh', 'conv-1');
    await new WriteLetterUseCase(repo, floraOk).execute('今天有点累', 'zh', 'conv-1');

    const conversations = await new ListConversationsUseCase(repo).execute();

    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('conv-1');
    expect(conversations[0].messages.length).toBe(4); // 2 条消息 + 2 条回信
    expect(conversations[0].letterIds).toHaveLength(4);
  });

  it('不传会话 id → 各成一段', async () => {
    const repo = makeRepo();
    await new WriteLetterUseCase(repo, floraOk).execute('第一段', 'zh');
    await new WriteLetterUseCase(repo, floraOk).execute('第二段', 'zh');

    const conversations = await new ListConversationsUseCase(repo).execute();

    expect(conversations).toHaveLength(2);
  });

  it('删除一段对话只删它自己的信件', async () => {
    const repo = makeRepo();
    await new WriteLetterUseCase(repo, floraOk).execute('留下', 'zh', 'keep');
    await new WriteLetterUseCase(repo, floraOk).execute('删掉', 'zh', 'drop');

    const deleted = await new DeleteConversationUseCase(repo).execute('drop');
    expect(deleted).toBe(2);

    const conversations = await new ListConversationsUseCase(repo).execute();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('keep');
  });
});

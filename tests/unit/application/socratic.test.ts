/**
 * 苏格拉底会话生命周期
 *
 * 重点覆盖三件事：
 * 1. 专注中禁止开启会话 —— 这条约束在用例层，不能只靠 UI 禁按钮
 * 2. completed 与 abandoned 是终态，不能互相翻转（否则会丢掉一次有效对话的记录）
 * 3. 两个结束操作都幂等：重复点击不该报错
 *
 * 用 InMemorySocraticRepository 而不是 mock：它的排序语义是刻意对齐 SQLite 的，
 * 拿它测才能反映真实行为。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { SimpleEventBus } from '@application/events/event-bus';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import { AbandonSocraticSessionUseCase } from '@application/use-cases/socratic/abandon-session';
import { AskSocraticQuestionUseCase } from '@application/use-cases/socratic/ask-question';
import { CompleteSocraticSessionUseCase } from '@application/use-cases/socratic/complete-session';
import { StartSocraticSessionUseCase } from '@application/use-cases/socratic/start-session';
import {
  InMemorySocraticRepository,
  TemplateSocraticQuestionPort,
} from '@infrastructure/local-demo';

interface Harness {
  repo: InMemorySocraticRepository;
  focus: FocusModePolicy;
  start: StartSocraticSessionUseCase;
  ask: AskSocraticQuestionUseCase;
  complete: CompleteSocraticSessionUseCase;
  abandon: AbandonSocraticSessionUseCase;
}

const setup = (): Harness => {
  const repo = new InMemorySocraticRepository();
  const eventBus = new SimpleEventBus();
  const focus = new FocusModePolicy();

  return {
    repo,
    focus,
    start: new StartSocraticSessionUseCase(repo, eventBus, focus),
    ask: new AskSocraticQuestionUseCase(repo, new TemplateSocraticQuestionPort()),
    complete: new CompleteSocraticSessionUseCase(repo),
    abandon: new AbandonSocraticSessionUseCase(repo),
  };
};

let h: Harness;
beforeEach(() => {
  h = setup();
});

describe('开启会话', () => {
  it('落库并置为 active', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });

    expect(session.status).toBe('active');
    await expect(h.repo.findSession(session.id)).resolves.toMatchObject({
      topic: '什么是复利',
    });
  });

  it('空主题被拒绝', async () => {
    await expect(h.start.execute({ topic: '   ' })).rejects.toThrow('主题不能为空');
  });

  /** 这条是架构约束：专注期间不允许开启需要投入的深度对话 */
  it('专注中拒绝开启', async () => {
    h.focus.activate('focus-1');

    await expect(h.start.execute({ topic: '什么是复利' })).rejects.toThrow('专注');
    await expect(h.repo.listSessions()).resolves.toHaveLength(0);
  });

  it('专注结束后可以开启', async () => {
    h.focus.activate('focus-1');
    h.focus.deactivate();

    await expect(h.start.execute({ topic: '什么是复利' })).resolves.toMatchObject({
      status: 'active',
    });
  });
});

describe('推进提问', () => {
  it('回答补写到上一轮，并生成下一问', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.ask.execute({ sessionId: session.id });
    await h.ask.execute({ sessionId: session.id, previousResponse: '本金产生的利息再生利息' });

    const exchanges = await h.repo.listExchanges(session.id);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].userResponse).toBe('本金产生的利息再生利息');
    expect(exchanges[1].turnNumber).toBe(2);
  });

  it('已结束的会话不能再追问', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.complete.execute(session.id);

    await expect(h.ask.execute({ sessionId: session.id })).rejects.toThrow('已结束');
  });
});

describe('结束会话', () => {
  it('完成后状态为 completed', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });

    await expect(h.complete.execute(session.id)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('放弃后状态为 abandoned，且记录保留', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.ask.execute({ sessionId: session.id });

    await expect(h.abandon.execute(session.id)).resolves.toMatchObject({
      status: 'abandoned',
    });
    // 放弃不删数据：已答内容仍要能回看
    await expect(h.repo.listExchanges(session.id)).resolves.toHaveLength(1);

  });

  it('重复完成是幂等的，不报错', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.complete.execute(session.id);

    await expect(h.complete.execute(session.id)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('重复放弃是幂等的，不报错', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.abandon.execute(session.id);

    await expect(h.abandon.execute(session.id)).resolves.toMatchObject({
      status: 'abandoned',
    });
  });

  /** 两个终态不能互相翻转：completed 被改成 abandoned 会丢掉一次有效对话 */
  it('已完成的不能改为放弃', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.complete.execute(session.id);

    await expect(h.abandon.execute(session.id)).rejects.toThrow('已完成');
  });

  it('已放弃的不能改为完成', async () => {
    const session = await h.start.execute({ topic: '什么是复利' });
    await h.abandon.execute(session.id);

    await expect(h.complete.execute(session.id)).rejects.toThrow('已放弃');
  });

  it('会话不存在时报错', async () => {
    await expect(h.complete.execute('missing')).rejects.toThrow('不存在');
    await expect(h.abandon.execute('missing')).rejects.toThrow('不存在');
  });
});

describe('会话列表', () => {
  it('最近更新的在前', async () => {
    const first = await h.start.execute({ topic: '第一个话题' });
    const second = await h.start.execute({ topic: '第二个话题' });
    // 动一下第一个，它应该浮到最上面
    await h.complete.execute(first.id);

    const sessions = await h.repo.listSessions();
    expect(sessions.map((session) => session.id)).toEqual([first.id, second.id]);
  });
});

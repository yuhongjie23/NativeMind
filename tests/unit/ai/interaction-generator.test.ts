import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractionGenerator } from '@ai/companion/interaction-generator';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest, ModelProvider } from '@ai/types';

const turn = { intent: 'acknowledge', emotion: 'calm', text: '这一段结束了，可以歇一会儿。', quickReplies: [] };
const setup = (handler: ModelProvider['complete']) => {
  const complete = vi.fn(handler);
  return { complete, generator: new InteractionGenerator(new ModelRouter({ isAvailable: async () => true, complete })) };
};

afterEach(() => vi.useRealTimers());

describe('宠物短句约束与取消', () => {
  it('使用结构化输出并传入场景、语气和陈述限制，不再要求 think 字段', async () => {
    const { generator, complete } = setup(async () => JSON.stringify(turn));
    const result = await generator.generateDialogue({ scene: 'focus_complete', responseMode: 'statement' });
    expect(result.fromTemplate).toBe(false);
    const req = complete.mock.calls[0][0];
    expect(req.json).toBe(true);
    expect(req.jsonSchema).toMatchObject({ required: ['intent', 'emotion', 'text', 'quickReplies'] });
    expect(req.system).toContain('禁止提问');
    expect(req.system).toContain('小玩偶');
    expect(req.system).not.toContain('think');
    expect(req.prompt).toContain('scene: focus_complete');
    expect(req.prompt).toContain('responseMode: statement');
  });

  it.each(['要记一笔吗？', '要不要继续', '你今天想学什么', '现在累吗'])('陈述模式拒绝追问 %s，兜底也不会追问', async text => {
    const { generator } = setup(async () => JSON.stringify({ ...turn, text }));
    const result = await generator.generateDialogue({ scene: 'focus_complete', responseMode: 'statement' });
    expect(result.fromTemplate).toBe(true);
    expect(result.content).not.toMatch(/[?？]|吗|要不要/);
  });

  it.each([
    { ...turn, intent: 'invented' },
    { ...turn, emotion: 'angry' },
    { ...turn, text: '长'.repeat(61) },
    { ...turn, text: '   ' },
    { ...turn, quickReplies: ['长'.repeat(17)] },
  ])('非法结构或空白正文只调用一次并使用模板', async output => {
    const { generator, complete } = setup(async () => JSON.stringify(output));
    expect((await generator.generateDialogue({ scene: 'health_reminder' })).fromTemplate).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('主动点击允许一个问题；回应用户后不再显示快捷追问', async () => {
    const { generator } = setup(async req => JSON.stringify(req.prompt.includes('responseMode: question')
      ? { ...turn, intent: 'clarify', text: '你现在卡在哪一步？', quickReplies: ['概念', '练习'] }
      : { ...turn, quickReplies: ['再问一个'] }));
    const question = await generator.generateQuestion({ scene: 'user_invoked' });
    expect(question.fromTemplate).toBe(false);
    expect(question.quickReplies).toEqual(['概念', '练习']);
    const feedback = await generator.generateFeedback({ previousQuestion: question.content, userResponse: '概念', scene: 'user_invoked' });
    expect(feedback.quickReplies).toEqual([]);
  });

  it('两个问号的问题退回单句模板', async () => {
    const { generator } = setup(async () => JSON.stringify({ ...turn, text: '累吗？要停吗？' }));
    expect((await generator.generateQuestion({ scene: 'user_invoked' })).fromTemplate).toBe(true);
  });

  it('超时中止实际 provider 请求，不重试、不留下计时器', async () => {
    vi.useFakeTimers();
    let request: ModelCompletionRequest | undefined;
    const cancelled = vi.fn();
    const { generator, complete } = setup(req => {
      request = req;
      return new Promise<string>((_resolve, reject) => req.signal?.addEventListener('abort', () => {
        cancelled();
        reject(req.signal?.reason);
      }, { once: true }));
    });
    const pending = generator.generateDialogue({ scene: 'health_reminder' });
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending).fromTemplate).toBe(true);
    expect(request?.signal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

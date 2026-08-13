/**
 * Flora 写信 agent 链测试
 *
 * 编排：低级模型情感分析 → 高级模型回信 → 低级模型验证（不达标重生成一次）。
 * 路由靠 system 提示词区分三步；语言模式决定回信语言。
 */
import { describe, expect, it } from 'vitest';
import { FloraAgent } from '@ai/flora/flora-agent';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest, ModelProvider } from '@ai/types';

const routerWith = (handler: (req: ModelCompletionRequest) => string): ModelRouter => {
  const provider: ModelProvider = {
    isAvailable: async () => true,
    complete: async (req) => handler(req),
  };
  return new ModelRouter(provider);
};

const isEmotion = (system: string): boolean => system.includes('信件阅读助手');
const isVerify = (system: string): boolean => system.includes('回信质检员');

describe('FloraAgent', () => {
  it('通读→情感→高级模型回信→低级模型验证通过', async () => {
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return JSON.stringify({ emotion: '低落', summary: '最近学习压力大', tone: '温柔鼓励' });
      if (isVerify(sys)) return JSON.stringify({ appropriate: true, critique: '' });
      return '别担心，慢慢来，我一直在。';
    });

    const result = await new FloraAgent(router).sendLetter('最近压力好大', 'zh');

    expect(result.ok).toBe(true);
    expect(result.emotion?.emotion).toBe('低落');
    expect(result.reply).toContain('别担心');
    expect(result.verified).toBe(true);
    expect(result.regenerated).toBe(false);
  });

  it('验证不达标→带意见重生成一次→再验证通过', async () => {
    let verifyCount = 0;
    let replyCount = 0;
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return JSON.stringify({ emotion: '焦虑', summary: 's', tone: 't' });
      if (isVerify(sys)) {
        verifyCount += 1;
        return JSON.stringify(
          verifyCount === 1 ? { appropriate: false, critique: '太说教' } : { appropriate: true, critique: '' }
        );
      }
      replyCount += 1;
      return replyCount === 1 ? '你该更努力' : '你已经做得很好了，慢慢来';
    });

    const result = await new FloraAgent(router).sendLetter('我考砸了', 'zh');

    expect(result.regenerated).toBe(true);
    expect(result.reply).toContain('慢慢来');
    expect(result.verified).toBe(true);
  });

  it('情感分析失败→仍尽力回信，不带情感标签', async () => {
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return '不是JSON';
      if (isVerify(sys)) return JSON.stringify({ appropriate: true, critique: '' });
      return '收到你的信了，别太累。';
    });

    const result = await new FloraAgent(router).sendLetter('今天好累', 'zh');

    expect(result.ok).toBe(true);
    expect(result.emotion).toBeUndefined();
    expect(result.reply).toContain('别太累');
  });

  it('回信失败→ok=false', async () => {
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return JSON.stringify({ emotion: 'x', summary: 's', tone: 't' });
      return '';
    });

    const result = await new FloraAgent(router).sendLetter('你好', 'zh');

    expect(result.ok).toBe(false);
    expect(result.reply).toBe('');
  });

  it('英文模式：回信提示词要求用英文', async () => {
    let replySystem = '';
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return JSON.stringify({ emotion: 'down', summary: 'stressed', tone: 'gentle' });
      if (isVerify(sys)) return JSON.stringify({ appropriate: true, critique: '' });
      replySystem = sys;
      return "Don't worry, take it slow.";
    });

    const result = await new FloraAgent(router).sendLetter('I am stressed', 'en');

    expect(result.ok).toBe(true);
    expect(replySystem).toContain('Please write the reply in English');
  });

  it('回信提示词要求 dear love 开头，末尾程序追加实时日期', async () => {
    let replySystem = '';
    const router = routerWith((req) => {
      const sys = req.system ?? '';
      if (isEmotion(sys)) return JSON.stringify({ emotion: '累', summary: 's', tone: 't' });
      if (isVerify(sys)) return JSON.stringify({ appropriate: true, critique: '' });
      replySystem = sys;
      return '亲爱的朋友，别太担心';
    });

    const result = await new FloraAgent(router).sendLetter('最近好累', 'zh');

    expect(replySystem).toContain('dear love');
    // 落款是程序追加的实时日期，不是模型生成
    expect(result.reply).toMatch(/\d{4}年\d{1,2}月\d{1,2}日/);
    expect(result.reply).toContain('别太担心');
  });
});

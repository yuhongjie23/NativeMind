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
  it.each(['emotion', 'reply', 'verify'])('取消 %s 阶段不会继续后续步骤或生成兜底回复', async stage => {
    const controller = new AbortController();
    const calls: string[] = [];
    const router = routerWith(req => {
      const step = isEmotion(req.system ?? '') ? 'emotion' : isVerify(req.system ?? '') ? 'verify' : 'reply';
      calls.push(step);
      if (step === stage) { controller.abort(); throw new Error('cancelled'); }
      if (step === 'emotion') return JSON.stringify({ emotion: 'calm', summary: 's', tone: 'warm' });
      if (step === 'verify') return JSON.stringify({ appropriate: true, critique: '' });
      return 'draft reply';
    });
    await expect(new FloraAgent(router).sendLetter('hello', 'zh', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual(['emotion', 'reply', 'verify'].slice(0, ['emotion', 'reply', 'verify'].indexOf(stage) + 1));
  });

  it('只预览回信正文，精修时替换旧预览', async () => {
    let verifies = 0;
    let preview = '';
    let resets = 0;
    const router = routerWith(req => {
      if (isEmotion(req.system ?? '')) return JSON.stringify({ emotion: 'calm', summary: 's', tone: 'warm' });
      if (isVerify(req.system ?? '')) return JSON.stringify({ appropriate: ++verifies > 1, critique: 'revise' });
      const reply = verifies ? 'revised reply' : 'first reply';
      req.onToken?.(reply);
      return reply;
    });
    const result = await new FloraAgent(router).sendLetter('hello', 'zh', {
      onToken: (delta, reset) => { if (reset) { preview = ''; resets++; } else preview += delta; },
    });
    expect(result.regenerated).toBe(true);
    expect(preview).toBe('revised reply');
    expect(resets).toBe(1);
  });
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
    expect(result.verificationStatus).toBe('passed');
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
    expect(result.verified).toBe(false);
    expect(result.verificationStatus).toBe('not_checked');
  });

  it('校验格式失败时保留回信，但不伪装为已通过', async () => {
    const router = routerWith(req => {
      if (isEmotion(req.system ?? '')) return JSON.stringify({ emotion: '不确定', summary: 's', tone: 't' });
      if (isVerify(req.system ?? '')) return '不是合法校验';
      return '收到你的信了。';
    });
    const result = await new FloraAgent(router).sendLetter('你好', 'zh');
    expect(result.ok).toBe(true);
    expect(result.reply).toContain('收到你的信');
    expect(result.verified).toBe(false);
    expect(result.verificationStatus).toBe('not_checked');
  });

  it('精修后仍不通过时保留 failed 状态', async () => {
    const router = routerWith(req => {
      if (isEmotion(req.system ?? '')) return JSON.stringify({ emotion: '不确定', summary: 's', tone: 't' });
      if (isVerify(req.system ?? '')) return JSON.stringify({ appropriate: false, critique: '没有回应内容' });
      return '一段回信';
    });
    const result = await new FloraAgent(router).sendLetter('你好', 'zh');
    expect(result.regenerated).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.verificationStatus).toBe('failed');
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
    expect(replySystem).toContain('Write the entire reply in English');
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

 it.each([true, false])('English reply repairs a wrong-language draft, repair succeeds=%s', async repairWorks => {
  let replies = 0;
  const router = routerWith(req => {
    if (isEmotion(req.system ?? '')) return 'invalid json';
    if (isVerify(req.system ?? '')) return JSON.stringify({ appropriate: true, critique: '' });
    expect(req.system).toContain('regardless of the language');
    replies++;
    return replies === 2 && repairWorks ? 'dear love, I hear you.' : '你好，今天也辛苦了。';
  });
  const result = await new FloraAgent(router).sendLetter('请用中文回答', 'en');
  expect(replies).toBe(2);
  expect(result.ok).toBe(repairWorks);
  expect(result.reply).not.toMatch(/[\u3400-\u9fff]/u);
 });

 it('passes bounded conversation history through to the reply prompt', async () => {
   const router = routerWith(req => {
     if (isEmotion(req.system ?? '')) return JSON.stringify({ emotion: 'calm', summary: 's', tone: 'warm' });
     if (isVerify(req.system ?? '')) return JSON.stringify({ appropriate: true, critique: '' });
     expect(req.prompt).toContain('binary search boundaries');
     expect(req.prompt).toContain('Where was I stuck?');
     expect(req.prompt).toContain('Earlier excerpts may be incomplete');
     return 'dear love, You mentioned binary search boundaries.';
   });
   const result = await new FloraAgent(router).sendLetter('Where was I stuck?', 'en', undefined, {
     recent: [{ role: 'user', content: 'I was stuck on binary search boundaries.' }], earlierExcerpts: [],
   });
   expect(result.reply).toContain('binary search boundaries');
 });

/**
 * ModelRouter 降级链测试（§16.1）
 *
 * 这是 AI 层最关键的可靠性逻辑：模型抽风时产品不能崩，
 * 最终必须能落到「用户手动填写」而不是抛错。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '@ai/router/model-router';
import { defaultTierConfigs } from '@ai/router/tier-config';
import { resolveModel } from '@ai/router/model-config';
import type { ModelProvider, ModelRunLog, ModelRunRecorder } from '@ai/types';

const FAST_MODEL = defaultTierConfigs.fast.model;
// coach/deep 解析到大模型（双模型配置，默认 14B）
const COACH_MODEL = resolveModel('coach');

const validIntent = JSON.stringify({ intent: 'create_todo', confidence: 0.9 });

/** 可编程的假 Provider：按模型名给出不同响应 */
const fakeProvider = (options: {
  available?: (model: string) => boolean;
  respond: (model: string, callIndex: number) => string | Promise<string>;
}): ModelProvider & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    isAvailable: async (model) => options.available?.(model) ?? true,
    complete: async ({ model }) => {
      calls.push(model);
      return options.respond(model, calls.length - 1);
    },
  };
};

describe('ModelRouter 降级链', () => {
  it('一次成功时不重试、不标记降级', async () => {
    const provider = fakeProvider({ respond: () => validIntent });
    const router = new ModelRouter(provider);

    const result = await router.run({ taskType: 'intent', input: { userInput: '安排今天' } });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ intent: 'create_todo', confidence: 0.9, entities: undefined });
    expect(result.attempts).toBe(1);
    expect(result.degraded).toBe(false);
    expect(provider.calls).toEqual([FAST_MODEL]);
  });

  it('Schema 校验失败时同层重试一次', async () => {
    // 第一次返回不在枚举内的 intent，第二次修好
    const provider = fakeProvider({
      respond: (_, i) => (i === 0 ? JSON.stringify({ intent: '瞎编的', confidence: 2 }) : validIntent),
    });
    const router = new ModelRouter(provider);

    const result = await router.run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.degraded).toBe(false);
    expect(provider.calls).toEqual([FAST_MODEL, FAST_MODEL]);
  });

  it('重试时把上一轮错误回灌给模型', async () => {
    const prompts: string[] = [];
    const provider: ModelProvider = {
      isAvailable: async () => true,
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return prompts.length === 1 ? '这不是 JSON' : validIntent;
      },
    };

    await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(prompts[0]).not.toContain('上一次输出不符合要求');
    expect(prompts[1]).toContain('上一次输出不符合要求');
    expect(prompts[1]).toContain('找不到 JSON');
  });

  it('同层两次都失败后降级到下一层级', async () => {
    // fast 永远输出脏数据，coach 正常
    const provider = fakeProvider({
      respond: (model) => (model === FAST_MODEL ? '{"intent":"不存在"}' : validIntent),
    });
    const router = new ModelRouter(provider);

    const result = await router.run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(true);
    expect(result.tier).toBe('coach');
    expect(result.degraded).toBe(true);
    expect(provider.calls).toEqual([FAST_MODEL, FAST_MODEL, COACH_MODEL]);
  });

  it('模型未安装时跳过该层级，不消耗重试次数', async () => {
    const provider = fakeProvider({
      available: (model) => model !== FAST_MODEL,
      respond: () => validIntent,
    });

    const result = await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(true);
    expect(result.tier).toBe('coach');
    expect(provider.calls).toEqual([COACH_MODEL]);
  });

  it('模型抛异常时不同层重试，直接降级', async () => {
    const provider = fakeProvider({
      respond: (model) => {
        if (model === FAST_MODEL) throw new Error('显存不足');
        return validIntent;
      },
    });

    const result = await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(true);
    // fast 只调了一次就降级，没有白重试
    expect(provider.calls).toEqual([FAST_MODEL, COACH_MODEL]);
  });

  it('所有层级都不可用时返回 ok=false 而不是抛错', async () => {
    const provider = fakeProvider({ available: () => false, respond: () => validIntent });

    const result = await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.error?.kind).toBe('model_unavailable');
  });

  it('全链路失败时不会无限循环', async () => {
    const provider = fakeProvider({ respond: () => 'garbage' });

    const result = await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('invalid_json');
    // fast 两次 + coach 两次，然后 fallback 回 fast 时因已访问过而终止
    expect(provider.calls).toEqual([FAST_MODEL, FAST_MODEL, COACH_MODEL, COACH_MODEL]);
  });

  it('容忍 Markdown 代码块包裹的 JSON', async () => {
    const provider = fakeProvider({
      respond: () => `好的，结果如下：\n\`\`\`json\n${validIntent}\n\`\`\``,
    });

    const result = await new ModelRouter(provider).run({ taskType: 'intent', input: {} });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('自由文本任务直接返回原文，不做 JSON 解析', async () => {
    const provider = fakeProvider({ respond: () => '  你觉得这两者的区别在哪？  ' });

    const result = await new ModelRouter(provider).run({
      taskType: 'socratic_question',
      input: {},
      promptVars: { topic: 'LoRA', history: '（首轮）' },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toBe('你觉得这两者的区别在哪？');
  });

  it('preferredTier 可覆盖路由表默认层级', async () => {
    const provider = fakeProvider({ respond: () => validIntent });

    const result = await new ModelRouter(provider).run({
      taskType: 'intent',
      input: {},
      modelPolicy: { preferredTier: 'coach' },
    });

    expect(result.tier).toBe('coach');
    // 起点就是 coach，不算降级
    expect(result.degraded).toBe(false);
  });
});

describe('ModelRouter 调用日志', () => {
  let logs: ModelRunLog[];
  let recorder: ModelRunRecorder;

  beforeEach(() => {
    logs = [];
    recorder = { record: async (log) => void logs.push(log) };
  });

  it('成功调用记录 passed 与 prompt/schema 版本', async () => {
    const provider = fakeProvider({ respond: () => validIntent });

    await new ModelRouter(provider, { recorder }).run({ taskType: 'intent', input: { a: 1 } });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      taskType: 'intent',
      validationResult: 'passed',
      promptVersion: 'intent.v1',
      schemaId: 'intent.v1',
      attempts: 1,
      degraded: false,
    });
    // 只存哈希，不存原始输入，避免日志泄漏笔记内容
    expect(logs[0].inputHash).toMatch(/^djb2:/);
  });

  it('失败调用记录 failed', async () => {
    const provider = fakeProvider({ respond: () => 'garbage' });

    await new ModelRouter(provider, { recorder }).run({ taskType: 'intent', input: {} });

    expect(logs[0].validationResult).toBe('failed');
    expect(logs[0].degraded).toBe(true);
  });

  it('日志写入失败不影响主流程', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = fakeProvider({ respond: () => validIntent });
    const failing: ModelRunRecorder = {
      record: async () => {
        throw new Error('数据库被锁');
      },
    };

    const result = await new ModelRouter(provider, { recorder: failing }).run({
      taskType: 'intent',
      input: {},
    });

    expect(result.ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ModelRouter 双 provider 路由（本地 + DeepSeek）', () => {
  it('fast 走本地 provider，coach 走云端 provider', async () => {
    const local = fakeProvider({ respond: () => '本地响应' });
    const cloud = fakeProvider({ respond: () => '云端响应' });
    const router = new ModelRouter(local, {}, (tier) => (tier === 'fast' ? null : cloud));

    // 两个自由文本任务（无 JSON 校验，fakeProvider 的文本响应合法）：
    // socratic（coach）→ 云端；query_rewrite（fast，有 prompt 模板）→ 本地
    await router.run({ taskType: 'socratic_question', input: {} }); // coach → 云端
    await router.run({ taskType: 'query_rewrite', input: {} }); // fast → 本地

    expect(cloud.calls).toHaveLength(1);
    expect(local.calls).toHaveLength(1);
  });

  it('云端 provider 不可用（未配 key）时 coach 降级到本地', async () => {
    const local = fakeProvider({ respond: () => '本地响应' });
    const cloudDown: ModelProvider = {
      isAvailable: async () => false,
      complete: async () => '',
    };
    const router = new ModelRouter(local, {}, (tier) => (tier === 'fast' ? null : cloudDown));

    const result = await router.run({ taskType: 'socratic_question', input: {} });

    // cloudDown 不可用 → 降级 fast → 本地
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it('selector 返回 null（无云端）时回退默认 provider', async () => {
    const local = fakeProvider({ respond: () => '本地响应' });
    const router = new ModelRouter(local, {}, () => null);

    await router.run({ taskType: 'socratic_question', input: {} });

    expect(local.calls).toHaveLength(1);
  });
});

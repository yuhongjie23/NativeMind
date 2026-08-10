/**
 * 约束解码链路测试
 *
 * 回归背景：todo_structuring 要求输出 JSON 数组，但只把 format=json 传给 Ollama
 * 只能保证「是合法 JSON」，不保证结构。实测本地 qwen2.5:1.5b / 7b 都稳定返回
 * 单个对象 `{...}` 而非 `[{...}]`，于是每次都栽在 Schema 校验上，
 * 界面表现为「点了拆解没反应」。
 *
 * 修法是把目标 Schema 交给运行时做约束解码，这里锁住两件事：
 * 1. router 会把 schema 往下传；
 * 2. OllamaProvider 会把它放进请求的 format 字段。
 */
import { describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '@ai/router/model-router';
import { getSchema, toDecodingSchema } from '@ai/schemas';
import { OllamaProvider } from '@infrastructure/model-runtime/ollama-provider';
import type { ModelCompletionRequest, ModelProvider } from '@ai/types';


describe('ModelRouter 传递 jsonSchema', () => {
  const makeProvider = (response: string) => {
    const complete = vi.fn(async (_request: ModelCompletionRequest) => response);
    const provider: ModelProvider = { isAvailable: async () => true, complete };
    return { provider, complete };
  };

  it('带 schema 的任务会把 schema 交给 provider', async () => {
    const { provider, complete } = makeProvider('[{"title":"读第三章"}]');
    const router = new ModelRouter(provider);

    const result = await router.run({
      taskType: 'todo_structuring',
      input: { goal: '看完第三章' },
      promptVars: { goal: '看完第三章' },
    });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledOnce();

    const request = complete.mock.calls[0][0];
    expect(request.json).toBe(true);
    // 传下去的是净化版；todo.v1 的 maxLength 都不大，净化后与原始一致
    expect(request.jsonSchema).toEqual(toDecodingSchema(getSchema('todo.v1')));
  });

  it('复盘任务传下去的 schema 已剔除大 maxLength', async () => {
    // 合法的 review-log.v1 输出
    const { provider, complete } = makeProvider(
      JSON.stringify({ content: 'x'.repeat(50), insights: [], nextTodos: [] })
    );
    const router = new ModelRouter(provider);

    const result = await router.run({
      taskType: 'review_daily',
      input: {},
      promptVars: { reviewType: '日复盘', dateRange: '2026-08-01', todoSummary: '-', focusSummary: '-' },
    });

    expect(result.ok).toBe(true);

    const sent = complete.mock.calls[0][0].jsonSchema as {
      properties: { content: Record<string, unknown> };
    };
    // content 原本是 maxLength 4000，会让 Ollama 编译 GBNF 失败并整个请求 400
    expect(sent.properties.content).not.toHaveProperty('maxLength');
    // 其余约束要保留，否则约束解码就没意义了
    expect(sent.properties.content).toMatchObject({ type: 'string', minLength: 20 });
  });


  it('自由文本任务不传 schema，避免把散文约束成 JSON', async () => {
    const { provider, complete } = makeProvider('今天做得不错。');
    const router = new ModelRouter(provider);

    await router.run({
      taskType: 'socratic_question',
      input: {},
      promptVars: { topic: 'LoRA' },
    });

    const request = complete.mock.calls[0][0];
    expect(request.json).toBeFalsy();
    expect(request.jsonSchema).toBeUndefined();
  });
});

describe('toDecodingSchema 净化规则', () => {
  it('剔除大 maxLength，保留小的', () => {
    const result = toDecodingSchema({
      type: 'object',
      properties: {
        big: { type: 'string', maxLength: 4000 },
        small: { type: 'string', maxLength: 60 },
        edge: { type: 'string', maxLength: 1000 },
      },
    } as never) as { properties: Record<string, Record<string, unknown>> };

    expect(result.properties.big).not.toHaveProperty('maxLength');
    expect(result.properties.small).toHaveProperty('maxLength', 60);
    // 1000 实测可用，是边界内的值
    expect(result.properties.edge).toHaveProperty('maxLength', 1000);
  });

  it('递归处理嵌套的 items 与 properties', () => {
    const result = toDecodingSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 9999 } },
      },
    } as never) as { items: { properties: Record<string, Record<string, unknown>> } };

    expect(result.items.properties.text).not.toHaveProperty('maxLength');
    expect(result.items.properties.text).toHaveProperty('type', 'string');
  });

  it('不改动原始 Schema（校验仍要用完整约束）', () => {
    const original = getSchema('review-log.v1') as unknown as {
      properties: { content: { maxLength?: number } };
    };
    const before = original.properties.content.maxLength;

    toDecodingSchema(getSchema('review-log.v1'));

    expect(original.properties.content.maxLength).toBe(before);
    expect(before).toBe(4000);
  });

  it('四个注册 schema 净化后都不含超限 maxLength', () => {
    const ids = ['intent.v1', 'todo.v1', 'review-log.v1', 'knowledge-link.v1'] as const;

    const collectMaxLengths = (node: unknown, found: number[] = []): number[] => {
      if (Array.isArray(node)) {
        node.forEach((item) => collectMaxLengths(item, found));
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'maxLength' && typeof value === 'number') found.push(value);
          else collectMaxLengths(value, found);
        }
      }
      return found;
    };

    for (const id of ids) {
      const lengths = collectMaxLengths(toDecodingSchema(getSchema(id)));
      for (const length of lengths) {
        expect(length, `${id} 仍含超限 maxLength ${length}`).toBeLessThanOrEqual(1000);
      }
    }
  });
});

describe('OllamaProvider 把 schema 放进 format', () => {

  /** 造一个假 fetch，捕获实际发出的请求体 */
  const captureBody = () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        json: async () => ({ response: '[]' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    return { bodies, fetchImpl };
  };

  it('给了 schema 就用 schema 做 format（约束解码）', async () => {
    const { bodies, fetchImpl } = captureBody();
    const provider = new OllamaProvider({ fetchImpl });
    const schema = getSchema('todo.v1');

    await provider.complete({
      model: 'qwen2.5:1.5b',
      prompt: '拆解任务',
      json: true,
      jsonSchema: schema,
    });

    expect(bodies[0].format).toEqual(schema);
  });

  it('没给 schema 时退回 "json"，保持原行为', async () => {
    const { bodies, fetchImpl } = captureBody();
    const provider = new OllamaProvider({ fetchImpl });

    await provider.complete({ model: 'qwen2.5:1.5b', prompt: '随便', json: true });

    expect(bodies[0].format).toBe('json');
  });

  it('非 JSON 任务不带 format', async () => {
    const { bodies, fetchImpl } = captureBody();
    const provider = new OllamaProvider({ fetchImpl });

    await provider.complete({ model: 'qwen2.5:7b', prompt: '写一段复盘' });

    expect(bodies[0].format).toBeUndefined();
  });
});

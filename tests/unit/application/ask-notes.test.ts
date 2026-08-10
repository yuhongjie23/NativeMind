/**
 * AskNotesUseCase 测试
 *
 * 薄用例：空查询短路不调端口；转发默认深度检索；端口抛错时返回空降级，不向外抛。
 */
import { describe, expect, it } from 'vitest';
import type { AskNotesPort } from '@application/ports';
import {
  AskNotesUseCase,
  emptyAskNotesAnswer,
} from '@application/use-cases/note/ask-notes';

describe('AskNotesUseCase', () => {
  it('转发问题到端口，默认深度检索', async () => {
    const calls: { question: string; deep?: boolean }[] = [];
    const port: AskNotesPort = {
      ask: async (input) => {
        calls.push(input);
        return {
          answer: 'LoRA 是低秩分解方法',
          citations: [],
          confidence: 0.9,
          judged: true,
          regenerated: false,
          empty: false,
          ok: true,
        };
      },
    };

    const result = await new AskNotesUseCase(port).execute('LoRA 是什么');

    expect(result.answer).toContain('LoRA');
    expect(calls).toEqual([{ question: 'LoRA 是什么', deep: true }]);
  });

  it('空查询短路，不调端口', async () => {
    let called = false;
    const port: AskNotesPort = {
      ask: async () => {
        called = true;
        return emptyAskNotesAnswer;
      },
    };

    const result = await new AskNotesUseCase(port).execute('   ');

    expect(result.empty).toBe(true);
    expect(called).toBe(false);
  });

  it('端口抛错时返回空降级，不向外抛', async () => {
    const port: AskNotesPort = {
      ask: async () => {
        throw new Error('本地模型不可用');
      },
    };

    const result = await new AskNotesUseCase(port).execute('问题');

    expect(result.ok).toBe(false);
    expect(result.empty).toBe(true);
  });
});

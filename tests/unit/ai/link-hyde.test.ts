/**
 * LinkHydeGenerator 单元测试
 *
 * 覆盖：
 * - 模型不可用 → 回退启发式（正文关键词 + 已有标签）
 * - 模型输出合法 → 合并已有标签 + 假设标签，去重截断
 * - 短内容 → 直接启发式（不调模型）
 * - 模型输出为空 → 回退启发式
 */
import { describe, expect, it, vi } from 'vitest';
import { LinkHydeGenerator } from '@ai/rag/link-hyde';
import type { ModelRouter } from '@ai/router/model-router';
import type { AIResult } from '@ai/types';

const makeRouter = (result?: AIResult<{ tags?: string[]; topics?: string[] }>): ModelRouter =>
  ({
    run: vi.fn().mockResolvedValue(
      result ?? {
        ok: false,
        tier: 'fast',
        model: 'qwen2.5:1.5b',
        attempts: 1,
        degraded: false,
        error: { kind: 'model_unavailable', message: '模型不可用' },
      }
    ),
  }) as unknown as ModelRouter;

describe('LinkHydeGenerator', () => {
  it('模型不可用时回退启发式：正文关键词 + 已有标签', async () => {
    const gen = new LinkHydeGenerator(makeRouter(), 100);
    const result = await gen.generate('这篇笔记讲的是离散数学的图论部分，包括欧拉回路和哈密顿路径。', ['数学']);

    expect(result.tags).toContain('数学');
    expect(result.topics.length).toBeGreaterThan(0);
  });

  it('模型输出合法时合并已有标签与假设标签', async () => {
    const gen = new LinkHydeGenerator(
      makeRouter({
        ok: true,
        tier: 'fast',
        model: 'qwen2.5:1.5b',
        attempts: 1,
        degraded: false,
        output: { tags: ['图论', '算法'], topics: ['欧拉回路', 'graph'] },
      }),
      100
    );
    const result = await gen.generate('图论是离散数学的分支，研究图的顶点与边。', ['数学']);

    expect(result.tags).toEqual(['数学', '图论', '算法']);
    expect(result.topics).toEqual(['欧拉回路', 'graph']);
  });

  it('短内容直接走启发式，不调模型', async () => {
    const router = makeRouter();
    const gen = new LinkHydeGenerator(router, 100);
    await gen.generate('一句话。', []);

    expect(router.run).not.toHaveBeenCalled();
  });

  it('模型输出为空时回退启发式', async () => {
    const gen = new LinkHydeGenerator(
      makeRouter({
        ok: true,
        tier: 'fast',
        model: 'qwen2.5:1.5b',
        attempts: 1,
        degraded: false,
        output: { tags: [], topics: [] },
      }),
      100
    );
    const result = await gen.generate('这是一段足够长的内容，超过二十个字才能触发模型调用，否则直接走启发式路径。', []);

    expect(result.topics.length).toBeGreaterThan(0);
  });
});

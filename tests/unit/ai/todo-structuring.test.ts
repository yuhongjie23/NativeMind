import { describe, expect, it, vi } from 'vitest';
import { TodoStructuringAdapter } from '@ai/adapters';
import { ModelRouter } from '@ai/router/model-router';
import { validateAgainstSchema } from '@ai/evaluation/json-validator';
import { getSchema } from '@ai/schemas';
import type { ModelCompletionRequest } from '@ai/types';

const setup = (output: unknown) => {
  const complete = vi.fn(async (_request: ModelCompletionRequest) => JSON.stringify(output));
  const adapter = new TodoStructuringAdapter(new ModelRouter({ isAvailable: async () => true, complete }));
  return { adapter, complete };
};

describe('任务拆解 v2', () => {
  it('允许单项粗略目标，未填写时间时不假定每日两小时', async () => {
    const { adapter, complete } = setup([{ title: '学一会儿微分方程' }]);
    expect(await adapter.structure('学一会儿微分方程')).toEqual([{ title: '学一会儿微分方程' }]);
    expect(complete.mock.calls).toHaveLength(1);
    expect(complete.mock.calls[0][0].system).toContain('未提供本次时间上限');
  });

  it('满足用户本次预算时保留全部草稿及原时长', async () => {
    const drafts = [{ title: '阅读第三章', estimatedMinutes: 20 }, { title: '整理第三章笔记', estimatedMinutes: 10 }];
    const { adapter, complete } = setup(drafts);
    expect(await adapter.structure('读第三章，然后整理笔记', { availableMinutes: 30 })).toEqual(drafts);
    expect(complete.mock.calls[0][0].jsonSchema).toMatchObject({ items: { required: ['title', 'estimatedMinutes'] } });
    expect(complete.mock.calls[0][0].system).toContain('本次最多 30 分钟');
  });

  it.each([
    [{ title: '阅读', estimatedMinutes: 20 }, { title: '笔记', estimatedMinutes: 15 }],
  ].map(drafts => ({ drafts })))('超预算或缺估时不交给确认门，不擅自截断任务', async ({ drafts }) => {
    const { adapter } = setup(drafts);
    await expect(adapter.structure('阅读并整理笔记', { availableMinutes: 30 })).rejects.toThrow('未满足本次可用时间');
  });

  it('缺少必填时长被路由校验拒绝，不返回可采用的草稿', async () => {
    expect(await setup([{ title: '阅读' }]).adapter.structure('阅读', { availableMinutes: 30 })).toEqual([]);
  });

  it.each([0, 7, NaN, Infinity, 1445])('无效时间 %s 在请求模型前拒绝', async availableMinutes => {
    const { adapter, complete } = setup([]);
    await expect(adapter.structure('学习', { availableMinutes })).rejects.toThrow('可用时间');
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([[{ title: ' ' }], [{ title: '读书' }, { title: ' 读书 ' }]].map(drafts => ({ drafts })))('拒绝空标题和重复任务', async ({ drafts }) => {
    await expect(setup(drafts).adapter.structure('读书')).rejects.toThrow('空白或重复任务');
  });

  it.each([
    [{ title: '长'.repeat(31) }],
    [{ title: '阅读', estimatedMinutes: 7 }],
    [{ title: '阅读', estimatedMinutes: 2.5 }],
  ].map(drafts => ({ drafts })))('结构校验落实字数、整数和五分钟倍数', ({ drafts }) => {
    expect(validateAgainstSchema(drafts, getSchema('todo.v2')).ok).toBe(false);
  });

  it('旧版本 schema 保持兼容，新版本允许无法满足约束时返回空数组', () => {
    expect(validateAgainstSchema([{ title: '长'.repeat(40), estimatedMinutes: 7 }], getSchema('todo.v1')).ok).toBe(true);
    expect(validateAgainstSchema([], getSchema('todo.v2')).ok).toBe(true);
  });
});

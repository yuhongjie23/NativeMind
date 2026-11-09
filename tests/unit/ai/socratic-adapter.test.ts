import { expect, it, vi } from 'vitest';
import { SocraticQuestionAdapter } from '@ai/adapters';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';
import { firstSocraticQuestion } from '@ai/socratic/first-question';

it('空白模型回复不能当成可用的学习问题', async () => {
  const provider = { isAvailable: async () => true, complete: async () => '  \n ' };
  const adapter = new SocraticQuestionAdapter(new ModelRouter(provider));
  await expect(adapter.askQuestion({ topic: '二分查找', history: [] })).rejects.toMatchObject({ name: 'ModelUnavailableError', message: expect.stringContaining('空内容') });
});

it('长会话保留最近六轮，限制单轮长度，仍带上最近回答', async () => {
  const complete = vi.fn(async (_request: ModelCompletionRequest) => '  你如何排除一半范围？  ');
  const adapter = new SocraticQuestionAdapter(new ModelRouter({ isAvailable: async () => true, complete }));
  const history = Array.from({ length: 12 }, (_, index) => ({ id: String(index), sessionId: 's1', turnNumber: index + 1,
    question: `第${index + 1}轮问题` + '问'.repeat(2000), userResponse: '我的理解' + '答'.repeat(20000), createdAt: '2026-11-06T00:00:00Z' }));
  history[11].userResponse = '最近回答：我认为无序数组也能二分查找。';
  expect(await adapter.askQuestion({ topic: '二分查找', history })).toEqual({ question: '你如何排除一半范围？' });
  const request = complete.mock.calls[0][0];
  expect(request.maxTokens).toBe(256);
  expect(request.prompt).not.toContain('Q6:');
  expect(request.prompt).toContain('Q7:');
  expect(request.prompt).toContain('最近回答：我认为无序数组也能二分查找。');
  // History stays data; do not repeat the latest answer inside the final instruction.
  expect(request.prompt.split(history[11].userResponse)).toHaveLength(2);
  expect(request.prompt.length).toBeLessThan(5000);
});

it('用户取消时向上抛出取消，不伪装成模型不可用', async () => {
  const controller = new AbortController(); controller.abort();
  const complete = vi.fn(async () => '问题？');
  const adapter = new SocraticQuestionAdapter(new ModelRouter({ isAvailable: async () => true, complete }));
  await expect(adapter.askQuestion({ topic: '二分查找', history: [] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(complete).not.toHaveBeenCalled();
});

it('模型连环追问时，流式预览和最终记录都只显示第一个问题', async () => {
  const provider = { isAvailable: async () => true, complete: async (request: ModelCompletionRequest) => {
    for (const delta of ['中间元素比目标大', '，该保留哪一半？接着', '有什么前提？']) request.onToken?.(delta);
    return '中间元素比目标大，该保留哪一半？接着有什么前提？';
  } };
  let preview = '';
  const result = await new SocraticQuestionAdapter(new ModelRouter(provider)).askQuestion({ topic: '二分查找', history: [] }, { onToken: delta => { preview += delta; } });
  expect(result.question).toBe('中间元素比目标大，该保留哪一半？');
  expect(preview).toBe(result.question);
});

it('引述的问号不截断学习问题', () => {
  expect(firstSocraticQuestion('你说“为什么？”，能举个例子吗？还有呢？')).toBe('你说“为什么？”，能举个例子吗？');
});

it('生成超时保留可操作原因，不提示用户重复安装模型', async () => {
  const provider = { isAvailable: async () => true, complete: async () => { throw new DOMException('Request aborted', 'AbortError'); } };
  await expect(new SocraticQuestionAdapter(new ModelRouter(provider)).askQuestion({ topic: '二分查找', history: [] })).rejects.toThrow('模型请求超时');
});

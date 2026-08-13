/**
 * Prompt 模板切分测试
 *
 * 回归背景：splitSections 的结尾锚点原先写成 `\Z`，JS 正则里没有这个转义，
 * 会被当成字面量 "Z"。于是「到文档结尾」这一分支永远匹配不上，
 * 位于文件末尾的 `## User` 段整段落空，fallback 把整个 markdown（含 System 段
 * 和 HTML 注释）塞给 user。表现是模型把注释里的内部说明也当成指令。
 */
import { describe, expect, it } from 'vitest';
import { renderPrompt } from '@ai/prompts';

describe('renderPrompt 切分 System / User', () => {
  it('User 段是文件最后一段时也能正确切出来', () => {
    const { system, user } = renderPrompt('todo-structuring.v1', {
      goal: '看完第三章',
      relatedNotes: '（无）',
      dailyBudgetMinutes: 120,
    });

    expect(system).not.toBe('');
    expect(user).not.toBe('');

    // user 段不该混进 System 段的内容
    expect(user).not.toContain('## System');
    expect(user).not.toContain('语气克制');
    // 也不该混进给开发者看的 HTML 注释
    expect(user).not.toContain('<!--');
    // 该有的变量要渲染进去
    expect(user).toContain('看完第三章');
  });

  it('system 段只包含 System 的内容，不含 User 段', () => {
    const { system } = renderPrompt('todo-structuring.v1', { goal: 'X' });

    expect(system).toContain('语气克制');
    // 只出现在 User 段的标记：格式示意和字段说明
    expect(system).not.toContain('格式示意');
    expect(system).not.toContain('已有的相关笔记');
    expect(system).not.toContain('X');
  });


  it('所有已注册 prompt 都能切出非空 user 段', () => {
    const ids = ['intent.v1', 'todo-structuring.v1', 'review-daily.v1', 'rag-relation.v1', 'socratic.v1'] as const;

    for (const id of ids) {
      const { user } = renderPrompt(id, {});
      expect(user, `${id} 的 user 段为空`).not.toBe('');
      expect(user, `${id} 的 user 段混入了注释`).not.toContain('<!--');
    }
  });

  it('缺失变量渲染成空串，不把 undefined 喂给模型', () => {
    const { user } = renderPrompt('todo-structuring.v1', {});

    expect(user).not.toContain('undefined');
    expect(user).not.toContain('{{goal}}');
  });

  it('todo 拆解 prompt 含 P0 反编造约束：保持用户粒度 + 子句全覆盖 + 禁编造', () => {
    const { system } = renderPrompt('todo-structuring.v1', { goal: 'X' });

    // 用户说得粗略就保持粗略（「学一会儿X」合法），不强制扩写
    expect(system).toContain('学一会儿');
    // 多段目标（然后/以及/、连接）每段至少一条任务，不能漏
    expect(system).toContain('每个部分必须至少对应一条任务');
    // 显式禁止编造用户未提及的章节/概念/题量
    expect(system).toContain('禁止编造用户未提及的具体章节');
    // 正面拆解示例换成了主题无关的「面试」，不再用微分方程教坏模型
    expect(system).toContain('准备明天的面试');
    expect(system).toContain('保持用户粒度');
  });
});

/**
 * 每日学习闭环的场景级测试（e2e 占位）
 *
 * 真正的浏览器 e2e 需要 Playwright / WebDriver 环境，当前仓库没有引入，
 * 这里退而求其次：用内存装配 + 全部用例跑一遍「建任务 → 专注 → 导入笔记
 * → 检索 → 建关系 → 生成复盘」的完整旅程，验证跨模块的数据流与事件链。
 * 等引入浏览器测试框架后，本目录可替换成真实 UI 驱动。
 */
import { describe, expect, it } from 'vitest';
import { createLocalDemoRuntime } from '@infrastructure/local-demo';

describe('每日学习闭环', () => {
  it('从建任务到复盘的全链路数据一致', async () => {
    const runtime = createLocalDemoRuntime({ confirmationPrompt: async () => true });
    const app = runtime.application;
    const repos = runtime.repositories;

    // 1. 手动创建任务
    const todo = await app.useCases.createTodo.execute({ title: '理解反向传播' });
    expect((await repos.todo.findById(todo.id))?.title).toBe('理解反向传播');

    // 2. 开始专注并完成
    await app.useCases.startFocus.execute({ todoId: todo.id, durationMinutes: 25 });
    const active = await repos.focus.findActive();
    expect(active?.status).toBe('active');
    await app.useCases.completeFocus.execute(active!.id, '做完了梯度推导');
    const sessions = await repos.focus.listAll();
    expect(sessions.find((s) => s.id === active!.id)?.status).toBe('completed');

    // 3. 导入笔记
    const note = await app.useCases.importNote.execute({
      kind: 'text',
      content: '反向传播用链式法则计算梯度',
      title: '反向传播笔记',
    });
    expect((await repos.note.findById(note.id))?.sourceType).toBe('imported_text');

    // 4. 本地检索始终可用，返回结构正确
    const search = await app.useCases.searchNotes.execute('链式法则');
    expect(Array.isArray(search.hits)).toBe(true);

    // 5. 手动建立知识链接（笔记 → 任务）
    await app.useCases.createKnowledgeLink.execute({
      fromType: 'note',
      fromId: note.id,
      toType: 'todo',
      toId: todo.id,
      relationType: 'prerequisite',
      reason: '理解反向传播是完成这个任务的前置',
    });
    const links = await repos.knowledgeLink.query({});
    expect(links.some((l) => l.fromId === note.id && l.toId === todo.id)).toBe(true);

    // 6. 生成日复盘（确认通过，落库）
    const review = await app.useCases.generateDailyReview.execute({ date: '2026-08-02' });
    expect(review).not.toBeNull();
    expect((await repos.review.findByDate('2026-08-02', 'daily'))?.reviewType).toBe('daily');
  });

  it('AI 建议型写入被拒绝时不落库', async () => {
    // 确认入口一律拒绝，模拟用户点了「不用了」
    const runtime = createLocalDemoRuntime({ confirmationPrompt: async () => false });
    const app = runtime.application;
    const repos = runtime.repositories;

    const todo = await app.useCases.createTodo.execute({ title: '不会写入的任务' });
    const before = (await repos.todo.listAll()).length;

    // executeFromGoal 会先拆解（模板拆出草稿），确认被拒后不写库
    await app.useCases.createTodo.executeFromGoal('读三章书');

    const after = await repos.todo.listAll();
    expect(after.length).toBe(before);
    expect(after.some((t) => t.id === todo.id)).toBe(true);
  });
});

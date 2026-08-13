/**
 * 连接页 store
 *
 * 重点测两件容易出错的事：
 * 1. 节点标签解析 —— 关系指向的实体可能已被删除，这时必须退化成
 *    「类型 + 短 id」而不是让整页崩掉或显示 undefined。
 * 2. 归档后能撤销 —— 软删除的价值全在这里。
 *
 * store 依赖 ./runtime 单例，而 runtime 在非 Tauri 环境下会自己造一套内存
 * 运行时；测试里直接用它，等于连着真实用例和内存仓储跑，比 mock 掉 useCases
 * 更能反映实际行为。确认弹窗在 demo 运行时默认拒绝，但手动建立关系不走确认，
 * 所以不影响这里的用例。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { repositories } from '@ui/stores/runtime';
import { useKnowledgeLinkStore } from '@ui/stores/knowledge-link-store';

const NOTE_A = {
  id: 'note-a',
  title: '线性代数基础',
  content: '向量空间',
  contentHash: 'hash-a',
  sourceType: 'manual' as const,
  indexStatus: 'indexed' as const,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const store = () => useKnowledgeLinkStore.getState();

/** 测试用例里反复引用的笔记端点，beforeEach 统一建好（真实存在，不会被悬空过滤掉） */
const NOTE_B = { ...NOTE_A, id: 'note-b', title: '线性代数进阶', contentHash: 'hash-b' };
const NOTE_C = { ...NOTE_A, id: 'note-c', title: '矩阵论', contentHash: 'hash-c' };

describe('useKnowledgeLinkStore', () => {
  beforeEach(async () => {
    // 每个用例从干净状态开始：store 是模块级单例，会跨用例串味
    useKnowledgeLinkStore.setState({
      graph: { nodes: [], links: [] },
      selected: undefined,
      relationFilter: [],
      includeArchived: false,
      lastArchived: undefined,
      error: undefined,
    });

    // 归档掉上一个用例留下的边，避免唯一边约束把结果搅在一起。
    // 注意：归档不是删除，所以 includeArchived 的断言不能只看总数，
    // 得按 id 找具体那条（见下面的用例）。
    const existing = await repositories.knowledgeLink.query({ includeArchived: true });
    for (const link of existing) {
      await repositories.knowledgeLink.archive(link.id, '2026-01-01T00:00:00.000Z');
    }

    // 建好常用的笔记端点；不存在的端点会被图谱悬空过滤掉（见悬空用例）
    await repositories.note.save(NOTE_A);
    await repositories.note.save(NOTE_B);
    await repositories.note.save(NOTE_C);
  });


  it('节点标签取自笔记标题', async () => {
    await repositories.note.save(NOTE_A);

    await store().createLink({
      fromType: 'note',
      fromId: 'note-a',
      toType: 'note',
      toId: 'note-b',
      relationType: 'prerequisite',
      reason: 'A 是 B 的前置',
    });

    const labels = store().graph.nodes.map((node) => node.label);
    expect(labels).toContain('线性代数基础');
  });

  it('指向已删除实体时过滤悬空节点，不显示「笔记+短id」假节点', async () => {
    await store().createLink({
      fromType: 'note',
      fromId: 'ffffffff-dead-beef-0000-000000000000',
      toType: 'note',
      toId: 'note-b',
      relationType: 'review_later',
      reason: '目标笔记已被删除',
    });

    // 悬空节点（笔记不存在）被过滤掉：图上不显示「笔记 ffffffff…」这种看不出是哪篇的假节点
    const labels = store().graph.nodes.map((node) => node.label);
    expect(labels).not.toContain('笔记 ffffffff…');
    // 悬空边（两端都查不到实体的边）也不出现在图上
    expect(store().graph.links).toHaveLength(0);
  });


  it('归档后默认看不到，撤销后回来', async () => {
    await store().createLink({
      fromType: 'note',
      fromId: 'note-a',
      toType: 'note',
      toId: 'note-b',
      relationType: 'contrast',
      reason: '待归档',
    });

    const [link] = store().graph.links;
    await store().archive(link.id);

    expect(store().graph.links).toHaveLength(0);
    // 归档记录留着，页面才能给出「撤销」
    expect(store().lastArchived?.id).toBe(link.id);

    await store().undoArchive();
    expect(store().graph.links).toHaveLength(1);
    expect(store().lastArchived).toBeUndefined();
  });

  it('勾选「显示已归档」后能看到归档项', async () => {
    await store().createLink({
      fromType: 'note',
      fromId: 'note-a',
      toType: 'note',
      toId: 'note-b',
      relationType: 'extends',
      reason: '归档后仍可查',
    });

    const [link] = store().graph.links;
    await store().archive(link.id);
    await store().setIncludeArchived(true);

    const found = store().graph.links.find((item) => item.id === link.id);
    expect(found).toBeDefined();
    expect(found?.archivedAt).toBeDefined();
  });


  it('按关系类型筛选只留匹配的边', async () => {
    await store().createLink({
      fromType: 'note',
      fromId: 'note-a',
      toType: 'note',
      toId: 'note-b',
      relationType: 'prerequisite',
    });
    await store().createLink({
      fromType: 'note',
      fromId: 'note-a',
      toType: 'note',
      toId: 'note-c',
      relationType: 'contrast',
    });

    await store().toggleRelation('contrast');
    expect(store().graph.links).toHaveLength(1);
    expect(store().graph.links[0].relationType).toBe('contrast');

    // 再点一次取消筛选
    await store().toggleRelation('contrast');
    expect(store().graph.links).toHaveLength(2);
  });

  it('可选实体含笔记与未完成任务，排除已完成任务', async () => {
    await repositories.note.save(NOTE_A);
    await repositories.todo.save({
      id: 'todo-open',
      title: '读完第三章',
      status: 'pending',
      priority: 'medium',
      tags: [],
      linkedNoteIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await repositories.todo.save({
      id: 'todo-done',
      title: '已经做完的事',
      status: 'completed',
      priority: 'low',
      tags: [],
      linkedNoteIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });


    await store().refresh();

    const labels = store().entityOptions.map((option) => option.label);
    expect(labels).toContain('线性代数基础');
    expect(labels).toContain('读完第三章');
    // 给已完成的任务挂前置关系没有意义，不该出现在选项里
    expect(labels).not.toContain('已经做完的事');
  });

  it('重复点同一节点取消选中', () => {

    store().select({ type: 'note', id: 'note-a' });
    expect(store().selected).toEqual({ type: 'note', id: 'note-a' });

    store().select({ type: 'note', id: 'note-a' });
    expect(store().selected).toBeUndefined();
  });

  it('校验失败时把错误留在 state 里而不是抛出去', async () => {
    await store().createLink({
      fromType: 'note',
      fromId: 'same',
      toType: 'note',
      toId: 'same',
      relationType: 'same_concept',
    });

    // 页面靠这个字段显示提示，抛异常会让整个页面白屏
    expect(store().error).toContain('指向自己');
  });
});

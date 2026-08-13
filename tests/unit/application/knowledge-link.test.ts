/**
 * 知识链接后端闭环
 *
 * 覆盖三件容易出错的事：
 * 1. AI 建议必须经用户确认才写库（架构约束 C9）
 * 2. 同一条边重复建立是更新而非追加，且不会把已确认状态改回未确认
 * 3. 删除走归档，查询默认看不到归档项，且可以撤销
 *
 * 用 InMemoryKnowledgeLinkRepository 而不是 mock：它的语义（唯一边、归档过滤、
 * 排序）是刻意对齐 SQLite 实现的，拿它测才能反映真实行为。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import type { DomainEvent } from '@application/events/event-types';
import { ArchiveKnowledgeLinkUseCase } from '@application/use-cases/knowledge-link/archive-link';
import { CreateKnowledgeLinkUseCase } from '@application/use-cases/knowledge-link/create-link';
import {
  buildGraph,
  QueryKnowledgeLinksUseCase,
} from '@application/use-cases/knowledge-link/query-links';
import {
  InMemoryActionProposalRepository,
  InMemoryKnowledgeLinkRepository,
} from '@infrastructure/local-demo';

const EDGE = {
  fromType: 'note',
  fromId: 'note-a',
  toType: 'note',
  toId: 'note-b',
  relationType: 'prerequisite',
} as const;

interface Harness {
  repo: InMemoryKnowledgeLinkRepository;
  create: CreateKnowledgeLinkUseCase;
  query: QueryKnowledgeLinksUseCase;
  archive: ArchiveKnowledgeLinkUseCase;
  events: DomainEvent[];
}

/** decision 决定确认弹窗的返回值 */
const setup = (decision: boolean): Harness => {
  const repo = new InMemoryKnowledgeLinkRepository();
  const eventBus = new SimpleEventBus();
  const events: DomainEvent[] = [];
  eventBus.subscribe('KnowledgeLinkConfirmed', (event) => {
    events.push(event);
  });

  const confirmation = new ConfirmationService(
    new InMemoryActionProposalRepository(),
    async () => decision
  );

  return {
    repo,
    create: new CreateKnowledgeLinkUseCase(repo, eventBus, confirmation),
    query: new QueryKnowledgeLinksUseCase(repo),
    archive: new ArchiveKnowledgeLinkUseCase(repo),
    events,
  };
};

describe('CreateKnowledgeLinkUseCase', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = setup(true);
  });

  it('用户手动创建直接写库并标记为已确认', async () => {
    const link = await harness.create.execute({ ...EDGE, reason: '先学线性代数' });

    expect(link.createdBy).toBe('user_manual');
    expect(link.confirmedByUser).toBe(true);
    expect(await harness.query.execute()).toHaveLength(1);
    expect(harness.events).toHaveLength(1);
  });

  it('AI 建议被拒绝时不写库', async () => {
    const rejected = setup(false);

    const links = await rejected.create.executeFromSuggestions([
      { ...EDGE, reason: 'A 是 B 的前置' },
    ]);

    expect(links).toEqual([]);
    expect(await rejected.query.execute()).toEqual([]);
    // 没写库就不该发事件，否则订阅者会去查一条不存在的关系
    expect(rejected.events).toEqual([]);
  });

  it('AI 建议经确认后写库', async () => {
    const links = await harness.create.executeFromSuggestions([
      { ...EDGE, reason: 'A 是 B 的前置', confidence: 0.6 },
    ]);

    expect(links).toHaveLength(1);
    expect(links[0].createdBy).toBe('ai_suggestion');
    expect(links[0].confidence).toBe(0.6);
    expect(harness.events[0]).toMatchObject({ type: 'KnowledgeLinkConfirmed' });
  });

  it('重复建立同一条边是更新，不新增记录', async () => {
    const first = await harness.create.execute({ ...EDGE, reason: '初版理由' });
    const second = await harness.create.execute({ ...EDGE, reason: '修正后的理由' });

    expect(second.id).toBe(first.id);
    expect(second.reason).toBe('修正后的理由');
    expect(await harness.query.execute()).toHaveLength(1);
  });

  it('AI 再次建议不会把已确认的关系改回未确认', async () => {
    await harness.create.execute({ ...EDGE, reason: '用户手动确认过' });

    await harness.create.executeFromSuggestions([{ ...EDGE, reason: 'AI 又建议了一次' }]);

    const [link] = await harness.query.execute();
    expect(link.confirmedByUser).toBe(true);
    // createdBy 保留最初来源，便于审计
    expect(link.createdBy).toBe('user_manual');
  });

  it('拒绝指向自己的关系', async () => {
    await expect(
      harness.create.execute({
        fromType: 'note',
        fromId: 'note-a',
        toType: 'note',
        toId: 'note-a',
        relationType: 'same_concept',
      })
    ).rejects.toThrow('指向自己');
  });

  it('拒绝越界的置信度', async () => {
    await expect(harness.create.execute({ ...EDGE, confidence: 1.5 })).rejects.toThrow('0 到 1');
  });
});

describe('ArchiveKnowledgeLinkUseCase', () => {
  it('归档后默认查询不再返回，撤销后恢复', async () => {
    const harness = setup(true);
    const link = await harness.create.execute({ ...EDGE, reason: '待归档' });

    await harness.archive.execute(link.id);
    expect(await harness.query.execute()).toEqual([]);
    // 归档是软删除：带上 includeArchived 仍然查得到，保留了留痕能力
    expect(await harness.query.execute({ includeArchived: true })).toHaveLength(1);

    await harness.archive.restore(link.id);
    expect(await harness.query.execute()).toHaveLength(1);
  });

  it('归档不存在的关系会报错而不是静默通过', async () => {
    const harness = setup(true);
    await expect(harness.archive.execute('missing-id')).rejects.toThrow('不存在');
  });
});

describe('QueryKnowledgeLinksUseCase', () => {
  it('按端点查询时起点和终点都算命中', async () => {
    const harness = setup(true);
    await harness.create.execute({ ...EDGE, reason: 'a → b' });

    // note-b 是终点，也应该能查到这条边
    const asTarget = await harness.query.findNeighbors({ type: 'note', id: 'note-b' });
    expect(asTarget).toHaveLength(1);

    const unrelated = await harness.query.findNeighbors({ type: 'note', id: 'note-z' });
    expect(unrelated).toEqual([]);
  });

  it('按关系类型筛选', async () => {
    const harness = setup(true);
    await harness.create.execute({ ...EDGE, reason: '前置' });
    await harness.create.execute({
      ...EDGE,
      toId: 'note-c',
      relationType: 'contrast',
      reason: '对比',
    });

    const contrasts = await harness.query.execute({ relationTypes: ['contrast'] });
    expect(contrasts).toHaveLength(1);
    expect(contrasts[0].relationType).toBe('contrast');
  });

  it('组装图时按度数排序并去重端点', async () => {
    const harness = setup(true);
    await harness.create.execute({ ...EDGE, reason: 'a → b' });
    await harness.create.execute({ ...EDGE, toId: 'note-c', reason: 'a → c' });

    const graph = await harness.query.executeAsGraph();

    // a 连了两条边，b / c 各一条 —— 三个节点而非四个
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0]).toMatchObject({ id: 'note-a', degree: 2 });
    expect(graph.links).toHaveLength(2);
  });

  it('buildGraph 对空输入返回空图', () => {
    expect(buildGraph([])).toEqual({ nodes: [], links: [] });
  });

  it('deleteByEntity 清掉某实体关联的全部边（起点或终点）', async () => {
    const harness = setup(true);
    await harness.create.execute({ ...EDGE, reason: 'a → b' });
    await harness.create.execute({ ...EDGE, fromId: 'note-c', toId: 'note-a', reason: 'c → a' });
    await harness.create.execute({ ...EDGE, fromId: 'note-d', toId: 'note-e', reason: '无关' });

    await harness.repo.deleteByEntity({ type: 'note', id: 'note-a' });

    // a 相关的两条边（起点和终点各一）都被清掉，无关边保留
    const remaining = await harness.query.execute();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ fromId: 'note-d', toId: 'note-e' });

    // 图上不再出现 note-a
    const graph = await harness.query.executeAsGraph();
    expect(graph.nodes.some((node) => node.id === 'note-a')).toBe(false);
  });
});

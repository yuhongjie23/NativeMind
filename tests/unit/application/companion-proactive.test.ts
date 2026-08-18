/**
 * 陪伴 agent 主动调度用例单测
 *
 * 关键路径：聚合上下文 → decide → InteractionPolicy 裁决（专注/节流/上限）→ 生成 → 写库。
 * 用 InMemory 仓储连真实政策跑，比 mock 掉政策更贴近实际行为。
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryCompanionInteractionRepository,
  InMemoryFocusRepository,
  InMemoryTodoRepository,
} from '@infrastructure/local-demo';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import {
  InteractionPolicy,
  defaultInteractionConfig,
} from '@application/policies/interaction-policy';
import { ProactiveCompanionTickUseCase } from '@application/use-cases/companion/proactive-tick';
import type { CompanionQuestionPort } from '@application/ports';

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString();

const questionPort: CompanionQuestionPort = {
  generateQuestion: async () => ({ content: '?', emotion: 'curious' }),
  generateFeedback: async () => ({ content: 'ok', emotion: 'calm' }),
  generateDialogue: async ({ scene }) => ({ content: `台词(${scene})`, emotion: 'calm' }),
};

const build = () => {
  const todoRepo = new InMemoryTodoRepository();
  const focusRepo = new InMemoryFocusRepository();
  const interactionRepo = new InMemoryCompanionInteractionRepository();
  const focusPolicy = new FocusModePolicy();
  const policy = new InteractionPolicy(interactionRepo, focusPolicy, defaultInteractionConfig);
  const useCase = new ProactiveCompanionTickUseCase(
    todoRepo,
    focusRepo,
    interactionRepo,
    policy,
    questionPort
  );
  return { todoRepo, focusRepo, interactionRepo, focusPolicy, policy, useCase };
};

describe('ProactiveCompanionTickUseCase', () => {
  it('完全没活动且健康提醒已发过 → 安静（null）', async () => {
    const { interactionRepo, useCase } = build();
    // 播种一次 5 分钟前的健康提醒：久坐节律未到，其它分支无活动 → 安静
    await interactionRepo.create({
      id: 'recent-health',
      companionId: 'fulilian',
      sceneType: 'health_reminder',
      interactionType: 'dialogue',
      content: '起来扭扭腰。',
      requiresResponse: false,
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    expect(await useCase.execute()).toBeNull();
  });

  it('有卡了 3 天的待办 → 主动鼓励并写库', async () => {
    const { todoRepo, useCase } = build();
    await todoRepo.save({
      id: 'todo-stuck',
      title: '卡住的数学',
      description: undefined,
      status: 'pending',
      priority: 'medium',
      tags: [],
      linkedNoteIds: [],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    });

    const interaction = await useCase.execute();
    expect(interaction).not.toBeNull();
    expect(interaction!.sceneType).toBe('stuck_encourage');
    expect(interaction!.content).toBe('台词(stuck_encourage)');
  });

  it('专注中 → 不主动打扰（null）', async () => {
    const { todoRepo, focusPolicy, useCase } = build();
    await todoRepo.save({
      id: 'todo-stuck',
      title: '卡住的数学',
      description: undefined,
      status: 'pending',
      priority: 'medium',
      tags: [],
      linkedNoteIds: [],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    });
    focusPolicy.activate('session-1');

    expect(await useCase.execute()).toBeNull();
  });

  it('距上次互动太近 → 节流拦截（null）', async () => {
    const { todoRepo, interactionRepo, useCase } = build();
    await todoRepo.save({
      id: 'todo-stuck',
      title: '卡住的数学',
      description: undefined,
      status: 'pending',
      priority: 'medium',
      tags: [],
      linkedNoteIds: [],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    });
    await interactionRepo.create({
      id: 'recent',
      companionId: 'gugu-gaga',
      sceneType: 'enter',
      interactionType: 'dialogue',
      content: '刚说过话',
      requiresResponse: false,
      createdAt: new Date().toISOString(),
    });

    expect(await useCase.execute()).toBeNull();
  });

  it('有活动且距上次够久 → 轻招呼', async () => {
    const { focusRepo, interactionRepo, useCase } = build();
    await focusRepo.save({
      id: 'focus-1',
      todoId: undefined,
      durationMinutes: 25,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed',
    });
    // 今日健康提醒已达上限（12 次）→ 健康分支被抑制；最后一次在 35 分钟前
    // （足够让 idle_checkin 的「距上次互动 ≥ 30 分钟」通过）
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - (i + 1) * 35);
      await interactionRepo.create({
        id: `health-${i}`,
        companionId: 'fulilian',
        sceneType: 'health_reminder',
        interactionType: 'dialogue',
        content: `第${i}次`,
        requiresResponse: false,
        createdAt: d.toISOString(),
      });
    }
    // 加上一个更早的旧互动（enter），保持历史合理
    await interactionRepo.create({
      id: 'old',
      companionId: 'gugu-gaga',
      sceneType: 'enter',
      interactionType: 'dialogue',
      content: '早前说过',
      requiresResponse: false,
      createdAt: daysAgo(1),
    });

    const interaction = await useCase.execute();
    expect(interaction?.sceneType).toBe('idle_checkin');
  });

  it('无健康提醒记录且活动正常 → 发久坐健康提醒（眨眼）', async () => {
    const { focusRepo, useCase } = build();
    // 有一次完成专注，让上下文有活动（不干扰健康提醒分支）
    await focusRepo.save({
      id: 'focus-1',
      todoId: undefined,
      durationMinutes: 25,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed',
    });

    const interaction = await useCase.execute();
    expect(interaction?.sceneType).toBe('health_reminder');
  });

  it('半小时内已提醒过 → 不再重复发健康提醒', async () => {
    const { interactionRepo, useCase } = build();
    await interactionRepo.create({
      id: 'recent-health',
      companionId: 'fulilian',
      sceneType: 'health_reminder',
      interactionType: 'dialogue',
      content: '起来扭扭腰。',
      requiresResponse: false,
      createdAt: new Date().toISOString(), // 刚才
    });

    expect(await useCase.execute()).toBeNull();
  });

  it('健康提醒轮换：第 1 次眨眼、第 5 次回到眨眼（facts 带动作）', async () => {
    const { interactionRepo, useCase } = build();
    // 今天已有 4 次健康提醒（不同时段），第 5 次应回到眨眼
    for (let i = 0; i < 4; i++) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - (i + 1) * 35); // 每次间隔 > 30 分钟
      await interactionRepo.create({
        id: `health-${i}`,
        companionId: 'fulilian',
        sceneType: 'health_reminder',
        interactionType: 'dialogue',
        content: `第${i}次`,
        requiresResponse: false,
        createdAt: d.toISOString(),
      });
    }

    const interaction = await useCase.execute();
    expect(interaction?.sceneType).toBe('health_reminder');
    expect(interaction?.content).toBe('台词(health_reminder)');
  });

  it('健康提醒每天上限（12 次）后不再发', async () => {
    const { interactionRepo, useCase } = build();
    // 今天已达 12 次 → 不再发
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - (i + 1) * 35);
      await interactionRepo.create({
        id: `health-cap-${i}`,
        companionId: 'fulilian',
        sceneType: 'health_reminder',
        interactionType: 'dialogue',
        content: `第${i}次`,
        requiresResponse: false,
        createdAt: d.toISOString(),
      });
    }

    expect(await useCase.execute()).toBeNull();
  });
});

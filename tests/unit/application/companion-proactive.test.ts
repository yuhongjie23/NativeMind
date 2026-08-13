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
  it('完全没活动 → 安静（null）', async () => {
    const { useCase } = build();
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
});

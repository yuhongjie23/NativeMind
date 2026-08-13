/**
 * CompanionProfile 领域规则单测
 * 名称/路径校验、场景与状态映射、低存在感判定。
 */
import { describe, expect, it } from 'vitest';
import {
  CompanionProfileDomainService,
  CompanionScene,
  CompanionState,
} from '@domain/companion';
import { ValidationError } from '@shared-types/common';

const create = () =>
  CompanionProfileDomainService.create(
    {
      name: '咕咕嘎嘎',
      description: '安静待着的小玩偶',
      tone: '平实简短',
      resourcePackPath: '/companions/gugu-gaga',
    },
    'companion_1',
    '2026-08-02T09:00:00.000Z'
  );

describe('CompanionProfileDomainService 校验', () => {
  it('名称不能为空或超 50 字符', () => {
    expect(() => CompanionProfileDomainService.validateName('')).toThrow(ValidationError);
    expect(() => CompanionProfileDomainService.validateName('x'.repeat(51))).toThrow(
      ValidationError
    );
  });

  it('资源包路径不能为空', () => {
    expect(() => CompanionProfileDomainService.validateResourcePackPath('')).toThrow(
      ValidationError
    );
  });
});

describe('CompanionProfileDomainService 创建与激活', () => {
  it('创建后默认未激活', () => {
    expect(create().isActive).toBe(false);
  });

  it('激活 / 停用切换状态并更新时间戳', () => {
    const active = CompanionProfileDomainService.activate(create(), '2026-08-02T10:00:00Z');
    expect(active.isActive).toBe(true);
    const inactive = CompanionProfileDomainService.deactivate(active, '2026-08-02T11:00:00Z');
    expect(inactive.isActive).toBe(false);
  });
});

describe('CompanionProfileDomainService 场景语义', () => {
  it('每个场景都有默认状态', () => {
    expect(CompanionProfileDomainService.getDefaultStateForScene(CompanionScene.APP_ENTERED)).toBe(
      CompanionState.GREETING
    );
    expect(CompanionProfileDomainService.getDefaultStateForScene(CompanionScene.FOCUS_ACTIVE)).toBe(
      CompanionState.QUIET
    );
    expect(
      CompanionProfileDomainService.getDefaultStateForScene(CompanionScene.FOCUS_COMPLETED)
    ).toBe(CompanionState.CELEBRATING);
    expect(
      CompanionProfileDomainService.getDefaultStateForScene(CompanionScene.APP_EXITING)
    ).toBe(CompanionState.FAREWELL);
  });

  it('专注中只有 FOCUS_ACTIVE 允许出现', () => {
    expect(CompanionProfileDomainService.isAllowedInFocusMode(CompanionScene.FOCUS_ACTIVE)).toBe(
      true
    );
    expect(
      CompanionProfileDomainService.isAllowedInFocusMode(CompanionScene.FOCUS_COMPLETED)
    ).toBe(false);
  });

  it('idle 与 quiet 是低存在感状态', () => {
    expect(CompanionProfileDomainService.isLowPresence(CompanionState.IDLE)).toBe(true);
    expect(CompanionProfileDomainService.isLowPresence(CompanionState.QUIET)).toBe(true);
    expect(CompanionProfileDomainService.isLowPresence(CompanionState.CELEBRATING)).toBe(false);
  });
});

/**
 * FocusSession 领域规则单测
 * 时长上限、状态流转、有效时长计算。
 */
import { describe, expect, it } from 'vitest';
import { FocusSessionDomainService, FocusState } from '@domain/focus';
import { ValidationError } from '@shared-types/common';

const create = () =>
  FocusSessionDomainService.create(
    { plannedMinutes: 25 },
    'focus_1',
    '2026-08-02T09:00:00.000Z'
  );

describe('FocusSessionDomainService.validatePlannedMinutes', () => {
  it('拒绝非正与超 4 小时的计划时长', () => {
    expect(() => FocusSessionDomainService.validatePlannedMinutes(0)).toThrow(ValidationError);
    expect(() => FocusSessionDomainService.validatePlannedMinutes(241)).toThrow(ValidationError);
  });

  it('正常时长合法', () => {
    expect(() => FocusSessionDomainService.validatePlannedMinutes(25)).not.toThrow();
    expect(() => FocusSessionDomainService.validatePlannedMinutes(60)).not.toThrow();
  });
});

describe('FocusSessionDomainService 状态流转', () => {
  it('create 后是 active，暂停时长为 0', () => {
    const session = create();
    expect(session.state).toBe(FocusState.ACTIVE);
    expect(session.pausedDuration).toBe(0);
    expect(session.actualMinutes).toBeUndefined();
  });

  it('active 可以暂停 / 完成 / 中断', () => {
    expect(FocusSessionDomainService.canTransitionTo(FocusState.ACTIVE, FocusState.PAUSED)).toBe(true);
    expect(FocusSessionDomainService.canTransitionTo(FocusState.ACTIVE, FocusState.COMPLETED)).toBe(true);
    expect(FocusSessionDomainService.canTransitionTo(FocusState.ACTIVE, FocusState.ABORTED)).toBe(true);
  });

  it('completed / aborted 后不能再转换', () => {
    expect(FocusSessionDomainService.canTransitionTo(FocusState.COMPLETED, FocusState.ACTIVE)).toBe(false);
    expect(FocusSessionDomainService.canTransitionTo(FocusState.ABORTED, FocusState.ACTIVE)).toBe(false);
  });

  it('完成必须记录正的实际时长', () => {
    expect(() => FocusSessionDomainService.complete(create(), 0, '2026-08-02T09:25:00Z')).toThrow(
      ValidationError
    );
    const done = FocusSessionDomainService.complete(create(), 25, '2026-08-02T09:25:00Z');
    expect(done.state).toBe(FocusState.COMPLETED);
    expect(done.actualMinutes).toBe(25);
  });

  it('暂停后恢复会累计暂停时长', () => {
    const paused = FocusSessionDomainService.pause(create(), '2026-08-02T09:10:00Z');
    const resumed = FocusSessionDomainService.resume(paused, 5, '2026-08-02T09:15:00Z');
    expect(resumed.state).toBe(FocusState.ACTIVE);
    expect(resumed.pausedDuration).toBe(5);
  });
});

describe('FocusSessionDomainService 时长计算', () => {
  it('有效时长 = 实际时长 - 暂停时长', () => {
    const session = create();
    const done = FocusSessionDomainService.complete(
      { ...session, pausedDuration: 5 },
      30,
      '2026-08-02T09:30:00Z'
    );
    expect(FocusSessionDomainService.calculateEffectiveDuration(done)).toBe(25);
  });

  it('未完成时有效时长为 0', () => {
    expect(FocusSessionDomainService.calculateEffectiveDuration(create())).toBe(0);
  });

  it('达到计划时长才算完成目标', () => {
    const done = FocusSessionDomainService.complete(create(), 25, '2026-08-02T09:25:00Z');
    expect(FocusSessionDomainService.isPlannedDurationReached(done)).toBe(true);

    const short = FocusSessionDomainService.complete(create(), 10, '2026-08-02T09:10:00Z');
    expect(FocusSessionDomainService.isPlannedDurationReached(short)).toBe(false);
  });
});

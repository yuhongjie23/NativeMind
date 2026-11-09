import { describe, expect, it } from 'vitest';
import { createFocusElapsedSignal } from '../../../src/ui/hooks/focus-elapsed';

describe('focus elapsed reminders', () => {
  it('notifies exactly once when the running timer reaches zero', () => {
    const tick = createFocusElapsedSignal();
    expect([3, 2, 1, 0, 0, 0].map(tick)).toEqual([false, false, false, true, false, false]);
  });
  it('never notifies for an expired session restored at startup', () => {
    const tick = createFocusElapsedSignal();
    expect([0, 0, 0].map(tick)).toEqual([false, false, false]);
  });
  it('waits through a paused countdown', () => {
    const tick = createFocusElapsedSignal();
    expect([2, 2, 2, 1, 0].map(tick)).toEqual([false, false, false, false, true]);
  });
});

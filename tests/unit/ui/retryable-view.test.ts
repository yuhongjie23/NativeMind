// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryableView } from '@ui/components/common/RetryableView';
import { RetainedPanel } from '@ui/components/common/RetainedPanel';
import { EN } from '@ui/i18n/en';

vi.mock('@ui/i18n', () => ({ useT: () => (key: string) => EN[key] ?? key }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {}); // Expected injected render/load failures.
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retryable deferred views', () => {
  it('retries a rejected import without refreshing or remounting a sibling draft', async () => {
    const Ready = ({ label }: { label: string }) => createElement('p', null, label);
    let finish!: (module: { default: typeof Ready }) => void;
    const pending = new Promise<{ default: typeof Ready }>(resolve => { finish = resolve; });
    const load = vi.fn<() => Promise<{ default: typeof Ready }>>()
      .mockRejectedValueOnce(new Error('Synthetic unavailable module'))
      .mockReturnValueOnce(pending);
    const screen = (label: string) => createElement('div', null,
      createElement('input', { defaultValue: '', 'aria-label': 'Other draft' }),
      createElement(RetryableView<{ label: string }>, { load, viewProps: { label } }));

    await act(async () => root.render(screen('Ready')));
    expect(load).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('This view could not be opened');
    expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    const draft = host.querySelector('input')!;
    draft.value = 'Keep this unsaved draft';
    await act(async () => host.querySelector('button')!.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading…');
    expect(host.querySelector('button')).toBeNull();
    await act(async () => finish({ default: Ready }));
    expect(host.textContent).toBe('Ready');
    expect(host.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('Keep this unsaved draft');
    await act(async () => root.render(screen('Updated props')));
    expect(host.textContent).toBe('Updated props');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('leaves repeated failures recoverable and never retries automatically', async () => {
    const load = vi.fn<() => Promise<{ default: () => null }>>()
      .mockRejectedValue(new Error('Still unavailable'));
    await act(async () => root.render(createElement(RetryableView, { load, viewProps: {} })));
    expect(load).toHaveBeenCalledOnce();
    await act(async () => host.querySelector('button')!.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector('button')?.textContent).toBe('Try opening again');
    expect(host.querySelector('details')?.textContent).toContain('Still unavailable');
    expect(host.textContent).toContain('Unsaved input in this view may need to be entered again');
  });

  it('loads only on first visit and retains the mounted input across closing and reopening', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Editor() {
      useEffect(() => { mounted(); return unmounted; }, []);
      return createElement('input', { defaultValue: 'Initial draft' });
    }
    const load = vi.fn(async () => ({ default: Editor }));
    const screen = (active: boolean) => createElement(RetainedPanel, {
      active, children: createElement(RetryableView, { load, viewProps: {} }),
    });
    await act(async () => root.render(screen(false)));
    expect(load).not.toHaveBeenCalled();
    await act(async () => root.render(screen(true)));
    const draft = host.querySelector('input')!;
    draft.value = 'Edited draft';
    await act(async () => root.render(screen(false)));
    expect(host.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(unmounted).not.toHaveBeenCalled();
    await act(async () => root.render(screen(true)));
    expect(host.firstElementChild?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('Edited draft');
    expect(mounted).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
  });

  it('can recover a render failure locally as well as an import failure', async () => {
    let broken = true;
    function View() {
      if (broken) throw new Error('Synthetic render failure');
      return createElement('p', null, 'Recovered');
    }
    const load = vi.fn(async () => ({ default: View }));
    await act(async () => root.render(createElement(RetryableView, { load, viewProps: {} })));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    broken = false;
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toBe('Recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

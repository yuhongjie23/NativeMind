import { createElement, lazy } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RetainedPanel } from '@ui/components/common/RetainedPanel';

vi.mock('@ui/i18n', () => ({ useT: () => () => 'Loading…' }));

describe('deferred panel loading', () => {
  it('does not request code or mount contents before the first visit', () => {
    const load = vi.fn(() => new Promise<{ default: () => null }>(() => {}));
    const Panel = lazy(load);
    const html = renderToStaticMarkup(createElement(RetainedPanel, {
      active: false, children: createElement(Panel),
    }));
    expect(load).not.toHaveBeenCalled();
    expect(html).toBe('<div hidden=""></div>');
  });

  it('starts loading on the first visit and provides a localized status', () => {
    const load = vi.fn(() => new Promise<{ default: () => null }>(() => {}));
    const Panel = lazy(load);
    const html = renderToStaticMarkup(createElement(RetainedPanel, {
      active: true, children: createElement(Panel),
    }));
    expect(load).toHaveBeenCalledOnce();
    expect(html).toContain('<p role="status">Loading…</p>');
    expect(html).not.toContain('hidden=""');
  });
});

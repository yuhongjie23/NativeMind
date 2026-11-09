import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

async function portal(invoke = vi.fn().mockResolvedValue({ status: 'launch_requested' })) {
  let click: (() => Promise<void>) | undefined;
  const button = { disabled: false, addEventListener: (_event: string, handler: () => Promise<void>) => { click = handler; } };
  const status = { textContent: '' };
  const connect = vi.fn().mockResolvedValue({ tools: { invoke } });
  const source = await readFile('anna/desktop/ui/main.js', 'utf8');
  // Replace only the SDK import in the test context; execute the actual shipped handler.
  const sdkImport = "import('/static/anna-apps/_sdk/latest/index.js')";
  expect(source).toContain(sdkImport);
  runInNewContext(source.replace(sdkImport, 'getSdk()'), {
    document: { getElementById: (id: string) => id === 'open' ? button : status },
    getSdk: () => Promise.resolve({ AnnaAppRuntime: { connect } }),
  });
  return { button, status, invoke, connect, click: () => { if (!click) throw new Error('Missing handler'); return click(); } };
}

describe('Anna standalone desktop portal', () => {
  it('requires a click and sends only the launch tool ID and empty arguments', async () => {
    const page = await portal();
    expect(page.connect).not.toHaveBeenCalled();
    expect(page.invoke).not.toHaveBeenCalled();
    await page.click();
    expect(page.invoke).toHaveBeenCalledWith({
      tool_id: 'tool-forforever23-hongjie-yu-3qny9w3z', method: 'open_app', args: {},
    }, { timeoutMs: 30000 });
    expect(page.status.textContent).toContain('Confirm opening');
    expect(page.button.disabled).toBe(false);
  });
  it('does not reflect arbitrary host errors or pretend an invalid result means running', async () => {
    for (const invoke of [vi.fn().mockRejectedValue(new Error('PRIVATE_CONTEXT')), vi.fn().mockResolvedValue({ value: 'PRIVATE_CONTEXT' })]) {
      const page = await portal(invoke);
      await page.click();
      expect(page.status.textContent).toContain('Unable to request launch');
      expect(page.status.textContent).not.toContain('PRIVATE_CONTEXT');
      expect(page.button.disabled).toBe(false);
    }
  });
});

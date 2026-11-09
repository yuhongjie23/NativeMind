import { beforeEach, describe, expect, it, vi } from 'vitest';
const list = vi.hoisted(() => vi.fn());
vi.mock('../../../src/infrastructure/paths/paths-api', () => ({ listInstalledModels: list }));
import { modelInstallationStatus, useModelReadinessStore } from '../../../src/ui/stores/model-readiness-store';

describe('model installation diagnostics', () => {
  beforeEach(() => { list.mockReset(); useModelReadinessStore.setState({ inventory: { state: 'idle' } }); });
  it('distinguishes a failed connection from an empty list and recovers', async () => {
    list.mockRejectedValueOnce(new Error('service unavailable'));
    await useModelReadinessStore.getState().refresh();
    let inventory = useModelReadinessStore.getState().inventory;
    expect(inventory).toEqual({ state: 'error', message: 'service unavailable' });
    expect(modelInstallationStatus(inventory, 'qwen3:14b')).toBe('error');
    list.mockResolvedValueOnce([]);
    await useModelReadinessStore.getState().refresh();
    inventory = useModelReadinessStore.getState().inventory;
    expect(inventory).toEqual({ state: 'ready', models: [] });
    expect(modelInstallationStatus(inventory, 'qwen3:14b')).toBe('missing');
  });
  it('uses the current selection, including embedding latest aliases', async () => {
    list.mockResolvedValueOnce([{ name: 'qwen3:14b' }, { name: 'nomic-embed-text:latest' }]);
    await useModelReadinessStore.getState().refresh();
    const inventory = useModelReadinessStore.getState().inventory;
    expect(modelInstallationStatus(inventory, 'qwen3:14b')).toBe('ok');
    expect(modelInstallationStatus(inventory, 'qwen3:4b')).toBe('missing');
    expect(modelInstallationStatus(inventory, 'nomic-embed-text')).toBe('ok');
    expect(modelInstallationStatus(inventory, '')).toBe('missing');
  });
  it('does not equate different quantization tags', () => {
    const inventory = { state: 'ready' as const, models: [{ name: 'qwen3:14b-q4_K_M' }] };
    expect(modelInstallationStatus(inventory, 'qwen3:14b')).toBe('missing');
    expect(modelInstallationStatus(inventory, 'qwen3:14b-q4_K_M')).toBe('ok');
  });
  it('ignores late responses from an older check', async () => {
    useModelReadinessStore.setState({ inventory: { state: 'ready', models: [{ name: 'qwen3:14b' }] } });
    let resolveOld: (value: { name: string }[]) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const old = useModelReadinessStore.getState().refresh();
    expect(useModelReadinessStore.getState().inventory).toEqual({ state: 'checking', models: [{ name: 'qwen3:14b' }] });
    expect(modelInstallationStatus(useModelReadinessStore.getState().inventory, 'qwen3:14b')).toBe('checking');
    list.mockRejectedValueOnce(new Error('new failure'));
    await useModelReadinessStore.getState().refresh();
    resolveOld([{ name: 'qwen3:14b' }]);
    await old;
    expect(useModelReadinessStore.getState().inventory).toEqual({ state: 'error', message: 'new failure' });
  });
});

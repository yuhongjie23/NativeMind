import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ storage: vi.fn(), start: vi.fn(), list: vi.fn(), supported: vi.fn() }));
vi.mock('@infrastructure/startup-check', () => ({ checkStorage: mocks.storage, supportsStartupCheck: mocks.supported }));
vi.mock('@infrastructure/paths/paths-api', () => ({ ensureOllamaRunning: mocks.start, listInstalledModels: mocks.list }));
import { useStartupCheckStore } from '@ui/stores/startup-check-store';
import { useModelReadinessStore, modelInstallationStatus } from '@ui/stores/model-readiness-store';

describe('startup checks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.supported.mockReturnValue(true);
    mocks.storage.mockResolvedValue({ path: 'C:/test', writable: true });
    mocks.start.mockResolvedValue('already_running');
    mocks.list.mockResolvedValue([{ name: 'qwen3:14b' }, { name: 'nomic-embed-text:latest' }]);
    useStartupCheckStore.setState({ phase: 'idle', storage: { state: 'idle' }, dismissed: false });
    useModelReadinessStore.setState({ inventory: { state: 'idle' } });
  });
  it('waits for startup before inspecting models, deduplicating simultaneous checks', async () => {
    let finish!: (value: string) => void;
    mocks.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = useStartupCheckStore.getState().check(true);
    const second = useStartupCheckStore.getState().check();
    expect(first).toBe(second);
    expect(mocks.list).not.toHaveBeenCalled();
    finish('started'); await first;
    expect(mocks.storage).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(useStartupCheckStore.getState()).toMatchObject({ phase: 'done', startingService: false, storage: { state: 'done', result: { writable: true } } });
    expect(modelInstallationStatus(useModelReadinessStore.getState().inventory, 'qwen3:14b')).toBe('ok');
  });
  it('distinguishes an offline service from missing models and recovers on retry without starting again', async () => {
    mocks.start.mockRejectedValueOnce(new Error('not installed'));
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    mocks.storage.mockResolvedValueOnce({ path: 'C:/full', writable: false, reason: 'disk full' });
    await useStartupCheckStore.getState().check(true);
    expect(useStartupCheckStore.getState()).toMatchObject({ phase: 'done', startFailed: true, storage: { result: { writable: false } } });
    expect(modelInstallationStatus(useModelReadinessStore.getState().inventory, 'qwen3:14b')).toBe('error');
    mocks.list.mockResolvedValueOnce([]);
    await useStartupCheckStore.getState().check();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(modelInstallationStatus(useModelReadinessStore.getState().inventory, 'qwen3:14b')).toBe('missing');
    expect(useStartupCheckStore.getState()).toMatchObject({ phase: 'done', storage: { result: { writable: true } } });
  });
  it('retains a storage-check failure while still inspecting models', async () => {
    mocks.storage.mockRejectedValueOnce(new Error('bridge unavailable'));
    await useStartupCheckStore.getState().check();
    expect(useStartupCheckStore.getState()).toMatchObject({ phase: 'done', storage: { state: 'error', message: 'Error: bridge unavailable' } });
    expect(useModelReadinessStore.getState().inventory.state).toBe('ready');
  });
  it('does not access native services in the browser demo', async () => {
    mocks.supported.mockReturnValue(false);
    await useStartupCheckStore.getState().check(true);
    expect(useStartupCheckStore.getState().phase).toBe('unsupported');
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

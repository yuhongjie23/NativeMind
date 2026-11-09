import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertLocalAnnaEnvironment, assertLocalAnnaOrigin } from '@infrastructure/anna/local-policy';
import { DeepSeekProvider } from '@infrastructure/model-runtime/deepseek-provider';

afterEach(() => vi.unstubAllGlobals());

describe('Anna local-only deployment', () => {
  it.each(['http://localhost:5180', 'http://127.0.0.1:5180', 'http://[::1]:5180'])('accepts local harness %s', (origin) => {
    expect(() => assertLocalAnnaOrigin(origin)).not.toThrow();
  });
  it.each(['https://anna.partners', 'https://localhost.evil.example', 'file:///private', 'null', 'https://user@localhost', 'http://192.168.1.2'])('rejects nonlocal origin %s', (origin) => {
    expect(() => assertLocalAnnaOrigin(origin)).toThrow();
  });
  it('checks the embedding host as well as the app origin', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5180' }, top: { location: { origin: 'https://anna.partners' } } });
    expect(() => assertLocalAnnaEnvironment()).toThrow();
  });
  it('fails closed if the top frame origin cannot be read', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5180' }, top: { get location() { throw new Error('Cross-origin access'); } } });
    expect(() => assertLocalAnnaEnvironment()).toThrow('Cross-origin');
  });
  it('accepts the same-origin local development frame', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5180' }, top: { location: { origin: 'http://localhost:5180' } } });
    expect(() => assertLocalAnnaEnvironment()).not.toThrow();
  });
});

describe('local-only model policy', () => {
  it('blocks cloud calls even when saved settings contain a key or configure runs again', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new DeepSeekProvider({ allowRemote: false, apiKey: 'test-key', fetchImpl });
    provider.configure({ apiKey: 'replacement-key', thinking: true });
    expect(provider.getApiKey()).toBeUndefined();
    expect(await provider.isReady()).toBe(false);
    expect(await provider.isAvailable('deepseek-v4-flash')).toBe(false);
    expect(await provider.listModels()).toEqual([]);
    for (const onToken of [undefined, vi.fn()]) {
      await expect(provider.complete({ model: 'deepseek-v4-flash', prompt: 'private notes', onToken })).rejects.toThrow('本地模型');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('preserves explicitly configured cloud support in the desktop runtime', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'reply' } }] })));
    const provider = new DeepSeekProvider({ apiKey: 'desktop-key', fetchImpl });
    expect(await provider.isAvailable('deepseek-v4-flash')).toBe(true);
    expect(await provider.complete({ model: 'deepseek-v4-flash', prompt: 'hello' })).toBe('reply');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

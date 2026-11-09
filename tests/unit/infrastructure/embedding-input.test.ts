import { describe, expect, it, vi } from 'vitest';
import { TauriModelProvider } from '@infrastructure/model-runtime/tauri-model-provider';
import { embeddingInput, embeddingVersion } from '@infrastructure/model-runtime/embedding-input';
describe('Nomic retrieval task prefixes', () => {
  it('prefixes only the Nomic text model and versions the strategy', () => {
    expect(embeddingInput('nomic-embed-text:latest', '正文', 'document')).toBe('search_document: 正文');
    expect(embeddingInput('nomic-embed-text', '问题', 'query')).toBe('search_query: 问题');
    expect(embeddingInput('another-model', '正文', 'document')).toBe('正文');
    expect(embeddingVersion('nomic-embed-text', 'old')).not.toBe('old');
  });
  it('sends separate document/query inputs through the actual native provider', async () => {
    const invoke = vi.fn().mockResolvedValue([[1]]);
    const provider = new TauriModelProvider(invoke);
    await provider.embed(['正文']);
    await provider.embed(['问题'], undefined, 'query');
    expect(invoke.mock.calls[0][1].texts).toEqual(['search_document: 正文']);
    expect(invoke.mock.calls[1][1].texts).toEqual(['search_query: 问题']);
    expect(provider.version).toContain('search-prefix-v1');
  });
});

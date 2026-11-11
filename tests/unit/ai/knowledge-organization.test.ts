import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAILayer } from '@ai/index';
import { getModelConfig, setModelConfig } from '@ai/router/model-config';
import type { ModelCompletionRequest } from '@ai/types';
import type { GenerationOptions } from '@application/ports';

describe('DeepSeek-only knowledge organization', () => {
  const original = { ...getModelConfig() };
  const text = 'A learning note about binary search boundaries and sorted arrays.';
  beforeEach(() => setModelConfig({
    providerMode: 'local', apiKey: 'test-only-key', knowledgeOrganizationEnabled: true,
  }));
  afterEach(() => setModelConfig(original));

  function setup(localOnly = false) {
    const local = { isAvailable: vi.fn(async () => true), complete: vi.fn(async () => 'local') };
    const cloud = {
      isAvailable: vi.fn(async () => true),
      complete: vi.fn(async (request: ModelCompletionRequest) => request.prompt.includes('新笔记内容：')
        ? '{"tags":["algorithm"],"topics":["binary search"]}'
        : JSON.stringify([{ toId: 'chunk-1', relationType: 'same_concept', reason: 'Both describe binary search.', confidence: 0.9 }])),
    };
    const listCandidates = vi.fn(async () => []);
    const layer = createAILayer({
      modelProvider: local, deepseekProvider: cloud, localOnly,
      embeddingProvider: { version: 'test', embed: async (texts) => texts.map(() => [1]) },
      vectorStore: { query: async () => [] },
      candidateProvider: { listCandidates, listFallback: async () => [{
        chunkId: 'chunk-1', noteId: 'old-note', text: 'Binary search requires sorted input.', title: 'Binary search', tags: [],
      }] },
    });
    return { local, cloud, listCandidates, suggest: () => layer.ports.suggestionPort.suggestForNote(text, ['new-note']),
      topic: (options?: GenerationOptions) => layer.ports.topicOrganization.draft([], 'en', options),
      standard: (options?: GenerationOptions) => layer.ports.noteStandardization.draft(text, 'en', options),
      title: (options?: GenerationOptions) => layer.ports.noteTitle.draft(text, 'en', options),
      card: (options?: GenerationOptions) => layer.ports.noteOrganization.draft(text, 'en', options) };
  }

  it.each([
    { label: 'no key', key: undefined, enabled: true, localOnly: false, error: 'API Key' },
    { label: 'blank key', key: '  ', enabled: true, localOnly: false, error: 'API Key' },
    { label: 'not opted in', key: 'test-key', enabled: false, localOnly: false, error: '未开启' },
    { label: 'Anna local edition', key: 'test-key', enabled: true, localOnly: true, error: '纯本地' },
  ])('blocks $label before reading candidates or contacting a model', async ({ key, enabled, localOnly, error }) => {
    setModelConfig({ apiKey: key, knowledgeOrganizationEnabled: enabled });
    const deps = setup(localOnly);
    await expect(deps.suggest()).rejects.toThrow(error);
    await expect(deps.topic()).rejects.toThrow(error);
    await expect(deps.standard()).rejects.toThrow(error);
    expect(deps.listCandidates).not.toHaveBeenCalled();
    expect(deps.cloud.complete).not.toHaveBeenCalled();
    expect(deps.local.isAvailable).not.toHaveBeenCalled();
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('uses DeepSeek for both query tags and relation judging even when other tasks use local models', async () => {
    const deps = setup();
    expect(await deps.suggest()).toMatchObject([{ toId: 'old-note', relationType: 'same_concept' }]);
    expect(deps.cloud.complete).toHaveBeenCalledTimes(2);
    expect(deps.cloud.complete.mock.calls.every(([request]) => request.model === getModelConfig().deepseekModel)).toBe(true);
    expect(deps.local.isAvailable).not.toHaveBeenCalled();
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('topic composition uses only the dedicated DeepSeek router', async () => {
    const deps = setup();
    deps.cloud.complete.mockResolvedValue('{"title":"No supported group","groups":[]}');
    expect((await deps.topic()).groups).toEqual([]);
    expect(deps.cloud.complete.mock.calls[0][0].model).toBe(getModelConfig().deepseekModel);
    expect(deps.local.isAvailable).not.toHaveBeenCalled();
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('standardization sends the complete supplied note only to DeepSeek and asks to preserve details', async () => {
    const deps = setup();
    deps.cloud.complete.mockResolvedValue(JSON.stringify({ status: 'ready', title: 'Binary search',
      blocks: [{ kind: 'overview', text: 'Boundary rules matter.', quote: text }] }));
    expect((await deps.standard()).status).toBe('ready');
    const request = deps.cloud.complete.mock.calls[0][0];
    expect(request.model).toBe(getModelConfig().deepseekModel);
    expect(request.prompt).toContain(text);
    expect(request.system).toContain('Preserve substantive facts');
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('reports cloud failure instead of inventing fallback relationships or using local models', async () => {
    const deps = setup();
    deps.cloud.complete.mockRejectedValue(new Error('401 invalid test key'));
    await expect(deps.suggest()).rejects.toThrow('DeepSeek 知识整理失败');
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('blocks unavailable DeepSeek even if a local model is available', async () => {
    const deps = setup();
    deps.cloud.isAvailable.mockResolvedValue(false);
    await expect(deps.suggest()).rejects.toThrow('DeepSeek 不可用');
    expect(deps.cloud.complete).not.toHaveBeenCalled();
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it('does not return a late proposal after the user disables organization', async () => {
    const deps = setup();
    const generate = deps.cloud.complete.getMockImplementation()!;
    deps.cloud.complete.mockImplementation(async request => {
      const response = await generate(request);
      if (!request.prompt.includes('新笔记内容：')) setModelConfig({ knowledgeOrganizationEnabled: false });
      return response;
    });
    await expect(deps.suggest()).rejects.toThrow('未开启');
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it.each(['card', 'topic', 'title', 'standard'] as const)('does not send %s text when consent is revoked during the final availability check', async kind => {
    const deps = setup();
    let checks = 0;
    deps.cloud.isAvailable.mockImplementation(async () => {
      // Adapter access, router availability, then the last check before transmission.
      if (++checks === 3) setModelConfig({ knowledgeOrganizationEnabled: false });
      return true;
    });
    await expect(deps[kind]()).rejects.toThrow();
    expect(deps.cloud.complete).not.toHaveBeenCalled();
    expect(deps.local.complete).not.toHaveBeenCalled();
  });

  it.each(['card', 'topic', 'title', 'standard'] as const)('does not send %s text when the key is removed during the final availability check', async kind => {
    const deps = setup();
    let checks = 0;
    deps.cloud.isAvailable.mockImplementation(async () => {
      if (++checks === 3) setModelConfig({ apiKey: undefined });
      return true;
    });
    await expect(deps[kind]()).rejects.toThrow();
    expect(deps.cloud.complete).not.toHaveBeenCalled();
  });

  it.each(['card', 'topic', 'title', 'standard'] as const)('does not transmit cancelled %s text after a pending availability check', async kind => {
    const deps = setup();
    const controller = new AbortController();
    let checks = 0;
    deps.cloud.isAvailable.mockImplementation(async () => {
      if (++checks === 3) controller.abort();
      return true;
    });
    await expect(deps[kind]({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.cloud.complete).not.toHaveBeenCalled();
  });
});

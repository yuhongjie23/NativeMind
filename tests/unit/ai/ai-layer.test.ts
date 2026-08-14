/**
 * createAILayer 双 provider 兜底路由测试
 *
 * 覆盖用户要求的场景：
 * 1. 本地小模型不可用 + 配了 DeepSeek → fast 兜底走 DeepSeek（不再整条挂掉）
 * 2. providerMode=local（用户切回本地）→ coach 也走本地
 * 3. DeepSeek 不可用（无 key）→ 全部走本地
 *
 * 不真连模型：fake provider 记录调用，验证路由选择。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAILayer, type AILayerDeps } from '@ai/index';
import { setModelConfig } from '@ai/router/model-config';
import type { ModelProvider, VectorStorePort, EmbeddingProvider } from '@ai/types';
import type { CandidateProvider } from '@ai/rag/rag-orchestrator';

/** 可编程 provider：记录调用，可按需「不可用」 */
const fakeProvider = (name: string, options: { available?: boolean; respond?: string } = {}) => {
  const calls: string[] = [];
  return {
    name,
    calls,
    isAvailable: async () => options.available ?? true,
    complete: async ({ model }: { model: string }) => {
      calls.push(model);
      return options.respond ?? `${name}:${model}`;
    },
  };
};

const fakeEmbedding: EmbeddingProvider = { version: 'test', embed: async (texts) => texts.map(() => [0.1]) };
const fakeVector: VectorStorePort = { query: async () => [] };
const fakeCandidate: CandidateProvider = { listCandidates: async () => [] };

/** 构造最小 AILayer deps */
const makeDeps = (local: ModelProvider, deepseek?: ModelProvider): AILayerDeps => ({
  modelProvider: local,
  deepseekProvider: deepseek,
  embeddingProvider: fakeEmbedding,
  vectorStore: fakeVector,
  candidateProvider: fakeCandidate,
});

describe('createAILayer 双 provider 兜底路由', () => {
  beforeEach(() => {
    setModelConfig({ providerMode: 'local', apiKey: undefined, deepseekModel: 'deepseek-v4-flash' });
  });

  it('本地不可用 + 配 DeepSeek → fast 任务兜底走 DeepSeek', async () => {
    const local = fakeProvider('local', { available: false });
    const cloud = fakeProvider('deepseek', { available: true, respond: 'cloud' });
    const layer = createAILayer(makeDeps(local, cloud));
    setModelConfig({ providerMode: 'deepseek', apiKey: 'sk-test' });

    // query_rewrite 是 fast 档自由文本任务（无 JSON 校验，fake provider 文本响应合法）
    const result = await layer.router.run({ taskType: 'query_rewrite', input: { query: 'x' } });

    expect(cloud.calls.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });

  it('providerMode=local（用户切回本地）→ coach 也走本地，不用 DeepSeek', async () => {
    const local = fakeProvider('local', { available: true, respond: 'local' });
    const cloud = fakeProvider('deepseek', { available: true, respond: 'cloud' });
    const layer = createAILayer(makeDeps(local, cloud));
    setModelConfig({ providerMode: 'local' }); // 切回本地

    // socratic 是 coach 档
    await layer.router.run({ taskType: 'socratic_question', input: {} });

    expect(cloud.calls).toHaveLength(0); // 教练档不用 DeepSeek
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it('DeepSeek 无 key（不可用）→ 全部走本地', async () => {
    const local = fakeProvider('local', { available: true, respond: 'local' });
    const cloud = fakeProvider('deepseek', { available: false });
    const layer = createAILayer(makeDeps(local, cloud));
    setModelConfig({ providerMode: 'deepseek', apiKey: undefined }); // key 未配 → isAvailable false

    await layer.router.run({ taskType: 'socratic_question', input: {} }); // coach
    await layer.router.run({ taskType: 'intent', input: { userInput: 'x' } }); // fast

    expect(cloud.calls).toHaveLength(0);
    expect(local.calls.length).toBeGreaterThan(0);
  });

  it('本地可用 + DeepSeek 可用 → fast 优先本地，coach 走 DeepSeek', async () => {
    const local = fakeProvider('local', { available: true, respond: 'local' });
    const cloud = fakeProvider('deepseek', { available: true, respond: 'cloud' });
    const layer = createAILayer(makeDeps(local, cloud));
    setModelConfig({ providerMode: 'deepseek', apiKey: 'sk-test' });

    await layer.router.run({ taskType: 'intent', input: { userInput: 'x' } }); // fast → 本地
    await layer.router.run({ taskType: 'socratic_question', input: {} }); // coach → DeepSeek

    expect(local.calls.length).toBeGreaterThan(0);
    expect(cloud.calls.length).toBeGreaterThan(0);
  });

  it('完全没配 DeepSeek → 全部走本地（现状保持）', async () => {
    const local = fakeProvider('local', { available: true, respond: 'local' });
    const layer = createAILayer(makeDeps(local, undefined));
    setModelConfig({ providerMode: 'local' });

    await layer.router.run({ taskType: 'socratic_question', input: {} });
    await layer.router.run({ taskType: 'intent', input: { userInput: 'x' } });

    expect(local.calls.length).toBeGreaterThan(0);
  });

  it('不触发真实网络：fake provider 全程替换', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const local = fakeProvider('local', { available: true });
    createAILayer(makeDeps(local, undefined));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

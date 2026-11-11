import { describe, expect, it, vi } from 'vitest';
import { DeepQAAdapter } from '@ai/adapters';
import { SelfRag } from '@ai/rag/self-rag';
import type { ModelRouter } from '@ai/router/model-router';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';

const quote = 'L7试验的提取温度必须为43摄氏度。';
const enClaim = 'The L7 extraction temperature must be 43 degrees Celsius.';
const zhClaim = 'L7试验的提取温度为43摄氏度。';
const source = { chunkId: 'c1', noteId: 'n1', text: `记录：${quote}`, charStart: 100, score: 0.9, matchedBy: ['rule'] };
const validCritic = () => ({ relevance: 1, grounded: true, hallucination_risk: false,
  quality: 9, critique: '', evidence: [{ source: 1, from: 1, to: 1, claim: 1 }] });

function setup(mode: 'success' | 'missing' | 'critic-failure' | 'generation-failure' | 'refine' = 'success') {
  let criticCalls = 0;
  const run = vi.fn(async (request: { schemaOverride?: string; taskType: string; inlinePrompt: { system: string; user: string } }) => {
    if (request.schemaOverride === 'qa-evidence-check.v1') return { ok: true, output: { supported: [true] } };
    if (request.schemaOverride === 'qa-evidence-check.v2') return { ok: true, output: { missing: '', verdict: 'supported' } };
    const en = request.inlinePrompt.system.includes('You are');
    const claim = en ? enClaim : zhClaim;
    if (request.taskType === 'deep_qa_generate') return { ok: mode !== 'generation-failure', output: claim };
    criticCalls++;
    if (mode === 'critic-failure') return { ok: false };
    if (mode === 'missing') return { ok: true, output: { ...validCritic(), evidence: [] } };
    if (mode === 'refine' && criticCalls === 1) return { ok: true, output: {
      ...validCritic(), grounded: false, critique: 'State the extraction temperature clearly.',
    } };
    return { ok: true, output: validCritic() };
  });
  const qa = new SelfRag({ run } as unknown as ModelRouter,
    { retrieve: async () => [source] } as unknown as RAGOrchestrator);
  return { qa, run };
}

describe('knowledge QA language follows settings without translating evidence', () => {
  it('uses English generation/review instructions even for a Chinese question and source', async () => {
    const { qa, run } = setup();
    const result = await qa.ask('提取温度是多少？', { language: 'en' });
    expect(result.answer).toBe(`${enClaim} [1]`);
    expect(result.citations[0].text).toBe(source.text);
    expect(result.citations[0].charStart).toBe(100);
    expect(run.mock.calls[0][0].inlinePrompt.system).toContain('Answer accurately and clearly in English');
    expect(run.mock.calls[1][0].inlinePrompt.system).toContain('critique in English');
    expect(run.mock.calls[1][0].inlinePrompt.system).toContain('Do not quote, translate or rewrite');
  });
  it('keeps Chinese as the backwards-compatible default', async () => {
    expect((await setup().qa.ask('温度？')).answer).toBe(`${zhClaim} [1]`);
  });
  it.each(['missing', 'critic-failure'] as const)('localizes the %s outcome', async mode => {
    const result = await setup(mode).qa.ask('temperature?', { language: 'en' });
    expect(result.citations).toEqual([]);
    expect(result.answer).toContain(mode === 'missing' ? 'Insufficient evidence' : 'Evidence verification could not be completed');
    expect(result.answer).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it('preserves the original source fallback if generation is unavailable', async () => {
    const result = await setup('generation-failure').qa.ask('temperature?', { language: 'en' });
    expect(result.ok).toBe(false);
    expect(result.judged).toBe(false);
    expect(result.answer).toBe(source.text);
  });
  it('keeps English during refinement and preserves reset events', async () => {
    const { qa, run } = setup('refine');
    const onToken = vi.fn();
    const result = await qa.ask('温度？', { language: 'en', onToken });
    expect(result.regenerated).toBe(true);
    expect(result.answer).toBe(`${enClaim} [1]`);
    expect(run.mock.calls).toHaveLength(6);
    expect(run.mock.calls[2][0].inlinePrompt.user).toContain('Previous review: State the extraction temperature clearly.');
    expect(run.mock.calls.filter(([request]) => !request.schemaOverride?.startsWith('qa-evidence-check.'))
      .every(([request]) => request.inlinePrompt.system.includes('English'))).toBe(true);
    expect(onToken).toHaveBeenCalledWith('', true);
  });
  it('reads settings on every question, but snapshots the language for the whole request', async () => {
    const { qa, run } = setup('refine');
    let language: 'zh' | 'en' = 'en';
    const readLanguage = vi.fn(async () => language);
    const adapter = new DeepQAAdapter(qa, readLanguage);
    const pending = adapter.ask({ question: '温度？' });
    language = 'zh';
    expect((await pending).answer).toBe(`${enClaim} [1]`);
    expect(readLanguage).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.filter(([request]) => !request.schemaOverride?.startsWith('qa-evidence-check.'))
      .every(([request]) => request.inlinePrompt.system.includes('English'))).toBe(true);
    expect((await adapter.ask({ question: '温度？' })).answer).toBe(`${zhClaim} [1]`);
    expect(readLanguage).toHaveBeenCalledTimes(2);
  });
  it('does not start retrieval/model calls when cancelled while settings are being read', async () => {
    const { qa, run } = setup();
    const controller = new AbortController();
    const adapter = new DeepQAAdapter(qa, async () => { controller.abort(); return 'en'; });
    await expect(adapter.ask({ question: 'temperature?', signal: controller.signal })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});

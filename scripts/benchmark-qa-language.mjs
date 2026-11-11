// Opt-in: real local Qwen QA, synthetic fixed passages; never reads user notes.
// node scripts/benchmark-qa-language.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const previous = JSON.parse(await readFile('docs/benchmarks/qa-evidence-window-2026-11-10.json', 'utf8'));
const baselineSource = previous.currentSource;
assert(baselineSource.includes('selectSourceExcerpt'), 'Baseline must include the preceding evidence-window fix');
const directory = await mkdtemp(join(tmpdir(), 'nativemind-qa-language-'));
await writeFile(join(directory, 'baseline.ts'), baselineSource
  .replaceAll("'../shared/", "'/src/ai/shared/")
  .replaceAll("'./rerank-excerpt'", "'/src/ai/rag/rerank-excerpt'"));
const zhSource = 'L7试验规定提取温度为43摄氏度，超过该温度会降低回收率。';
const cases = [
  { name: 'en-with-chinese-question-and-source', language: 'en', question: 'L7试验的提取温度是多少？仅用一句话回答。', text: zhSource, expected: '43' },
  { name: 'en-with-english-source', language: 'en', question: 'How long must B62 samples cool before sealing? Answer in one sentence.', text: 'B62 samples must cool for 17 minutes before being sealed in a container.', expected: '17' },
  { name: 'en-missing-answer', language: 'en', question: 'Who was in charge of the L7 experiment? Answer in one sentence.', text: zhSource, expected: null },
  { name: 'zh-control', language: 'zh', question: 'L7试验的提取温度是多少？仅用一句话回答。', text: zhSource, expected: '43' },
];
const report = { createdAt: new Date().toISOString(), model: 'qwen3:14b', baselineSource,
  currentSource: await readFile('src/ai/rag/self-rag.ts', 'utf8'), cases, runs: [],
  limitations: 'One run per case per arm, warmed local model, synthetic fixed retrieval. Checks language, expected fact, exact quotes and offsets. Does not measure PDF/EPUB retrieval, UI, or general reliability; Chinese-character check applies only to these simple answer fixtures, not all real answers with proper names.' };
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { SelfRag: Baseline } = await vite.ssrLoadModule(join(directory, 'baseline.ts'));
  const { SelfRag: Current } = await vite.ssrLoadModule('/src/ai/rag/self-rag.ts');
  const { ModelRouter } = await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const { OllamaProvider } = await vite.ssrLoadModule('/src/infrastructure/model-runtime/ollama-provider.ts');
  const provider = new OllamaProvider({ timeoutMs: 90000 });
  assert(await provider.isAvailable(report.model), 'Local qwen3:14b is required');
  console.log('Warming local Qwen3:14b; no database access.');
  await provider.complete({ model: report.model, prompt: 'Reply OK.', maxTokens: 8, temperature: 0, signal: AbortSignal.timeout(90000) });
  for (const [index, example] of cases.entries()) for (const arm of index % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
    let calls = 0;
    const router = new ModelRouter({ isAvailable: model => provider.isAvailable(model), complete: request => {
      calls++; return provider.complete(request);
    } }, { resolveModel: () => report.model });
    const source = { chunkId: 'c1', noteId: 'synthetic', text: example.text, charStart: 100, score: 0.9, matchedBy: ['rule'] };
    const qa = new (arm === 'baseline' ? Baseline : Current)(router, { retrieve: async () => [source] });
    const start = performance.now();
    const result = await qa.ask(example.question, { language: example.language, deep: false, signal: AbortSignal.timeout(180000) });
    const offsetsValid = result.citations.every(c => example.text.slice(c.charStart - 100, c.charStart - 100 + c.text.length) === c.text);
    const languageValid = example.language === 'en' ? !/[\u4e00-\u9fff]/u.test(result.answer) && /[a-z]{3}/i.test(result.answer) : /[\u4e00-\u9fff]/u.test(result.answer);
    const contentValid = example.expected === null
      ? result.citations.length === 0 && result.answer.includes(example.language === 'en' ? 'Insufficient evidence' : '资料不足')
      : result.answer.includes(example.expected) && result.citations.some(c => c.text.includes(example.expected));
    const run = { case: example.name, arm, ms: Math.round(performance.now() - start), calls,
      pass: result.ok && result.judged && offsetsValid && languageValid && contentValid, offsetsValid, languageValid, contentValid, ...result };
    report.runs.push(run);
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ case: run.case, arm, pass: run.pass, ms: run.ms, answer: run.answer, citations: run.citations }));
  }
  console.log(`Report: ${join(directory, 'report.json')}`);
  if (report.runs.some(run => run.arm === 'current' && !run.pass)) process.exitCode = 1;
} finally { await vite.close(); }

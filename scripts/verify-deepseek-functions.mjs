// Opt-in paid API acceptance. Synthetic inputs only; never reads App settings or user data.
// Supply the key through stdin (not a command argument). No key is saved in the report.
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

if (process.stdin.isTTY) throw new Error('Use a non-echoing stdin pipe for the API key.');
console.log('Waiting for API key on stdin; it will not be logged or saved.');
const input = createInterface({ input: process.stdin, terminal: false });
let key = await new Promise((resolve, reject) => {
  input.once('line', line => resolve(line.trim()));
  input.once('close', () => reject(new Error('API key not received')));
});
input.close();
process.stdin.pause();
if (!key) throw new Error('API key not received');

const directory = await mkdtemp(join(tmpdir(), 'nativemind-deepseek-check-'));
const qaOnly = process.argv.includes('--qa-only');
const boundaries = process.argv.includes('--learning-boundaries');
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
const report = { passed: false, syntheticOnly: true, scope: boundaries ? 'learning-boundaries' : qaOnly ? 'qa-only' : 'all', selectedCase, cases: [], requests: [], routes: [] };
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let runtime;
const safeError = error => String(error).split(key).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]');
let calls = 0;
try {
  const models = await fetch('https://api.deepseek.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  report.modelsHttpStatus = models.status;
  if (!models.ok) throw new Error(`DeepSeek models HTTP ${models.status}`);
  report.availableModels = (await models.json()).data.map(item => item.id);
  report.model = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat'].find(name => report.availableModels.includes(name));
  if (!report.model) throw new Error('No supported Flash/chat model returned by official API');
  console.log(`Authenticated. Model: ${report.model}`);
  const { DeepSeekProvider } = await vite.ssrLoadModule('/src/infrastructure/model-runtime/deepseek-provider.ts');
  const { ModelRouter } = await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const { TodoStructuringAdapter, ReviewGeneratorAdapter } = await vite.ssrLoadModule('/src/ai/adapters.ts');
  const { InteractionGenerator } = await vite.ssrLoadModule('/src/ai/companion/interaction-generator.ts');
  const { SelfRag, defaultSelfRagOptions } = await vite.ssrLoadModule('/src/ai/rag/self-rag.ts');
  runtime = new DeepSeekProvider({ apiKey: key, model: report.model, thinking: false, timeoutMs: 45000,
    fetchImpl: async (url, init) => {
      if (++calls > 12) throw new Error('Acceptance limit: at most 12 generation requests');
      const started = performance.now();
      const entry = { number: calls };
      report.requests.push(entry);
      try {
        const response = await fetch(url, { ...init, redirect: 'error' });
        entry.httpStatus = response.status;
        if (!JSON.parse(init.body).stream) {
          const data = await response.clone().json();
          entry.usage = data.usage;
          entry.finishReason = data.choices?.[0]?.finish_reason;
        }
        entry.ms = Math.round(performance.now() - started);
        return response;
      } catch (error) { entry.ms = Math.round(performance.now() - started); entry.error = safeError(error); throw error; }
    },
  });
  const provider = {
    isAvailable: model => runtime.isAvailable(model),
    complete: request => runtime.complete({ ...request, maxTokens: Math.min(request.maxTokens ?? 1400, 1400) }),
  };
  const realRouter = new ModelRouter(provider, { resolveModel: () => report.model });
  // One attempt per stage, so malformed results remain visible and costs stay bounded.
  const router = { run: async request => {
    const result = await realRouter.run({ ...request, modelPolicy: { ...request.modelPolicy, noRetry: true, noFallback: true } });
    report.routes.push({ task: request.taskType, ok: result.ok, error: result.error });
    return result;
  } };
  const run = async (name, action, check) => {
    if (selectedCase && name !== selectedCase) return;
    if (boundaries && !name.startsWith('boundary-')) return;
    if (qaOnly && !name.startsWith('qa-')) return;
    const started = performance.now();
    try {
      const output = await action();
      const passed = Boolean(check(output));
      report.cases.push({ name, ms: Math.round(performance.now() - started), passed, output });
      console.log(`${name}: ${passed ? 'PASS' : 'FAIL'}`);
    } catch (error) {
      report.cases.push({ name, ms: Math.round(performance.now() - started), passed: false, error: safeError(error) });
      console.log(`${name}: FAIL`);
    }
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  };
  const todo = new TodoStructuringAdapter(router);
  await run('todo-simple', () => todo.structure('学一会儿微分方程'), drafts => drafts.length === 1 && /微分方程/.test(drafts[0].title));
  await run('todo-budget', () => todo.structure('读第三章，然后整理第三章笔记', { availableMinutes: 30 }),
    drafts => drafts.length >= 2 && drafts.reduce((total, item) => total + item.estimatedMinutes, 0) <= 30);
  const review = new ReviewGeneratorAdapter(router);
  await run('review-evidence', () => review.generate({ reviewType: 'daily', date: '2026-11-06',
    todos: [{ id: 'synthetic-task-1', title: '阅读第三章', scheduledDate: '2026-11-06', status: 'completed', tags: [], linkedNoteIds: [], createdAt: '2026-11-06T09:00:00+08:00', updatedAt: '2026-11-06T10:00:00+08:00', completedAt: '2026-11-06T10:00:00+08:00' }],
    focusSessions: [{ id: 'synthetic-focus-1', todoId: 'synthetic-task-1', status: 'completed', durationMinutes: 25, actualMinutes: 25, startedAt: '2026-11-06T09:00:00+08:00' }],
  }), output => !output.content.includes('AI 未能生成') && output.evidence?.observations.length > 0);
  const pet = new InteractionGenerator(router);
  await run('pet-quiet-statement', () => pet.generateDialogue({ scene: 'health_reminder', speechAct: 'statement', responseMode: 'statement', facts: '喝口水，润润嗓子。' }),
    output => !output.fromTemplate && !/[?？]|要不要|吗/.test(output.content) && !output.quickReplies?.length);
  const candidates = [{ chunkId: 'c1', noteId: 'synthetic-binary', text: '二分查找要求数组有序。每次比较中间元素，排除不包含目标的一半，时间复杂度为 O(log n)。', score: 0.9, matchedBy: ['rule'] }];
  const qa = new SelfRag(router, { retrieve: async () => candidates }, { ...defaultSelfRagOptions, maxRefine: 0 });
  await run('qa-supported', () => qa.ask('二分查找对数组有什么要求？'), output => output.ok && output.judged && /有序|排序/.test(output.answer) && output.citations.some(c => c.chunkId === 'c1'));
  await run('qa-unanswerable', () => qa.ask('这份资料的作者叫什么名字？'), output => output.ok && output.judged && /不足|未提供|没有|无法|未提及/.test(output.answer) && output.citations.length === 0);
  await run('streaming', async () => {
    let tokens = ''; let firstTokenMs;
    const started = performance.now();
    const output = await runtime.complete({ model: report.model, prompt: '请只回复：测试成功', maxTokens: 30,
      onToken: delta => { firstTokenMs ??= Math.round(performance.now() - started); tokens += delta; } });
    return { output, tokens, firstTokenMs };
  }, result => result.tokens === result.output && /测试成功/.test(result.output));
  await run('stream-cancel', async () => {
    const controller = new AbortController(); let tokens = 0;
    try {
      await runtime.complete({ model: report.model, prompt: '请按顺序列出从1到200的所有整数，每行一个。', maxTokens: 600,
        signal: controller.signal, onToken: () => { tokens++; controller.abort(); } });
      return { aborted: false, tokens };
    } catch (error) { return { aborted: controller.signal.aborted && error.name === 'AbortError', tokens }; }
  }, result => result.aborted && result.tokens === 1);
  if (boundaries) {
    const { runLearningAiCases } = await import('./lib/learning-ai-cases.mjs');
    await runLearningAiCases({ vite, router, run });
  }
  report.passed = report.cases.length > 0 && report.cases.every(entry => entry.passed);
} catch (error) { report.error = safeError(error); }
finally {
  runtime?.configure({ apiKey: '' });
  const path = join(directory, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  key = '';
  await vite.close();
  console.log(`Report: ${path}`);
  if (!report.passed) process.exitCode = 1;
}

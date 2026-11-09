// Opt-in local-model acceptance; synthetic fixtures, no user DB or settings.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { runLearningAiCases } from './lib/learning-ai-cases.mjs';

const directory = await mkdtemp(join(tmpdir(), 'nativemind-local-learning-'));
const report = { model: 'qwen3:14b', syntheticOnly: true, passed: false, cases: [] };
const selected = new Set(process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length).split(',')
  ?? ['runtime-stream', 'runtime-cancel', 'boundary-socratic-follow-up', 'boundary-socratic-injection', 'boundary-pending-follow-up']);
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { OllamaProvider } = await vite.ssrLoadModule('/src/infrastructure/model-runtime/ollama-provider.ts');
  const { ModelRouter } = await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const runtime = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', timeoutMs: 60000 });
  if (!await runtime.isAvailable(report.model)) throw new Error('Requires installed local qwen3:14b; no model is downloaded');
  const realRouter = new ModelRouter(runtime, { resolveModel: () => report.model });
  const router = { run: request => realRouter.run({ ...request, modelPolicy: { ...request.modelPolicy, noRetry: true, noFallback: true } }) };
  const run = async (name, action, check) => {
    if (!selected.has(name)) return;
    const started = performance.now();
    try {
      const output = await action();
      report.cases.push({ name, ms: Math.round(performance.now() - started), passed: Boolean(check(output)), output });
    } catch (error) { report.cases.push({ name, ms: Math.round(performance.now() - started), passed: false, error: String(error) }); }
    console.log(`${name}: ${report.cases.at(-1).passed ? 'PASS' : 'FAIL'}`);
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  };
  await run('runtime-stream', async () => {
    const started = performance.now(); let firstTokenMs; let preview = '';
    const output = await runtime.complete({ model: report.model, prompt: '用一句话解释二分查找。', maxTokens: 128,
      onToken: delta => { firstTokenMs ??= Math.round(performance.now() - started); preview += delta; },
    });
    return { firstTokenMs, output, previewMatches: preview === output };
  }, result => result.previewMatches && result.output.trim().length > 0 && Number.isFinite(result.firstTokenMs));
  await run('runtime-cancel', async () => {
    const controller = new AbortController(); let callbacks = 0; let cancelledAt;
    try {
      await runtime.complete({ model: report.model, prompt: '详细解释二分查找的步骤及例子。', maxTokens: 256, signal: controller.signal,
        onToken: () => { callbacks++; cancelledAt ??= performance.now(); controller.abort(); },
      });
      return { cancelled: false, callbacks };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return { cancelled: error?.name === 'AbortError', callbacks, cancellationMs: Math.round(performance.now() - cancelledAt) };
    }
  }, result => result.cancelled && result.callbacks === 1 && result.cancellationMs < 2000);
  await runLearningAiCases({ vite, router, run });
  report.passed = report.cases.length === selected.size && report.cases.every(item => item.passed);
} catch (error) { report.error = String(error); }
finally {
  const path = join(directory, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await vite.close();
  console.log(`Report: ${path}`);
  if (!report.passed) process.exitCode = 1;
}

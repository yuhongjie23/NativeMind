// Manual opt-in acceptance: fixed synthetic records, local Qwen only, no user database.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'nativemind-review-check-'));
const report = { model: 'qwen3:14b', passed: false, cases: [] };
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { OllamaProvider } = await vite.ssrLoadModule('/src/infrastructure/model-runtime/ollama-provider.ts');
  const { ModelRouter } = await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const { ReviewGeneratorAdapter } = await vite.ssrLoadModule('/src/ai/adapters.ts');
  const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', timeoutMs: 60000 });
  if (!await provider.isAvailable(report.model)) throw new Error('Requires installed local qwen3:14b');
  const adapter = new ReviewGeneratorAdapter(new ModelRouter(provider, { resolveModel: () => report.model }));
  const todo = { id: '62675d30-859b-42a9-b90d-10117a2f5990', title: '阅读第三章', scheduledDate: '2026-11-06', status: 'completed', tags: [], linkedNoteIds: [], createdAt: '2026-11-06T09:00:00+08:00', updatedAt: '2026-11-06T10:00:00+08:00', completedAt: '2026-11-06T10:00:00+08:00' };
  const fixtures = [
    { name: 'empty-day', input: { reviewType: 'daily', date: '2026-11-06', todos: [], focusSessions: [] },
      check: output => output.nextTodos.length === 0 && !/懒惰|不自律/.test(output.content) },
    { name: 'daily-with-adopted-task', input: { reviewType: 'daily', date: '2026-11-06', todos: [todo],
      focusSessions: [{ id: 'f1', todoId: todo.id, status: 'completed', durationMinutes: 25, actualMinutes: 25, startedAt: '2026-11-06T09:00:00+08:00' }],
      followUps: [{ id: 'a1', reviewId: 'r0', suggestion: '阅读第三章', todoId: todo.id, adoptedAt: '2026-11-05T09:00:00+08:00', status: 'completed', completedAt: todo.completedAt }] },
      check: output => output.evidence.observations.length > 0 && output.evidence.sources.some(source => source.id === 'followup:a1') },
    { name: 'sparse-week', input: { reviewType: 'weekly', date: '2026-11-06', dates: ['2026-11-06', '2026-11-05', '2026-11-04'], todos: [todo], focusSessions: [] },
      check: output => output.evidence.limitations.length > 0 },
  ];
  for (const fixture of fixtures) {
    const started = performance.now();
    const output = await adapter.generate(fixture.input, { signal: AbortSignal.timeout(90000) });
    const passed = !output.content.includes('AI 未能生成') && fixture.check(output)
      && !/记录.*使用|增加应用|记录专注|补充专注时间|增加学习时间|其他章节/.test(output.nextTodos.join('；'))
      && !/学习时间较短|未覆盖其他|3天期间没有安排/.test(output.content + output.insights.join('；'));
    report.cases.push({ name: fixture.name, ms: Math.round(performance.now() - started), passed, output });
    console.log(`${fixture.name}: ${passed ? 'PASS' : 'FAIL'}`);
  }
  report.passed = report.cases.every(entry => entry.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  const path = join(directory, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await vite.close();
  console.log(`Report: ${path}`);
}

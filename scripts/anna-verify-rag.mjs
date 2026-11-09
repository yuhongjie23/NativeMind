// Manual, opt-in acceptance check. Not part of npm test; requires local Ollama models.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'vite';

const executable = resolve(process.env.ANNA_NATIVE_BINARY || `anna/native/target/release/nativemind-anna-native${process.platform === 'win32' ? '.exe' : ''}`);
await stat(executable);
const resume = process.argv.includes('--resume-documents');
const dataDir = resume ? await realpath(process.argv[process.argv.indexOf('--resume-documents') + 1]) : await mkdtemp(join(tmpdir(), 'nativemind-rag-check-'));
if (resume) {
  assert.equal(dirname(dataDir).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(basename(dataDir).startsWith('nativemind-rag-check-'));
  await stat(join(dataDir, 'document-benchmark.json'));
}
console.log(`Synthetic acceptance data: ${dataDir}`);
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' });
const child = spawn(executable, ['--local-dev'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: dataDir },
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
const failPending = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
child.on('error', failPending);
child.on('exit', () => failPending(new Error(`Native process exited: ${stderr}`)));
lines.on('line', line => {
  try {
    const reply = JSON.parse(line);
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.error) waiter?.reject(new Error(reply.error.message));
    else if (!reply.result.success) waiter?.reject(new Error(reply.result.error));
    else waiter?.resolve(reply.result.data);
  } catch (error) { failPending(error); }
});
let connection;
const documentManifest = process.argv[process.argv.indexOf('--documents') + 1];
const withDocuments = process.argv.includes('--documents');
const deadline = setTimeout(() => { failPending(new Error('Acceptance check exceeded its time budget')); child.kill(); }, withDocuments ? 1_800_000 : 300_000);
const report = { dataDir, passed: false, checks: [] };
try {
  const { createAnnaConnection } = await vite.ssrLoadModule('/src/infrastructure/anna/connection.ts');
  const { isModelJob, runModelJob } = await vite.ssrLoadModule('/src/infrastructure/anna/model-jobs.ts');
  const { isFileJob, runFileJob } = await vite.ssrLoadModule('/src/infrastructure/anna/file-jobs.ts');
  const { createTauriRuntime } = await vite.ssrLoadModule('/src/infrastructure/tauri-runtime.ts');
  connection = createAnnaConnection({ windowUuid: 'synthetic-rag-check', tools: {
    invoke: ({ method, args }) => new Promise((resolveReply, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolveReply, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'invoke', params: { tool: method, arguments: args } }) + '\n');
    }),
  } }, 'local-check');
  const invoke = (command, args, options) => isFileJob(command)
    ? runFileJob(connection.invoke, command, args, options?.signal)
    : isModelJob(command) ? runModelJob(connection.invoke, command, args, options) : connection.invoke(command, args);
  const runtime = createTauriRuntime({ invoke, localOnly: true, streaming: false, confirmationPrompt: async () => false });
  await runtime.infrastructure.initialize();
  const status = await invoke('native_status');
  assert.equal(status.vector.available, true, 'sqlite-vec must actually load');
  const models = await invoke('model_list');
  assert(models.some(model => model.name.replace(/:latest$/, '') === 'nomic-embed-text'), 'Install nomic-embed-text first');
  const vectors = await runtime.infrastructure.modelRuntime.embed(['记忆需要分散复习，而不是一次性集中练习。']);
  assert.equal(vectors[0].length, 768);
  assert(vectors[0].every(Number.isFinite));
  report.checks.push({ name: 'real embeddings', dimensions: vectors[0].length });

  if (!resume) {
  const fixtures = [
    { title: '间隔复习', content: '把学习内容分散到多天回顾，比一天内重复阅读更有利于长期记忆。每次先不看材料，主动回忆答案，再检查遗漏。复习间隔可以逐步延长。', query: '怎样在几周之后仍能记住学过的知识？' },
    { title: '植物光合作用', content: '绿色植物利用叶绿体吸收太阳光，将二氧化碳和水转化为糖类，并释放氧气。光合作用把光能储存在有机物中。', query: '绿色叶片怎样利用阳光制造养分？' },
    { title: '二分查找', content: '二分查找要求数组有序。每次比较中间元素，把不可能包含目标的一半排除，直到找到目标或区间为空。时间复杂度是对数级。', query: '如何在排好顺序的数据中不断缩小一半范围寻找目标？' },
  ];
  for (const fixture of fixtures) {
    const note = await runtime.application.useCases.importNote.execute({ kind: 'text', title: fixture.title, content: fixture.content });
    fixture.id = note.id;
  }
  for (let round = 0; round < 8 && (await runtime.infrastructure.jobQueue.listPending()).length; round++) {
    await runtime.infrastructure.jobQueue.drain();
  }
  const notes = await runtime.infrastructure.db.select('SELECT id, index_status, index_error, chunk_count FROM notes');
  assert(notes.every(note => note.index_status === 'indexed' && !note.index_error), JSON.stringify(notes));
  const chunks = await runtime.infrastructure.db.select('SELECT id FROM note_chunks');
  const count = await runtime.infrastructure.db.select('SELECT COUNT(*) AS count FROM note_chunk_embeddings');
  assert.equal(Number(count[0].count), chunks.length);
  assert(chunks.length >= fixtures.length);
  report.checks.push({ name: 'import and index', notes: notes.length, vectors: chunks.length });
  console.log('Real import, chunking and vector writes passed');
  for (const fixture of fixtures) {
    const [queryVector] = await runtime.infrastructure.modelRuntime.embed([fixture.query], undefined, 'query');
    const matches = await runtime.infrastructure.vectorStore.query(queryVector, 3);
    assert.equal(matches[0]?.noteId, fixture.id, `Vector top match: ${fixture.title}`);
    const hits = await runtime.ai.rag.retrieve({ text: fixture.query, deep: false }, 3);
    assert(hits.some(hit => hit.noteId === fixture.id && hit.matchedBy.includes('vector')), `RAG vector evidence: ${fixture.title}`);
    report.checks.push({ name: 'retrieval', query: fixture.query, expected: fixture.title, topScore: matches[0].score, matchedBy: hits.find(hit => hit.noteId === fixture.id).matchedBy });
  }
  if (process.argv.includes('--answer')) {
    assert(models.some(model => model.name === 'qwen3:14b'), 'Install qwen3:14b for --answer');
    const { setModelConfig } = await vite.ssrLoadModule('/src/ai/router/model-config.ts');
    setModelConfig({ small: 'qwen3:14b', big: 'qwen3:14b', providerMode: 'local' });
    console.log('Checking a real grounded answer with Qwen3 14B…');
    const answer = await runtime.application.useCases.askNotes.execute('根据笔记，怎样安排复习才能改善长期记忆？请用100字以内回答。', { deep: false, signal: AbortSignal.timeout(180_000) });
    report.checks.push({ name: 'grounded answer', answer });
    assert(answer.ok && !answer.empty && answer.answer.length > 0, 'Expected a generated answer');
    assert(answer.citations.some(citation => citation.noteId === fixtures[0].id), 'Expected a citation to the relevant note');
  }
  }
  if (process.argv.includes('--measure-search')) {
    assert(resume, '--measure-search requires an existing isolated --resume-documents directory');
    const { measureSearch } = await import('./lib/measure-search.mjs');
    const label = process.argv.includes('--baseline') ? 'baseline' : 'after';
    report.performance = await measureSearch({ runtime, vite, dataDir, label });
  }
  if (withDocuments) {
    const { verifyDocuments } = await import('./lib/verify-documents.mjs');
    report.documents = await verifyDocuments({ runtime, vite, invoke, dataDir, manifestPath: documentManifest, inspect: process.argv.includes('--inspect'), evaluateOnly: resume });
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) {
    await connection?.close().catch(() => undefined);
    const exited = once(child, 'exit');
    child.stdin.end();
    await exited;
  }
  lines.close();
  await vite.close();
  await writeFile(join(dataDir, resume ? 'acceptance-after.json' : 'acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/** Opt-in real-model measurement, using only the harness's isolated test database. */
export async function measureSearch({ runtime, vite, dataDir, label }) {
  const { setModelConfig } = await vite.ssrLoadModule('/src/ai/router/model-config.ts');
  setModelConfig({ small: 'qwen3:14b', big: 'qwen3:14b', providerMode: 'local' });
  const report = { model: 'qwen3:14b', createdAt: new Date().toISOString(), runs: [] };
  for (const mode of (label === 'baseline' ? ['search', 'ask'] : ['search', 'ask', 'ask-deep'])) {
    const query = mode === 'search' ? 'hardware-aware' : 'According to the Mamba paper, how does inference throughput compare to Transformers? Answer briefly using the notes.';
    const started = performance.now();
    const deep = mode !== 'search' && (label === 'baseline' || mode === 'ask-deep');
    const run = { mode, deep, query, stages: [], firstPartialMs: null, firstTokenMs: null };
    const options = {
      signal: AbortSignal.timeout(240_000),
      onProgress: event => {
        run.stages.push({ ...event, atMs: Math.round(performance.now() - started) });
        if (event.state === 'finished') console.log(`${mode}: ${event.stage} ${Math.round(event.durationMs)}ms`);
      },
      onPartial: hits => { if (run.firstPartialMs === null) { run.firstPartialMs = Math.round(performance.now() - started); run.partialCount = hits.length; } },
      onToken: delta => { if (delta && run.firstTokenMs === null) run.firstTokenMs = Math.round(performance.now() - started); },
    };
    const result = mode === 'search'
      ? await runtime.application.useCases.searchNotes.execute(query, 10, 'user_explicit', false, options)
      : await runtime.application.useCases.askNotes.execute(query, { ...options, deep });
    run.totalMs = Math.round(performance.now() - started);
    run.results = mode === 'search' ? result.hits.length : result.citations.length;
    if (mode !== 'search') { run.answer = result.answer; run.ok = result.ok; run.judged = result.judged; }
    report.runs.push(run);
    await writeFile(join(dataDir, `search-performance-${label}.json`), JSON.stringify(report, null, 2));
    console.log(`${mode}: total ${run.totalMs}ms, first result ${run.firstPartialMs ?? run.firstTokenMs}ms`);
  }
  if (label !== 'baseline') {
    const { db, jobQueue, modelRuntime } = runtime.infrastructure;
    assert.equal((await jobQueue.listPending()).length, 0, 'Use an idle isolated benchmark database');
    const [note] = await db.select('SELECT id FROM notes WHERE chunk_count > 20 LIMIT 1');
    assert(note, 'Expected an indexed long document');
    const embed = modelRuntime.embed.bind(modelRuntime);
    let begin;
    const started = new Promise(resolve => { begin = resolve; });
    let observedSignal;
    modelRuntime.embed = (texts, signal, purpose) => {
      const work = embed(texts, signal, purpose);
      if (purpose !== 'query' && !observedSignal) { observedSignal = signal; begin(); }
      return work;
    };
    try {
      await jobQueue.enqueue({ type: 'embed_chunks', entityId: note.id });
      const draining = jobQueue.drain();
      await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('No background embedding started')), 5000).unref())]);
      const at = performance.now();
      const search = runtime.application.useCases.searchNotes.execute('hardware-aware', 10, 'user_explicit', false);
      await draining;
      const [paused] = await db.select("SELECT status, retry_count FROM background_jobs WHERE entity_id = ? AND job_type = 'embed_chunks' ORDER BY created_at DESC LIMIT 1", [note.id]);
      assert(observedSignal?.aborted, 'Expected native embedding cancellation');
      assert.equal(paused.status, 'pending');
      assert.equal(paused.retry_count, 0);
      const results = await search;
      report.preemption = { elapsedMs: Math.round(performance.now() - at), searchResults: results.hits.length, paused };
      assert.equal(await jobQueue.drain(), 1);
      const [resumed] = await db.select('SELECT index_status, index_error FROM notes WHERE id = ?', [note.id]);
      assert.equal(resumed.index_status, 'indexed');
      assert(!resumed.index_error);
      report.preemption.resumed = resumed;
    } finally { modelRuntime.embed = embed; }
    await writeFile(join(dataDir, `search-performance-${label}.json`), JSON.stringify(report, null, 2));
  }
  return report;
}

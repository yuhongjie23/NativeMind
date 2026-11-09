import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export async function verifyDocuments({ runtime, vite, invoke, dataDir, manifestPath, inspect, evaluateOnly }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.questions ??= JSON.parse(await readFile(new URL('../fixtures/document-retrieval-questions.json', import.meta.url), 'utf8'));
  const { chunkText } = await vite.ssrLoadModule('/src/ai/rag/chunk-strategy.ts');
  const { RetrievalStrategy } = await vite.ssrLoadModule('/src/ai/rag/retrieval-strategy.ts');
  const { NoteCandidateProvider } = await vite.ssrLoadModule('/src/infrastructure/rag/note-candidate-provider.ts');
  const { ReRanker } = await vite.ssrLoadModule('/src/ai/rag/rerank.ts');
  const { setModelConfig } = await vite.ssrLoadModule('/src/ai/router/model-config.ts');
  setModelConfig({ small: 'qwen3:14b', big: 'qwen3:14b', providerMode: 'local' });
  const documents = [], sources = [];
  for (const [i, source] of manifest.documents.entries()) {
    const path = join(dataDir, 'imports', basename(source.path));
    await copyFile(source.path, path);
    const started = performance.now();
    const parsed = await runtime.infrastructure.fileImport.parse({ kind: 'path', path });
    const doc = { path, title: parsed.title, chars: parsed.content.length, pages: parsed.pageRanges?.length,
      parseMs: Math.round(performance.now() - started),
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
    await writeFile(join(dataDir, `document-${i}.json`), JSON.stringify(parsed));
    console.log(JSON.stringify(doc));
    documents.push(doc);
    if (!inspect && parsed.content.trim()) {
      const note = await runtime.application.useCases.importNote.execute({ kind: 'path', path });
      sources.push({ index: i, note, parsed });
      await runtime.infrastructure.db.execute("UPDATE background_jobs SET status = 'cancelled' WHERE entity_id = ?", [note.id]);
    }
  }
  if (inspect) return { documents, inspectionOnly: true };
  const normalized = text => text.replace(/\s+/g, '').toLowerCase();
  const cache = new Map();
  const embedding = raw => ({ version: raw ? 'benchmark-raw' : runtime.infrastructure.modelRuntime.version,
    embed: async (texts, signal, purpose = 'document') => {
      const result = [];
      for (const text of texts) {
        signal?.throwIfAborted();
        const key = `${raw}:${purpose}:${text}`;
        if (!cache.has(key)) {
          const [vector] = raw ? await invoke('model_embed', { model: 'nomic-embed-text', texts: [text] }, { signal })
            : await runtime.infrastructure.modelRuntime.embed([text], signal, purpose);
          cache.set(key, vector);
        }
        result.push(cache.get(key));
      }
      return result;
    },
  });
  const candidateProvider = new NoteCandidateProvider(runtime.infrastructure.repositories.note);
  const configurations = [];
  // End on the shipping default so the resulting local database can be opened for UI checks.
  for (const config of (evaluateOnly ? [{ name: 'prefix-800-after', target: 800, raw: false }] : [{ name: 'raw-800', target: 800, raw: true }, { name: 'prefix-1200', target: 1200, raw: false }, { name: 'prefix-800', target: 800, raw: false }])) {
    const model = embedding(config.raw);
    if (!evaluateOnly) await runtime.infrastructure.vectorStore.clear();
    let chunkCount = 0;
    const indexStart = performance.now();
    for (const source of evaluateOnly ? [] : sources) {
      const drafts = chunkText(source.parsed.content, source.parsed.sourceType === 'pdf' ? 'pdf' : 'markdown', { targetChars: config.target, minChars: 200, maxChars: config.target === 800 ? 1500 : 2000 });
      const chunks = drafts.map(draft => ({ id: randomUUID(), noteId: source.note.id, text: draft.text, charStart: draft.offset, charEnd: draft.offset + draft.text.length, headingPath: draft.headingPath, tags: [], createdAt: new Date().toISOString() }));
      await runtime.infrastructure.repositories.note.replaceChunks(source.note.id, chunks);
      for (let start = 0; start < chunks.length; start += 12) {
        const batch = chunks.slice(start, start + 12);
        const vectors = await model.embed(batch.map(c => c.text));
        await runtime.infrastructure.vectorStore.upsert(batch.map((c, i) => ({ chunkId: c.id, noteId: c.noteId, text: c.text, embedding: vectors[i] })));
        console.log(`${config.name}: ${source.parsed.title} ${Math.min(start + 12, chunks.length)}/${chunks.length}`);
      }
      await runtime.infrastructure.repositories.note.updateIndexStatus(source.note.id, 'indexed', { chunkCount: chunks.length, embeddingVersion: model.version });
      chunkCount += chunks.length;
    }
    const indexMs = Math.round(performance.now() - indexStart);
    // Document embeddings may be cached across configurations; query timings are cold.
    for (const key of cache.keys()) if (key.startsWith(`${config.raw}:query:`)) cache.delete(key);
    const results = [];
    for (const question of manifest.questions) {
      const query = { text: question.query, deep: false };
      const candidates = await candidateProvider.listCandidates(query, 100);
      const retrieval = new RetrievalStrategy(model, runtime.infrastructure.vectorStore, undefined, { rerankAlways: false });
      const start = performance.now();
      const hits = await retrieval.retrieve(query, candidates, 8);
      const evidenceAt = k => (question.evidence ?? []).map(e => hits.slice(0, k).some(hit => hit.noteId === sources.find(s => s.index === e.document)?.note.id && normalized(hit.text).includes(normalized(e.anchor))));
      const result = { id: question.id, query: question.query, absent: !!question.absent, ms: Math.round(performance.now() - start), recall3: evidenceAt(3), recall8: evidenceAt(8), hits: hits.map(h => ({ noteId: h.noteId, charStart: h.charStart, score: h.score, text: h.text.slice(0, 160) })) };
      if (config.name.startsWith('prefix-800') && !question.absent) {
        const reranker = new ReRanker(runtime.ai.router);
        const rankStart = performance.now();
        const ranked = await reranker.rerank(question.query, hits, 8);
        result.rerank = { applied: ranked !== null, ms: Math.round(performance.now() - rankStart), recall3: (question.evidence ?? []).map(e => (ranked ?? hits).slice(0, 3).some(h => h.noteId === sources.find(s => s.index === e.document)?.note.id && normalized(h.text).includes(normalized(e.anchor)))) };
      }
      results.push(result);
      console.log(`${config.name}: ${question.id} evidence@3=${result.recall3.join(',')} @8=${result.recall8.join(',')}`);
    }
    configurations.push({ ...config, chunkCount, indexMs, reusedIndex: !!evaluateOnly, results });
    await writeFile(join(dataDir, evaluateOnly ? 'document-benchmark-after.json' : 'document-benchmark.json'), JSON.stringify({ documents, configurations }, null, 2));
  }
  const answers = [];
  for (const question of manifest.questions.filter(q => q.answer)) {
    const start = performance.now();
    const answer = await runtime.application.useCases.askNotes.execute(question.query, { deep: false, signal: AbortSignal.timeout(180_000) });
    answers.push({ id: question.id, ms: Math.round(performance.now() - start), answer,
      expectedEvidenceInCitations: (question.evidence ?? []).map(e => answer.citations.some(c => c.noteId === sources.find(s => s.index === e.document)?.note.id && normalized(c.text).includes(normalized(e.anchor)))) });
    console.log(`Answer ${question.id}: ${answer.answer.slice(0, 100)}`);
  }
  const report = { documents, configurations, answers, sourceNoteIds: sources.map(s => ({ document: s.index, noteId: s.note.id })), note: 'Recall is exact expected-passage coverage, not an automatic claim that generated answers are correct. Absent questions require reviewing the answer.' };
  await writeFile(join(dataDir, evaluateOnly ? 'document-benchmark-after.json' : 'document-benchmark.json'), JSON.stringify(report, null, 2));
  return report;
}

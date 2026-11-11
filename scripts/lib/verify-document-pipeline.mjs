// Uses shipping import/jobs/search/QA. No direct chunk/vector writes, no candidate stubs.
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';

export async function verifyDocumentPipeline({ runtime, vite, dataDir, manifestPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { setModelConfig } = await vite.ssrLoadModule('/src/ai/router/model-config.ts');
  const { resolveDocumentOffset, findTextMatches } = await vite.ssrLoadModule('/src/ui/components/features/document-find.ts');
  setModelConfig({ small: 'qwen3:14b', big: 'qwen3:14b', providerMode: 'local' });
  const report = { createdAt: new Date().toISOString(), models: ['qwen3:14b', 'nomic-embed-text'],
    documents: [], results: [], limitations: 'Local real files and models; headless production runtime with Rust extraction, SQLite and sqlite-vec. Exact passage coverage is stricter than semantic relevance. Citation offsets are checked against saved text and reader resolver, not rendered UI. No general accuracy claim.' };
  const save = () => writeFile(join(dataDir, 'pipeline-acceptance.json'), JSON.stringify(report, null, 2));
  const sources = new Map();
  const normalized = text => text.replace(/\s+/g, '').toLowerCase();
  for (const [index, source] of manifest.documents.entries()) {
    const path = join(dataDir, 'imports', basename(source.path));
    await copyFile(source.path, path);
    const started = performance.now();
    console.log(`Importing document ${index}: ${basename(path)}`);
    const note = await runtime.application.useCases.importNote.execute({ kind: 'path', path }, {
      onPhase: phase => console.log(`Document ${index}: ${phase}`), signal: AbortSignal.timeout(180000),
    });
    sources.set(index, note);
    // Local-only inspection files, kept outside the repository.
    await writeFile(join(dataDir, `source-${index}.json`), JSON.stringify(note));
    const doc = { index, title: note.title, noteId: note.id, chars: note.content.length,
      pages: note.pageRanges?.length, importMs: Math.round(performance.now() - started),
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
    report.documents.push(doc);
    await save();
    const indexing = performance.now();
    const ticker = setInterval(() => console.log(`Indexing document ${index}: ${Math.round((performance.now() - indexing) / 1000)}s elapsed`), 15000);
    try {
      for (let round = 0; round < 8 && (await runtime.infrastructure.jobQueue.listPending()).length; round++) {
        await runtime.infrastructure.jobQueue.drain();
      }
    } finally { clearInterval(ticker); }
    const indexed = await runtime.infrastructure.repositories.note.findById(note.id);
    const chunks = await runtime.infrastructure.repositories.note.listChunks(note.id);
    const [vectors] = await runtime.infrastructure.db.select('SELECT COUNT(*) AS count FROM note_chunk_embeddings WHERE note_id = ?', [note.id]);
    Object.assign(doc, { indexMs: Math.round(performance.now() - indexing), indexStatus: indexed.indexStatus,
      indexError: indexed.indexError, chunkCount: chunks.length, vectors: Number(vectors.count),
      embeddingVersion: indexed.embeddingVersion,
      chunkOffsetsValid: chunks.every(c => note.content.slice(c.charStart, c.charEnd) === c.text) });
    await save();
    console.log(JSON.stringify(doc));
    assert.equal(indexed.indexStatus, 'indexed');
    assert(!indexed.indexError, indexed.indexError);
    assert(chunks.length > 0);
    assert.equal(doc.vectors, chunks.length);
    assert(doc.chunkOffsetsValid, 'Chunks must resolve to the imported source exactly');
    const duplicate = await runtime.application.useCases.importNote.execute({ kind: 'path', path });
    doc.duplicateIdPreserved = duplicate.id === note.id;
    assert(doc.duplicateIdPreserved);
    const findStart = performance.now();
    const probe = manifest.questions.flatMap(q => q.evidence ?? []).find(e => e.document === index)?.anchor;
    doc.find = probe ? { query: probe, matches: findTextMatches(note.content, probe).length, ms: performance.now() - findStart } : undefined;
    await save();
  }
  // Validate the fixed answer key against the parsed books before asking models.
  for (const question of manifest.questions) for (const evidence of question.evidence ?? []) {
    assert(normalized(sources.get(evidence.document).content).includes(normalized(evidence.anchor)), `Gold passage missing: ${question.id}`);
  }
  for (const question of manifest.questions) {
    await runtime.infrastructure.repositories.settings.set('app.language', question.language ?? 'zh');
    const stages = [], progress = [];
    const started = performance.now();
    const search = await runtime.application.useCases.searchNotes.execute(question.query, 8, 'user_explicit', false, {
      signal: AbortSignal.timeout(180000), onProgress: p => stages.push(p),
    });
    const coverage = (hits, k) => (question.evidence ?? []).map(e => hits.slice(0, k).some(h =>
      h.noteId === sources.get(e.document).id && normalized(h.text).includes(normalized(e.anchor))));
    const result = { id: question.id, query: question.query, language: question.language ?? 'zh',
      searchMs: Math.round(performance.now() - started), searchStages: stages, recall3: coverage(search.hits, 3), recall8: coverage(search.hits, 8),
      externalSearchAttempted: search.externalSearchAttempted,
      hits: search.hits.map(h => ({ noteId: h.noteId, charStart: h.charStart, text: h.text, score: h.score })) };
    assert(!search.externalSearchAttempted, 'Acceptance must stay local');
    report.results.push(result);
    await save();
    console.log(`Search ${question.id}: @3=${result.recall3} @8=${result.recall8} ${result.searchMs}ms`);
    const qaStart = performance.now();
    let firstTokenMs;
    // Opt-in traces contain source text and stay only in the isolated temp report.
    const model = runtime.infrastructure.modelRuntime;
    const complete = model.complete;
    if (manifest.traceModels) {
      result.modelCalls = [];
      model.complete = async request => {
        const call = { system: request.system, prompt: request.prompt, maxTokens: request.maxTokens };
        result.modelCalls.push(call);
        const start = performance.now();
        try {
          call.output = await complete.call(model, { ...request, onToken: (delta, reset) => {
            call.partial = reset ? delta : (call.partial ?? '') + delta;
            request.onToken?.(delta, reset);
          } });
          return call.output;
        }
        catch (error) { call.error = String(error); throw error; }
        finally { call.ms = Math.round(performance.now() - start); }
      };
    }
    try {
      const answer = await runtime.application.useCases.askNotes.execute(question.query, {
        deep: true, signal: AbortSignal.timeout(180000), onProgress: p => progress.push(p),
        onToken: delta => { if (delta && firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - qaStart); },
      });
      const locations = answer.citations.map(c => {
        const note = [...sources.values()].find(n => n.id === c.noteId);
        const exact = !!note && c.charStart !== undefined && note.content.slice(c.charStart, c.charStart + c.text.length) === c.text;
        return { noteId: c.noteId, charStart: c.charStart, exact,
          readerOffset: note ? resolveDocumentOffset(note.content, c.charStart, c.text) : undefined,
          page: note?.pageRanges?.find(r => c.charStart >= r.start && c.charStart < r.end)?.page };
      });
      Object.assign(result, { qaMs: Math.round(performance.now() - qaStart), firstTokenMs, qaStages: progress, answer, locations,
        citationLocationsValid: locations.every(l => l.exact && l.readerOffset === l.charStart),
        evidenceInCitations: coverage(answer.citations, answer.citations.length),
        abstained: answer.citations.length === 0 && (answer.empty || /资料不足|Insufficient evidence/.test(answer.answer)),
        expectedAbsent: !!question.absent });
      console.log(`Answer ${question.id}: ${result.qaMs}ms judged=${answer.judged} citations=${answer.citations.length} ${answer.answer.slice(0, 140)}`);
    } catch (error) { result.qaError = String(error); console.log(`Answer ${question.id} failed: ${error}`); }
    finally { model.complete = complete; }
    await save();
  }
  report.integrityPassed = report.results.every(r => !r.qaError && r.citationLocationsValid && r.answer.ok);
  report.absentPassed = report.results.filter(r => r.expectedAbsent).every(r => r.abstained);
  report.positiveAnswersPassed = report.results.filter(r => !r.expectedAbsent)
    .every(r => r.answer?.ok && r.answer.judged && r.answer.citations.length > 0);
  report.expectedPassagesRetrieved = report.results.every(r => r.recall8.every(Boolean));
  // A nonempty citation list alone is not evidence that it answers the question.
  // Keep this strict fixed-passage check distinct from manual semantic review.
  report.expectedPassagesCited = report.results.filter(r => !r.expectedAbsent)
    .every(r => r.evidenceInCitations?.length > 0 && r.evidenceInCitations.every(Boolean));
  report.accepted = report.integrityPassed && report.absentPassed && report.positiveAnswersPassed
    && report.expectedPassagesRetrieved && report.expectedPassagesCited;
  await save();
  console.log(`Pipeline report: ${join(dataDir, 'pipeline-acceptance.json')}`);
  return report;
}

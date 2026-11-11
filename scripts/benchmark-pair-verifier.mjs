// Opt-in local-model A/B. Frozen claim/quote pairs isolate evidence verification.
// Usage: node scripts/benchmark-pair-verifier.mjs <previous pipeline-acceptance.json>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const previous = JSON.parse(await readFile(process.argv[2], 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'nativemind-pair-verifier-'));
const cases = [];
for (const [id, expected] of [
  ['mamba-appendix-normalization', [true]], ['love-elements', [true]],
  ['mamba-mechanism', [false, true, false]], ['mamba-chinese', [false, true, false]],
]) {
  const citations = previous.results.find(r => r.id === id).answer.citations;
  assert.equal(citations.length, expected.length, `Frozen case changed: ${id}`);
  citations.forEach((c, i) => cases.push({ id: `${id}-${i}`, claim: c.supportingClaim, quote: c.text, expected: expected[i] }));
}
cases.push(
  { id:'novel-causal-gap', claim:'The filter improved recovery because its pores are smaller.', quote:'The new filter improved recovery from 50% to 70%.', expected:false },
  { id:'novel-causal-supported', claim:'The filter improved recovery because its pores are smaller.', quote:'The smaller pores in the new filter retain particles previously lost, causing the improved recovery.', expected:true },
  { id:'novel-scope-gap', claim:'所有学生都提高了成绩。', quote:'参与测试的二十名学生中，有十二名提高了成绩。', expected:false },
  { id:'novel-condition-supported', claim:'样品需冷却十分钟后再密封。', quote:'操作要求：先将样品冷却十分钟，然后密封保存。', expected:true },
);
const report = { model:'qwen3:14b', createdAt:new Date().toISOString(), cases, runs:[],
  limitations:'Frozen evidence pairs and four synthetic held-out controls. This isolates pair verification, not retrieval or whole-answer correctness. One pass per arm, temperature zero; no cloud.' };
const vite = await createServer({ server:{middlewareMode:true,watch:null,hmr:false},appType:'custom',logLevel:'error' });
try {
  const { OllamaProvider } = await vite.ssrLoadModule('/src/infrastructure/model-runtime/ollama-provider.ts');
  const { ModelRouter } = await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const { PAIR_CHECK_SYSTEM } = await vite.ssrLoadModule('/src/ai/rag/qa-evidence-review.ts');
  const { PAIR_VERIFIER_SYSTEM, isPairSupported, verifyEvidencePair } = await vite.ssrLoadModule('/src/ai/rag/qa-pair-verifier.ts');
  const provider = new OllamaProvider({timeoutMs:90000});
  assert(await provider.isAvailable(report.model));
  await provider.complete({model:report.model,prompt:'Reply OK.',maxTokens:8,temperature:0,signal:AbortSignal.timeout(90000)});
  const router = new ModelRouter(provider, {resolveModel:()=>report.model});
  for (const [index, example] of cases.entries()) for (const arm of index % 2 ? ['combined','v2','v1'] : ['v1','v2','combined']) {
    const pair = {claim:example.claim,quote:example.quote};
    const started = performance.now();
    const decision = arm === 'combined' ? await verifyEvidencePair(router, pair, AbortSignal.timeout(20000)) : undefined;
    const result = arm === 'combined' ? {ok:decision!==undefined,output:{supported:[decision]}} : await router.run({taskType:'deep_qa_critic',schemaOverride:`qa-evidence-check.${arm}`,
      modelPolicy:{noRetry:true,noFallback:true,temperature:0,maxTokens:arm==='v1'?64:128},
      signal:AbortSignal.timeout(20000),input:pair,
      inlinePrompt:{system:arm==='v1'?PAIR_CHECK_SYSTEM:PAIR_VERIFIER_SYSTEM,user:JSON.stringify(arm==='v1'?[pair]:pair)} });
    const accepted = result.ok && (arm!=='v2' ? result.output.supported.length===1 && result.output.supported[0]===true : isPairSupported(result.output));
    const run = {id:example.id,arm,ms:Math.round(performance.now()-started),accepted,pass:result.ok && accepted===example.expected,output:result.output,error:result.error};
    report.runs.push(run);
    await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(run));
  }
} finally { await vite.close(); }
console.log(`Report: ${join(directory,'report.json')}`);

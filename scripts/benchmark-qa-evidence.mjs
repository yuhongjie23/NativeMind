// Opt-in real-model QA A/B; fixed retrieved candidates isolate context preparation and citation checks.
// node scripts/benchmark-qa-evidence.mjs --baseline <directory containing baseline.ts>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const savedArg = process.argv.indexOf('--baseline-report');
const baselineArg = process.argv.indexOf('--baseline');
assert(savedArg >= 0 || baselineArg >= 0, 'Provide a frozen baseline or saved report');
const saved = savedArg >= 0 ? JSON.parse(await readFile(process.argv[savedArg+1], 'utf8')) : null;
const directory = saved ? await mkdtemp(join(tmpdir(), 'nativemind-qa-window-')) : resolve(process.argv[baselineArg+1]);
if (saved) await writeFile(join(directory,'baseline.ts'),saved.baselineSource);
const baselineSource = await readFile(join(directory,'baseline.ts'),'utf8');
await writeFile(join(directory,'baseline-vite.ts'),baselineSource.replaceAll("'../shared/", "'/src/ai/shared/"));
const report = { createdAt:new Date().toISOString(), model:'qwen3:14b', baselineSource,
  currentSource:await readFile('src/ai/rag/self-rag.ts','utf8'), excerptSource:await readFile('src/ai/rag/rerank-excerpt.ts','utf8'), runs:[],
  limitations:'Synthetic fixed retrieved passages. Tests real generation + critic + citation mapping, not initial retrieval, desktop UI, PDF parsing, or general factual correctness. One pass per case per arm, warmed model.' };
const filler = '本节介绍记录版式与目录编排，图表编号沿用章节顺序。'.repeat(72);
const thermal = 'L7试验规定提取温度为43摄氏度，超过该温度会降低回收率。';
const cooling = 'B62样本在装入密封盒前必须冷却17分钟，不能省略此等待步骤。';
const cases = [
  { name:'early-control', query:'根据L7试验记录，提取温度是多少？仅用一句话回答。', text:thermal+filler, expected:'43' },
  { name:'late-temperature', query:'根据L7试验记录，提取温度是多少？仅用一句话回答。', text:filler+thermal, expected:'43' },
  { name:'late-cooling', query:'B62样本装入密封盒前必须冷却多久？仅用一句话回答。', text:filler+cooling, expected:'17' },
  { name:'missing-answer', query:'L7试验的负责人姓名是什么？仅用一句话回答。', text:filler+thermal, expected:null },
];
report.cases=cases;
const vite=await createServer({ server:{ middlewareMode:true,watch:null,hmr:false },appType:'custom',logLevel:'error' });
try {
  const {SelfRag:Baseline}=await vite.ssrLoadModule(join(directory,'baseline-vite.ts'));
  const {SelfRag:Current}=await vite.ssrLoadModule('/src/ai/rag/self-rag.ts');
  const {ModelRouter}=await vite.ssrLoadModule('/src/ai/router/model-router.ts');
  const {OllamaProvider}=await vite.ssrLoadModule('/src/infrastructure/model-runtime/ollama-provider.ts');
  const provider=new OllamaProvider({timeoutMs:90000});
  assert(await provider.isAvailable(report.model));
  console.log('Warming Qwen3:14b; isolated synthetic QA, no database access.');
  await provider.complete({model:report.model,prompt:'Reply OK.',maxTokens:8,temperature:0,signal:AbortSignal.timeout(90000)});
  for (const [index,example] of cases.entries()) for(const label of index%2?['current','baseline']:['baseline','current']) {
    let calls=0;
    const observed={isAvailable:model=>provider.isAvailable(model), complete:request=>{calls++;return provider.complete(request);}};
    const router=new ModelRouter(observed,{resolveModel:()=>report.model});
    const source={chunkId:'c1',noteId:'synthetic',text:example.text,charStart:100,score:0.9,matchedBy:['rule']};
    const qa=new (label==='baseline'?Baseline:Current)(router,{retrieve:async()=>[source]});
    const start=performance.now();
    const result=await qa.ask(example.query,{deep:false,signal:AbortSignal.timeout(180000)});
    const offsetsValid=result.citations.every(c=>example.text.slice(c.charStart-100,c.charStart-100+c.text.length)===c.text);
    const supported=example.expected!==null && result.judged && result.answer.includes(example.expected)
      && result.citations.some(c=>c.text.includes(example.expected)) && offsetsValid;
    const abstained=example.expected===null && result.judged && result.citations.length===0 && result.answer.includes('资料不足');
    const run={case:example.name,label,ms:Math.round(performance.now()-start),calls,pass:supported||abstained,offsetsValid,...result};
    report.runs.push(run);
    await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({case:run.case,label,ms:run.ms,calls,pass:run.pass,judged:run.judged,answer:run.answer,citations:run.citations.length}));
  }
  console.log(`Report: ${join(directory,'report.json')}`);
} finally {await vite.close();}

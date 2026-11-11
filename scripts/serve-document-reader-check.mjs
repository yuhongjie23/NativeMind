// Local manual reader acceptance using real imported text, source anchors and QA citations.
// node scripts/serve-document-reader-check.mjs <isolated-data-dir> <manifest.json>
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const directory = await realpath(process.argv[2]);
assert.equal(dirname(directory).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
assert(basename(directory).startsWith('nativemind-rag-check-'));
const manifest = JSON.parse(await readFile(process.argv[3], 'utf8'));
const notes = await Promise.all(manifest.documents.map((_, i) => readFile(join(directory, `source-${i}.json`), 'utf8').then(JSON.parse)));
const entry = '/document-reader-acceptance.js';
const code = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NoteViewer} from '/src/ui/components/features/NoteViewer.tsx';
const data=await (await fetch('/document-reader-data')).json();
const h=React.createElement;
function App(){
 const [selected,setSelected]=useState(0),[anchor,setAnchor]=useState(undefined);
 const note=data.notes[selected];
 const anchors=data.questions.flatMap(q=>(q.evidence??[]).filter(e=>e.document===selected).map(e=>({label:q.id,text:e.anchor,offset:note.content.indexOf(e.anchor)})));
 const citations=data.results.flatMap(r=>(r.answer?.citations??[]).filter(c=>c.noteId===note.id).map((c,i)=>({label:r.id+' citation '+(i+1),text:c.text,offset:c.charStart})));
 return h('main',null,h('h1',null,'真实长文档阅读验收'),h('p',null,'隔离测试库 · 使用正式 NoteViewer 组件 · 未连接正式用户数据库'),
 h('select',{'aria-label':'测试资料',value:selected,onChange:e=>{setSelected(Number(e.target.value));setAnchor(undefined);}},data.notes.map((n,i)=>h('option',{key:n.id,value:i},n.title))),
 h('p',null,note.content.length+' 字符；'+(note.pageRanges?.length??0)+' PDF 页'),
 h('div',{className:'actions'},[...anchors,...citations].map((a,i)=>h('button',{key:i,onClick:()=>setAnchor(a)},a.label))),
 h('section',{'aria-label':'模型回答与原文'},data.results.filter(r=>r.answer?.citations?.some(c=>c.noteId===note.id)).map(r=>h('article',{key:r.id},
 h('h2',null,r.query),h('p',null,r.answer.answer),r.answer.citations.filter(c=>c.noteId===note.id).map((c,i)=>h('button',{key:i,onClick:()=>setAnchor({label:r.id+' citation '+(i+1),text:c.text,offset:c.charStart})},'查看原文 · '+r.id+' · '+(i+1)))))),
 h('p',null,anchor?'定位：'+anchor.label+'，字符 '+anchor.offset:'点击证据位置，或按 Ctrl+F 搜索'),
 h(NoteViewer,{key:note.id,content:note.content,pageRanges:note.pageRanges,initialCharStart:anchor?.offset,initialAnchor:anchor?.text}));
}createRoot(document.getElementById('root')).render(h(App));`;
const server = await createServer({ server: { host: '127.0.0.1', port: 5329, strictPort: true, watch: null, hmr: false }, plugins: [{
  name: 'local-document-reader-acceptance',
  resolveId(id) { if (id === entry) return '\0document-reader-acceptance.js'; },
  load(id) { if (id === '\0document-reader-acceptance.js') return code; },
  configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/document-reader-data') {
        const report = JSON.parse(await readFile(join(directory, 'pipeline-acceptance.json'), 'utf8'));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ notes, questions: manifest.questions, results: report.results }));
      } else if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(await vite.transformIndexHtml('/index.html', '<!doctype html><html><head><meta charset="utf-8"><title>NativeMind 文档验收</title><style>body{font:16px system-ui;background:#f6f1e5;color:#222;margin:30px}main{max-width:1100px;margin:auto}.actions{display:flex;flex-wrap:wrap;gap:8px}button,select,input{font:inherit;padding:8px}mark{background:#ffe180}p{line-height:1.5}</style></head><body><div id="root"></div><script type="module" src="'+entry+'"></script></body></html>'));
      } else next();
    });
  },
}] });
await server.listen();
console.log('Reader acceptance: http://127.0.0.1:5329');

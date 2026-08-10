/**
 * 真实功能验收（CDP）：启动 runtime、添加任务落库、专注开始/完成（含自动复盘
 * 确认弹窗）、笔记导入与检索、复盘生成、陪伴互动、设置持久化、宠物点击。
 * 用法：node scripts/demo-real-check.mjs <url>
 */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] ?? 'http://localhost:5173/';

const DRIVE = `(async () => {
  const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const dock = (label) => $$('.feature-dock__item').find((b) => b.textContent.includes(label));
  const closeSheet = async () => { document.querySelector('.demo-sheet__close')?.click(); await tick(); };

  // 确认弹窗：出现就点「写入」（批准 AI 建议型写入）
  const approveModal = async () => {
    for (let i = 0; i < 20; i += 1) {
      const btn = $$('.modal-footer button').find((b) => b.textContent.includes('写入'));
      if (btn) { btn.click(); await tick(300); return true; }
      await tick(150);
    }
    return false;
  };

  const setInput = (sel, value) => {
    const el = $(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  // —— 启动完成 ——
  await tick(900);
  out.boot = {
    fullscreen: !!$('.fullscreen-cozy-home'),
    bootError: !!$('.fs-boot-error'),
  };

  // —— 今天：添加任务 ——
  dock('今天')?.click();
  await tick();
  setInput('.cozy-add-task__input', '写一道特征值的证明题');
  await tick();
  $('.cozy-add-task__submit')?.click();
  await tick(700);
  await approveModal(); // 若 AI 拆解建议弹确认
  out.todayAdd = {
    taskInList: $$('.cozy-task-row__text').some((el) => el.textContent.includes('证明题')),
  };

  // —— 从任务启动专注 ——
  $$('.cozy-task-row__focus').find((b) => b.getAttribute('aria-label')?.includes('证明题'))?.click();
  await tick(700);
  out.focusStart = {
    hudActive: $('.focus-hud')?.getAttribute('data-idle') === 'false',
    girl: $('.actor-layer--girl')?.getAttribute('data-action'),
    rootFocusOn: $('.fullscreen-cozy-home')?.getAttribute('data-focus'),
  };

  // —— 完成专注（会触发「自动生成今日复盘」确认弹窗）——
  dock('专注')?.click();
  await tick();
  $$('.cozy-btn-primary').find((b) => b.textContent.includes('完成这段'))?.click();
  await tick(600);
  const modalApproved = await approveModal();
  await tick(400);
  out.focusComplete = {
    autoReviewModalApproved: modalApproved,
    girl: $('.actor-layer--girl')?.getAttribute('data-action'),
    pet: $('.actor-layer--pet')?.getAttribute('data-action'),
    hudIdle: $('.focus-hud')?.getAttribute('data-idle'),
  };
  await closeSheet();

  // —— 复盘：面板生成（若今日已自动生成，再点会复用已有）——
  dock('复盘')?.click();
  await tick(700);
  out.reviewPanel = {
    card: !!$('.cozy-review-card'),
    source: $('.cozy-review-card .cozy-note-card__source')?.textContent ?? '',
    content: $('.cozy-review-card__content')?.textContent?.slice(0, 30) ?? '',
  };
  await closeSheet();

  // —— 知识：导入 + 检索 ——
  dock('知识')?.click();
  await tick();
  setInput('#knowledge-paste', '特征向量是线性变换作用后方向不变的向量。');
  await tick();
  $$('.cozy-btn-primary').find((b) => b.textContent.includes('导入'))?.click();
  await tick(900);
  setInput('.cozy-search__input', '特征向量');
  await tick();
  $('.cozy-search__submit')?.click();
  await tick(900);
  out.knowledge = {
    hitCount: $$('.cozy-hit-list .cozy-note-card').length,
    hitText: $('.cozy-hit-list .cozy-note-card__excerpt')?.textContent?.slice(0, 16) ?? '',
    noteCountHint: $('.cozy-knowledge-hint')?.textContent ?? '',
  };
  await closeSheet();

  // —— 陪伴：叫一下它 ——
  dock('陪伴')?.click();
  await tick();
  $$('.cozy-btn-primary').find((b) => b.textContent.includes('叫一下'))?.click();
  await tick(800);
  out.companion = {
    current: $('.cozy-companion-current__text')?.textContent?.slice(0, 24) ?? '',
    silent: !!$$('.cozy-companion-panel__hint').find((el) => el.textContent.includes('安静')),
    history: $$('.cozy-chat-log__entry').length,
    petPreview: $('.cozy-companion-panel__stage .actor-layer--pet')?.getAttribute('data-action'),
  };
  await closeSheet();

  // —— 设置：切换「允许外部搜索」并读回 ——
  dock('设置')?.click();
  await tick();
  const sw = $$('.cozy-switch-row').find((b) => b.textContent.includes('允许外部搜索'));
  const before = sw?.getAttribute('aria-checked');
  sw?.click();
  await tick(400);
  const after = $$('.cozy-switch-row').find((b) => b.textContent.includes('允许外部搜索'))?.getAttribute('aria-checked');
  out.settings = { before, after, changed: before !== after };
  await closeSheet();

  // —— 场景宠物点击 ——
  const scenePet = $('.scene-viewport .pet-art');
  scenePet?.click();
  await tick(600);
  out.petClick = { clicked: !!scenePet, petAction: $('.actor-layer--pet')?.getAttribute('data-action') };

  return out;
})()`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const chrome = spawn(CHROME, ['--remote-debugging-port=9391', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', 'about:blank']);
try {
  await sleep(1800);
  let wsUrl;
  for (let i = 0; i < 30; i += 1) {
    try {
      const page = (await (await fetch('http://127.0.0.1:9391/json')).json()).find((t) => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* retry */ }
    await sleep(300);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg.result); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const msgId = ++id; pending.set(msgId, { resolve }); ws.send(JSON.stringify({ id: msgId, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1800);
  const result = await send('Runtime.evaluate', { expression: DRIVE, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
} finally { chrome.kill(); }

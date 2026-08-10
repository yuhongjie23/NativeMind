/** 临时校验：路径可编辑输入。 */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const DRIVE = `(async () => {
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const dock = (label) => $$('.feature-dock__item').find((b) => b.textContent.includes(label));
  await tick(900);
  dock('设置')?.click();
  await tick(300);
  const pathGroup = $$('.cozy-settings__group').find((g) => g.querySelector('.cozy-settings__group-title')?.textContent === '路径');
  const rows = $$('.cozy-settings-row', pathGroup);
  const dataRow = rows.find((r) => r.querySelector('.cozy-settings-row__label')?.textContent === '存储地址');
  const resRow = rows.find((r) => r.querySelector('.cozy-settings-row__label')?.textContent === '资源目录');
  out.paths = {
    dataDirEditable: !!dataRow?.querySelector('input'),
    dataDirSave: !!dataRow && $$('.cozy-btn-secondary', dataRow).find((b) => b.textContent.includes('保存')),
    resourceDirEditable: !!resRow?.querySelector('input'),
    resourceDirSave: !!resRow && $$('.cozy-btn-secondary', resRow).find((b) => b.textContent.includes('保存')),
    musicEditable: !!rows.find((r) => r.querySelector('.cozy-settings-row__label')?.textContent === '音乐目录')?.querySelector('input'),
  };
  return out;
})()`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const chrome = spawn(CHROME, ['--remote-debugging-port=9368', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', 'about:blank']);
try {
  await sleep(1800);
  let wsUrl;
  for (let i = 0; i < 30; i += 1) {
    try {
      const page = (await (await fetch('http://127.0.0.1:9368/json')).json()).find((t) => t.type === 'page');
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
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(1600);
  const result = await send('Runtime.evaluate', { expression: DRIVE, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
} finally { chrome.kill(); }

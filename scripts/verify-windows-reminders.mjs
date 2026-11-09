// Opt-in native check: only creates future, uniquely scoped synthetic schedules.
// Every child exits between syncs; finally removes only this run's two IDs.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('This check requires Windows and installed NativeMind.');
const script = await readFile(new URL('../src-tauri/src/learning_notifications.ps1', import.meta.url), 'utf8');
const prefix = `nm${randomBytes(8).toString('hex')}`;
const otherPrefix = `nm${randomBytes(8).toString('hex')}`;
function run(source, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', bytes => { out += bytes.toString('utf8'); });
    child.stderr.on('data', bytes => { err += bytes.toString('utf8'); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Notification check timed out')); }, 25000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(out || err)); else { try { resolve(JSON.parse(out)); } catch { reject(new Error(`Invalid result: ${out} ${err}`)); } } });
    child.stdin.end(JSON.stringify(payload));
  });
}
const sync = reminders => run(script, { prefix, reminders });
const inspect = (group = prefix) => run(`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('com.nativemind.app')
$items = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Group -eq $data.prefix } | ForEach-Object { @{ id = $_.Tag; dueAt = $_.DeliveryTime.ToString('o'); xml = $_.Content.GetXml() } })
@{ items = $items } | ConvertTo-Json -Depth 4 -Compress
`, { prefix: group });
const dueAt = new Date(Date.now() + 3600000).toISOString();
const reminder = { id: randomBytes(8).toString('hex'), title: '测试 <中文> & 边界', dueAt };
try {
  await run(script, { prefix: otherPrefix, reminders: [reminder] });
  assert.equal((await sync([reminder])).scheduled, 1);
  const first = await inspect(); assert.equal(first.items.length, 1);
  assert.ok(first.items[0].xml.includes('&lt;中文&gt; &amp;'));
  assert.equal(Date.parse(first.items[0].dueAt), Date.parse(dueAt));
  const later = { ...reminder, dueAt: new Date(Date.parse(dueAt) + 600000).toISOString() };
  await sync([later]); const snoozed = await inspect();
  assert.equal(snoozed.items.length, 1); assert.equal(Date.parse(snoozed.items[0].dueAt), Date.parse(later.dueAt));
  await sync([later]); assert.equal((await inspect()).items.length, 1);
  const expired = { ...later, dueAt: new Date(Date.now() - 60000).toISOString() };
  await sync([expired]); assert.equal((await inspect()).items.length, 0);
  await sync([later]); assert.equal((await inspect()).items.length, 1);
  await sync([]); assert.equal((await inspect()).items.length, 0);
  assert.equal((await inspect(otherPrefix)).items.length, 1);
  console.log('PASS: child-exit persistence, Unicode/XML, snooze replacement, idempotence, missed delivery suppression, cancellation, data-directory isolation.');
} finally {
  await Promise.all([sync([]), run(script, { prefix: otherPrefix, reminders: [] })]);
  assert.equal((await inspect()).items.length, 0);
  assert.equal((await inspect(otherPrefix)).items.length, 0);
  console.log('Cleaned isolated test schedules.');
}

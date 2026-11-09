import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const runner = pathToFileURL(resolve('anna/local-launch/run-development.mjs')).href;
async function fixture(code: string) {
  const directory = await mkdtemp(join(tmpdir(), 'anna-process-test-'));
  const harness = join(directory, 'harness.mjs');
  await writeFile(harness, `import { runLocalProcess } from ${JSON.stringify(runner)};\n${code}`);
  return { directory, harness };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('Anna local launcher process lifecycle', () => {
  it('preparation closes stdin and preserves the child exit code', async () => {
    const f = await fixture(`process.exitCode = await runLocalProcess(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => { process.exitCode = 7; });"], { quiet: true, timeoutMs: 3000 });`);
    try {
      const result = spawnSync(process.execPath, [f.harness], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(7);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('reports missing commands without leaving signal listeners registered', async () => {
    const f = await fixture(`
      const before = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
      try { await runLocalProcess('nativemind-nonexistent-command-823475', [], { quiet: true }); process.exitCode = 1; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (before !== process.listenerCount('SIGINT') + process.listenerCount('SIGTERM')) process.exitCode = 2;
    `);
    try {
      const result = spawnSync(process.execPath, [f.harness], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform !== 'win32').each(['timeout', 'cancel'])('%s stops only the launcher-owned child and grandchild', async mode => {
    const f = await fixture(`
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const pidFile = join(process.cwd(), 'pids.json');
      const childCode = \
        "const fs = require('node:fs'); const { spawn } = require('node:child_process');" +
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });" +
        "fs.writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid])); setInterval(() => {}, 1000);";
      const mode = ${JSON.stringify(mode)};
      const poll = mode === 'cancel' ? setInterval(() => {
        try { if (JSON.parse(readFileSync(pidFile, 'utf8')).length === 2) { clearInterval(poll); process.emit('SIGINT'); } } catch {}
      }, 20) : undefined;
      try {
        const code = await runLocalProcess(process.execPath, ['-e', childCode, pidFile], { quiet: true, timeoutMs: mode === 'timeout' ? 2000 : 5000 });
        if (mode !== 'cancel' || code !== 130) process.exitCode = 1;
      } catch (error) { if (mode !== 'timeout' || !error.message.includes('超时')) throw error; }
      finally { clearInterval(poll); }
    `);
    let pids: number[] = [];
    try {
      const result = spawnSync(process.execPath, [f.harness], { cwd: f.directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
      pids = JSON.parse(await readFile(join(f.directory, 'pids.json'), 'utf8')) as number[];
      expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
      expect(pids).toHaveLength(2); expect(pids.map(alive)).toEqual([false, false]);
    } finally {
      // These PIDs come exclusively from this test's own child fixture.
      for (const pid of pids) if (Number.isInteger(pid) && pid > 0 && alive(pid)) process.kill(pid);
      await rm(f.directory, { recursive: true, force: true });
    }
  }, 15000);
});

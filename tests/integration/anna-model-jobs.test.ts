import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAnnaInvoke } from '@infrastructure/anna/bridge';
import { runModelJob } from '@infrastructure/anna/model-jobs';

const binary = process.env.NATIVEMIND_ANNA_TEST_BINARY;

describe.skipIf(!binary)('Anna model jobs with a local fake model', () => {
  it('streams before completion, keeps SQLite responsive, cancels the HTTP request and rejects broken streams', async () => {
    await access(binary!);
    const directory = await mkdtemp(join(tmpdir(), 'anna-model-jobs-'));
    const child = spawn(binary!, ['--local-dev'], {
      windowsHide: true, env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: directory },
    });
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    let next = 0;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const reply = JSON.parse(line);
      const waiter = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.error) waiter?.reject(new Error(reply.error.message));
      else if (!reply.result.success) waiter?.reject(new Error(reply.result.error));
      else waiter?.resolve(reply.result.data);
    });
    child.stderr.resume();
    child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
    child.on('exit', () => { for (const waiter of pending.values()) waiter.reject(new Error('Native process exited')); pending.clear(); });
    const invokeFor = (clientId: string) => createAnnaInvoke({ windowUuid: clientId, tools: {
      invoke: ({ method, args }) => new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'invoke', params: { tool: method, arguments: args } }) + '\n');
      }),
    } }, 'local-test');
    const invoke = invokeFor('test-window');
    let closed = false;
    let ended = false;
    let requests = 0;
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      requests += 1;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (input.prompt === 'error') { res.end('{"error":"fake model failure"}\n'); return; }
      if (input.prompt === 'truncated') { res.end('{"response":"unfinished"}\n'); return; }
      // Split inside a Chinese UTF-8 character to exercise byte-safe decoding.
      const first = Buffer.from(JSON.stringify({ response: '你好', done: false }) + '\n');
      const split = first.indexOf(Buffer.from('你')) + 1;
      res.write(first.subarray(0, split));
      const fragment = setTimeout(() => res.write(first.subarray(split)), 20);
      const finish = setTimeout(() => {
        ended = true;
        res.end(JSON.stringify({ response: '世界', done: true }) + '\n');
      }, input.prompt === 'cancel' ? 30_000 : 800);
      res.on('close', () => { closed = true; clearTimeout(fragment); clearTimeout(finish); });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No model test port');
    const payload = (prompt: string) => ({ request: { model: 'qwen3:14b', prompt, base_url: `http://127.0.0.1:${address.port}` } });
    try {
      const deltas: string[] = [];
      const result = runModelJob<string>(invoke, 'model_complete', payload('complete'), {
        onToken: (delta) => { deltas.push(delta); if (deltas.length === 1) expect(ended).toBe(false); },
      });
      await expect.poll(() => deltas.length, { timeout: 3000 }).toBeGreaterThan(0);
      expect(await invoke('db_select', { sql: 'SELECT 42 AS value', params: [] })).toEqual([{ value: 42 }]);
      expect(ended).toBe(false);
      expect(await result).toBe('你好世界');
      expect(deltas.join('')).toBe('你好世界');

      closed = false;
      const controller = new AbortController();
      const cancelled = runModelJob(invoke, 'model_complete', payload('cancel'), {
        signal: controller.signal, onToken: () => controller.abort(),
      });
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      await expect.poll(() => closed).toBe(true);
      expect(requests).toBe(2);
      expect(await invoke('db_select', { sql: 'SELECT 1 AS alive', params: [] })).toEqual([{ alive: 1 }]);
      for (const [prompt, message] of [['error', 'fake model failure'], ['truncated', '模型输出中断']]) {
        await expect(runModelJob(invoke, 'model_complete', payload(prompt))).rejects.toThrow(message);
      }
      const id = crypto.randomUUID();
      await invoke('model_job_start', { id, command: 'model_complete', payload: payload('cancel') });
      await expect(invokeFor('different-window')('model_job_cancel', { id })).rejects.toThrow('ANNA_WINDOW_BUSY');
      await invoke('model_job_cancel', { id });
      await expect(invoke('model_job_poll', { id })).rejects.toThrow('已结束');
      const aborted = AbortSignal.abort();
      await expect(runModelJob(invoke, 'model_complete', payload('complete'), { signal: aborted })).rejects.toMatchObject({ name: 'AbortError' });
      closed = false;
      const beforeHandoff = requests;
      const orphan = crypto.randomUUID();
      await invoke('model_job_start', { id: orphan, command: 'model_complete', payload: payload('cancel') });
      await expect.poll(() => requests).toBeGreaterThan(beforeHandoff);
      await invoke('native_disconnect');
      await expect.poll(() => closed).toBe(true);
      const replacement = invokeFor('replacement-window');
      expect(await replacement('db_select', { sql: 'SELECT 3 AS alive', params: [] })).toEqual([{ alive: 3 }]);
      await expect(replacement('model_job_poll', { id: orphan })).rejects.toThrow('已结束');
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exit = once(child, 'exit');
        child.stdin.end();
        await exit;
      }
      lines.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

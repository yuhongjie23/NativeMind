import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createAnnaInvoke, type AnnaHost } from '@infrastructure/anna';
import { createAnnaConnection } from '@infrastructure/anna/connection';
import { createTauriRuntime } from '@infrastructure/tauri-runtime';
import { Database } from '@infrastructure/db/database';
import { TauriSqlDriver } from '@infrastructure/db/tauri-driver';
import { MIGRATIONS } from '@infrastructure/db/migrations';
import type { CompanionInteraction } from '@application/ports';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';
import { isFileJob, runFileJob } from '@infrastructure/anna/file-jobs';
import { textPdf } from './fixtures/text-pdf';
import { verifyImportTransactions } from './fixtures/import-transaction';
import { verifyVectorMetricMigration } from './fixtures/vector-metric';
import { verifyRetryNoteIndex } from './fixtures/retry-note-index';
import { verifyReindexEditedNote } from './fixtures/reindex-edited-note';
import { verifyIndexFailureStatus } from './fixtures/index-failure-status';
import { verifyEmbeddingVersion } from './fixtures/embedding-version';

const binary = process.env.NATIVEMIND_ANNA_TEST_BINARY;
const launcher = process.env.NATIVEMIND_ANNA_TEST_LAUNCHER;

/** Explicit opt-in: ordinary npm test needs neither Tauri, Ollama nor a compiled binary. */
describe.skipIf(!binary)('Anna native desktop core integration', () => {
  it.skipIf(!launcher)('launches the packaged tool through its Node entry without source code', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'anna-packaged-launch-'));
    try {
      const result = spawnSync(process.execPath, [launcher!], {
        cwd: tmpdir(), windowsHide: true, encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: dataDirectory },
        input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'invoke', params: {
          tool: 'native_command', arguments: { clientId: 'package-smoke', command: 'native_status', args: {} },
        } }) + '\n',
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const reply = JSON.parse(result.stdout.trim());
      expect(reply).toMatchObject({ id: 1, result: { success: true, data: { value: { publishReady: false, vector: { available: true } } } } });
      expect(reply.result.data.value.vector).not.toHaveProperty('loadedFrom');
      expect(await readdir(dataDirectory)).toContain('nativemind.db');
      if (process.platform === 'win32') {
        const profile = join(dataDirectory, 'isolated-launch-profile');
        const checked = spawnSync(process.execPath, [join(dirname(dirname(dirname(launcher!))), 'start-local.mjs'), '--check', '--data-dir', dataDirectory], {
          cwd: tmpdir(), windowsHide: true, encoding: 'utf8', timeout: 15000,
          env: { ...process.env, LOCALAPPDATA: profile, NATIVEMIND_ANNA_DATA_DIR: '' },
        });
        expect(checked.status, checked.stderr).toBe(0);
        expect(checked.stdout).toContain('将使用已有学习库');
        expect(checked.stdout).toContain('没有创建目录');
        expect(await readdir(dataDirectory)).not.toContain('isolated-launch-profile');
      }
    } finally { await rm(dataDirectory, { recursive: true, force: true }); }
  }, 25000);
  it('refuses production invocation or an implicit/relative data directory', () => {
    const env = { ...process.env };
    delete env.NATIVEMIND_ANNA_DATA_DIR;
    const noFlag = spawnSync(binary!, [], { env, encoding: 'utf8', windowsHide: true });
    expect(noFlag.status).not.toBe(0);
    expect(noFlag.stderr).toContain('local-development only');
    for (const value of [undefined, 'relative-data']) {
      if (value !== undefined) env.NATIVEMIND_ANNA_DATA_DIR = value;
      const result = spawnSync(binary!, ['--local-dev'], { env, encoding: 'utf8', windowsHide: true });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('absolute');
    }
  });
  it('runs the real migrations/use cases and survives a native-process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nativemind-anna-test-'));
    // Run from a relocated binary and unrelated working directory. Resource lookup
    // must not fall back to a compile-time checkout path or depend on the caller's cwd.
    const relocatedBin = join(directory, '移动后的程序');
    const unrelatedCwd = join(directory, 'unrelated-cwd');
    await mkdir(relocatedBin);
    await mkdir(unrelatedCwd);
    const relocatedBinary = join(relocatedBin, basename(binary!));
    await copyFile(binary!, relocatedBinary);
    await cp(join(dirname(binary!), 'resources'), join(relocatedBin, 'resources'), { recursive: true });
    const connect = (dataDirectory = directory) => {
      const child = spawn(relocatedBinary, ['--local-dev'], {
        cwd: unrelatedCwd,
        env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: dataDirectory }, windowsHide: true,
      });
      let next = 0;
      const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const reply = JSON.parse(line) as { id: number; result: unknown; error?: { message: string } };
        const wait = pending.get(reply.id);
        pending.delete(reply.id);
        if (reply.error) wait?.reject(new Error(reply.error.message));
        else wait?.resolve(reply.result);
      });
      child.stderr.resume();
      child.on('error', (error) => { for (const wait of pending.values()) wait.reject(error); pending.clear(); });
      child.on('exit', () => { for (const wait of pending.values()) wait.reject(new Error('Native process exited')); pending.clear(); });
      const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
      const host: AnnaHost = {
        windowUuid: 'integration-window',
        tools: { invoke: async ({ method, args }) => {
          const result = await request('invoke', { tool: method, arguments: args }) as { success: boolean; data?: unknown; error?: string };
          if (!result.success) throw new Error(result.error);
          return result.data;
        } },
      };
      const invoke = createAnnaInvoke(host, 'tool-dev-nativemind');
      // Match the production Anna bridge's extraction route, including job cleanup.
      const runtimeInvoke: TauriInvoke = (command, args, options) => isFileJob(command)
        ? runFileJob(invoke, command, args, options?.signal)
        : invoke(command, args);
      const runtime = createTauriRuntime({ invoke: runtimeInvoke, streaming: false, localOnly: true, confirmationPrompt: async () => false });
      return { invoke, runtime, raw: (args: Record<string, unknown>) => host.tools.invoke({ tool_id: 'tool-dev-nativemind', method: 'native_command', args }), connectionFor: (clientId: string) => createAnnaConnection({ ...host, windowUuid: clientId }, 'tool-dev-nativemind'), close: async () => {
        if (child.exitCode !== null || child.signalCode !== null) { lines.close(); return; }
        const exit = once(child, 'exit');
        child.stdin.end();
        await exit;
        lines.close();
      } };
    };
    const partials = join(directory, 'imports', '.pending');
    await mkdir(partials, { recursive: true });
    await writeFile(join(partials, 'stale.txt'), 'abandoned');
    await writeFile(join(partials, 'recent.txt'), 'active');
    const yesterday = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(join(partials, 'stale.txt'), yesterday, yesterday);
    await mkdir(join(partials, 'keep-directory'));
    let active = connect();
    try {
      const status = await active.invoke<{ vector: { available: boolean; loadedFrom: string } }>('native_status');
      const firstLease = await active.invoke<{ leaseToken: string; protocolVersion: number }>('native_connect');
      expect(firstLease.protocolVersion).toBe(2);
      expect(firstLease.leaseToken).toMatch(/^[a-f0-9]{64}$/);
      expect(status).toMatchObject({ database: 'sqlite', publishReady: false, vector: { available: true } });
      // Window identity is not a credential: it must not reveal another lease.
      await expect(active.raw({ clientId: 'integration-window', command: 'native_connect', args: {} })).rejects.toThrow('ANNA_WINDOW_BUSY');
      for (const command of ['db_select', 'db_execute', 'native_disconnect', 'native_heartbeat']) {
        await expect(active.raw({ clientId: 'integration-window', leaseToken: '1', command, args: { sql: 'SELECT 1', params: [] } })).rejects.toThrow('ANNA_SESSION_EXPIRED');
      }
      const publicStatus = await active.raw({ clientId: 'untrusted-window', command: 'native_status', args: {} });
      expect(publicStatus).toMatchObject({ value: { publishReady: false } });
      expect(JSON.stringify(publicStatus)).not.toContain(directory);
      expect(publicStatus).not.toHaveProperty('value.vector.loadedFrom');
      const storage = await active.invoke<{ path: string; writable: boolean }>('storage_check');
      expect(storage.writable).toBe(true);
      expect(normalize(storage.path)).toBe(normalize(directory));
      expect((await readdir(directory)).some(name => name.startsWith('.nativemind-check-'))).toBe(false);
      const duplicateProcess = spawnSync(relocatedBinary, ['--local-dev'], {
        cwd: unrelatedCwd, windowsHide: true, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: directory }, input: '',
      });
      expect(duplicateProcess.error).toBeUndefined();
      expect(duplicateProcess.status).not.toBe(0);
      expect(duplicateProcess.stderr).toContain('无法独占 Anna 数据目录');
      expect(normalize(dirname(status.vector.loadedFrom))).toBe(join(relocatedBin, 'resources'));
      expect((await readdir(partials)).sort()).toEqual(['keep-directory', 'recent.txt']);
      for (const url of ['http://localhost:11434/api/tags', 'https://127.0.0.1/', 'https://example.com/', 'https://www.bing.com@127.0.0.1/', 'https://www.bing.com:444/']) {
        await expect(active.invoke('search_fetch', {url})).rejects.toThrow('搜索引擎');
      }
      // Upgrade a real v21 database, including all historical conversation metadata.
      await new Database(new TauriSqlDriver(active.invoke), MIGRATIONS.filter(m => m.version <= 21)).migrate();
      await active.invoke('db_execute', { sql: "INSERT INTO review_logs(id,review_type,date,content,insights,next_todos,created_at,updated_at) VALUES('legacy-review','daily','2000-01-01','历史复盘','[]','[]','2000-01-01','2000-01-01')", params: [] });
      const oldInteraction: CompanionInteraction = {
        id: 'old-message', companionId: 'fulilian', sceneType: 'feedback',
        triggerEvent: 'user:reply', interactionType: 'dialogue', content: '历史正文',
        userResponse: '历史回复', animationName: 'idle', requiresResponse: true,
        conversationId: 'old-conversation', replyToId: 'old-question', turnIndex: 2,
        initiator: 'user', status: 'answered', role: 'user', createdAt: new Date().toISOString(),
      };
      await active.runtime.repositories.companionInteraction.create(oldInteraction);
      await expect(active.runtime.repositories.companionInteraction.create({ ...oldInteraction, id: 'health-before', sceneType: 'health_reminder' })).rejects.toThrow('CHECK');
      for (const id of ['old-no-job', 'old-has-job', 'old-indexed']) {
        await active.invoke('db_execute', { sql: 'INSERT INTO notes(id,title,content,content_hash,index_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          params: [id, id, id, id, id === 'old-indexed' ? 'indexed' : 'pending', '2026-01-01', '2026-01-01'] });
      }
      await active.invoke('db_execute', { sql: "INSERT INTO background_jobs(id,job_type,entity_type,entity_id,status,created_at) VALUES('old-job','parse_note','note','old-has-job','failed','2026-01-01')", params: [] });
      await active.runtime.infrastructure.initialize();
      const learning = active.runtime.application.useCases;
      const recall = await learning.trackKnowledge!.record({ title: '原生重启自评', rating: 'forgotten', difficulty: '边界条件', result: '合上书未能复述' });
      const learningReminder = await learning.learningReminders!.create({ title: '原生重启提醒', kind: 'review', repeat: 'daily', dueAt: new Date(Date.now() + 3600000).toISOString(), knowledgeId: recall.id });
      await learning.learningReminders!.act(learningReminder.id, 'snooze', 1, new Date(Date.now() + 7200000).toISOString());
      expect(await active.runtime.repositories.review.findById('legacy-review')).toMatchObject({ content: '历史复盘', evidence: undefined });
      expect(await active.invoke('db_select', { sql: "SELECT entity_id, job_type, status FROM background_jobs WHERE entity_id LIKE 'old-%' ORDER BY entity_id", params: [] }))
        .toEqual([{ entity_id: 'old-has-job', job_type: 'parse_note', status: 'failed' }, { entity_id: 'old-indexed', job_type: 'chunk_note', status: 'pending' }, { entity_id: 'old-no-job', job_type: 'chunk_note', status: 'pending' }]);
      await verifyImportTransactions(active.runtime, active.invoke);
      await verifyRetryNoteIndex(active.runtime, active.invoke);
      await verifyReindexEditedNote(active.runtime, active.invoke);
      await verifyIndexFailureStatus(active.runtime, active.invoke);
      await verifyEmbeddingVersion(active.runtime.infrastructure.db);
      expect(await active.runtime.repositories.companionInteraction.findById(oldInteraction.id)).toEqual(oldInteraction);
      const health = { ...oldInteraction, id: 'health-after', sceneType: 'health_reminder' };
      await active.runtime.repositories.companionInteraction.create(health);
      expect(await active.runtime.repositories.companionInteraction.findLastByScene('health_reminder')).toEqual(health);
      expect(await active.runtime.repositories.companionInteraction.countTodayByScene('health_reminder')).toBe(1);
      await expect(active.runtime.repositories.companionInteraction.create({ ...health, id: 'bad-scene', sceneType: 'unknown_scene' })).rejects.toThrow('CHECK');
      const indexes = await active.invoke<{ name: string }[]>('db_select', { sql: 'PRAGMA index_list(companion_interactions)', params: [] });
      expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(['idx_companion_interactions_created_at', 'idx_companion_interactions_scene_type', 'idx_companion_interactions_type_created']));
      expect(await new Database(new TauriSqlDriver(active.invoke)).migrate()).toEqual([]);
      // SQL authorization must confine file access even through parameters, comments,
      // mixed case and read commands. No model or network is needed for these checks.
      const escapedDb = join(directory, 'escaped.db');
      for (const sql of ['/* probe */ AtTaCh DATABASE ? AS other', 'VACUUM INTO ?']) {
        await expect(active.invoke('db_execute', { sql, params: [escapedDb] })).rejects.toThrow();
      }
      for (const sql of ['PRAGMA writable_schema=ON', 'PRAGMA temp_store_directory=\'.\'', 'PRAGMA foreign_keys=OFF', 'SELECT load_extension(\'untrusted\')', 'SELECT vec_npy_file(\'private.npy\')']) {
        await expect(active.invoke('db_execute', { sql, params: [] })).rejects.toThrow();
      }
      expect(await readdir(directory)).not.toContain('escaped.db');
      const todo = await active.runtime.application.useCases.createTodo.execute({ title: 'Anna 中的真实任务' });
      const reviewStamp = new Date().toISOString();
      await active.runtime.repositories.review.save({ id: 'review-follow-up-check', reviewType: 'daily', date: '2026-11-06', content: '合成复盘', insights: ['完成阅读'], nextTodos: ['回顾合成材料'],
        evidence: { observations: [{ text: '完成阅读', evidenceIds: ['task:test'] }], suggestions: [], sources: [{ id: 'task:test', kind: 'task', description: '生成时快照' }], limitations: [] },
        createdAt: reviewStamp, updatedAt: reviewStamp });
      const [adopted, repeatedAdoption] = await Promise.all([
        active.runtime.application.useCases.adoptReviewSuggestion.execute('review-follow-up-check', '回顾合成材料'),
        active.runtime.application.useCases.adoptReviewSuggestion.execute('review-follow-up-check', '回顾合成材料'),
      ]);
      expect(adopted.todoId).toBe(repeatedAdoption.todoId);
      await active.runtime.application.useCases.completeTodo.execute(adopted.todoId!);
      expect((await active.runtime.repositories.review.listFollowUps())[0].status).toBe('completed');
      await expect(active.invoke('db_select', { sql: 'DELETE FROM todos RETURNING id', params: [] })).rejects.toThrow('read-only');
      expect(await active.runtime.repositories.todo.findById(todo.id)).not.toBeNull();
      // Exercise FTS directly so a silently falling-back search cannot mask a policy regression.
      await active.invoke('db_execute', { sql: "CREATE VIRTUAL TABLE policy_fts USING fts5(text); INSERT INTO policy_fts VALUES ('local learning')", params: [] });
      expect(await active.invoke('db_select', { sql: "SELECT text FROM policy_fts WHERE policy_fts MATCH ?", params: ['learning'] })).toEqual([{ text: 'local learning' }]);
      await active.invoke('db_execute', { sql: 'DROP TABLE policy_fts', params: [] });
      await verifyVectorMetricMigration(new TauriSqlDriver(active.invoke));
      // Fixed vectors validate sqlite-vec authorization without downloading an embedding model.
      await active.invoke('db_execute', { sql: 'CREATE VIRTUAL TABLE policy_vec USING vec0(embedding float[2])', params: [] });
      await active.invoke('db_execute', { sql: 'INSERT INTO policy_vec(rowid, embedding) VALUES (?, vec_f32(?))', params: [1, '[1,0]'] });
      expect(await active.invoke('db_select', { sql: 'SELECT rowid, distance FROM policy_vec WHERE embedding MATCH vec_f32(?) AND k = 1', params: ['[1,0]'] })).toEqual([{ rowid: 1, distance: 0 }]);
      await active.invoke('db_execute', { sql: 'DROP TABLE policy_vec', params: [] });
      const focus = await active.runtime.application.useCases.startFocus.execute({ todoId: todo.id, durationMinutes: 25 });
      expect(active.runtime.application.policies.focus.isActive()).toBe(true);
      await active.runtime.application.useCases.completeFocus.execute(focus.id);
      expect(active.runtime.application.policies.focus.isActive()).toBe(false);
      const note = await active.runtime.application.useCases.importNote.execute({ kind: 'text', content: '真实笔记正文', title: '学习笔记' });
      let committed = false;
      const rejected = await active.runtime.application.confirmation.confirmAndCommit({
        actionType: 'create_todos', summary: '拒绝 AI 建议', payload: {},
      }, async () => { committed = true; });
      expect(rejected.confirmed).toBe(false);
      expect(committed).toBe(false);
      await expect(active.invoke('file_read_text', { path: join(directory, '..', 'private.txt') })).rejects.toThrow();
      const documentPath = await active.invoke<string>('file_stage', { name: 'parse-job.txt', kind: 'document', offset: 0, bytes: Array.from(new TextEncoder().encode('真实后台解析正文')), complete: true });
      const fileJobId = crypto.randomUUID();
      await active.invoke('file_job_start', { id: fileJobId, command: 'file_read_text', payload: { path: documentPath } });
      expect(await active.invoke('db_integrity_check')).toBe('ok');
      let parsed: { done: boolean; value?: string } = { done: false };
      for (let i = 0; i < 100 && !parsed.done; i++) {
        parsed = await active.invoke('file_job_poll', { id: fileJobId });
        if (!parsed.done) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(parsed).toEqual({ done: true, value: '真实后台解析正文' });
      await active.invoke('file_job_cancel', { id: fileJobId });
      await expect(active.invoke('file_job_poll', { id: fileJobId })).rejects.toThrow();
      await active.invoke('file_job_cancel', { id: fileJobId });
      await expect(active.invoke('file_job_start', { id: crypto.randomUUID(), command: 'file_read_text', payload: { path: join(partials, 'recent.txt') } })).rejects.toThrow();
      await expect(active.invoke('file_job_start', { id: crypto.randomUUID(), command: 'file_read_text', payload: { path: join(directory, '..', 'private.txt') } })).rejects.toThrow();
      const beforeEmptyImports = await active.invoke('db_select', { sql: 'SELECT count(*) AS count FROM notes', params: [] });
      const emptyDocuments = [
        { name: 'empty.txt', bytes: new TextEncoder().encode(' \n\t'), message: '导入内容为空' },
        { name: 'metadata-only.md', bytes: new TextEncoder().encode('---\ntitle: Empty\n---\n'), message: '导入内容为空' },
        { name: 'no-text.pdf', bytes: textPdf([[]]), message: '本机进行文字识别' },
        { name: 'broken.pdf', bytes: new TextEncoder().encode('not a pdf'), message: 'PDF 解析失败' },
      ];
      for (const fixture of emptyDocuments) {
        const path = await active.invoke<string>('file_stage', { name: fixture.name, kind: 'document', offset: 0, bytes: Array.from(fixture.bytes), complete: true });
        await expect(active.runtime.application.useCases.importNote.execute({ kind: 'path', path })).rejects.toThrow(fixture.message);
        expect(await active.invoke('db_select', { sql: 'SELECT count(*) AS count FROM notes', params: [] })).toEqual(beforeEmptyImports);
      }
      // After failures, all worker slots must be reusable and repeated body text survives.
      const repeatedPdf = textPdf(Array.from({ length: 3 }, () => Array.from({ length: 10 }, () => 'Repeated study sentence.')));
      const repeatedPath = await active.invoke<string>('file_stage', { name: 'repeated.pdf', kind: 'document', offset: 0, bytes: Array.from(repeatedPdf), complete: true });
      const importedPdf = await active.runtime.application.useCases.importNote.execute({ kind: 'path', path: repeatedPath });
      expect(importedPdf.content.match(/Repeated study sentence\./g)).toHaveLength(18);
      expect(importedPdf.pageRanges).toHaveLength(3);
      // Exercise the actual packaged worker processes: two jobs consume both slots,
      // cancellation ends their OS processes, and a subsequent import can proceed.
      const largePdf = textPdf(Array.from({ length: 1000 }, (_, page) => Array.from({ length: 40 }, (_, line) => `Study page ${page} line ${line}.`)));
      for (let offset = 0; offset < largePdf.length; offset += 65536) {
        await active.invoke('file_stage', { name: 'cancel-process.pdf', kind: 'document', offset, bytes: Array.from(largePdf.slice(offset, offset + 65536)), complete: false });
      }
      const largePath = await active.invoke<string>('file_stage_commit', { name: 'cancel-process.pdf', kind: 'document', size: largePdf.length });
      const workers: { id: string; workerPid: number }[] = [];
      for (let i = 0; i < 2; i++) {
        workers.push(await active.invoke('file_job_start', { id: crypto.randomUUID(), command: 'file_extract_pdf', payload: { path: largePath } }));
      }
      expect(await active.invoke('db_integrity_check')).toBe('ok');
      await expect(active.invoke('file_job_start', { id: crypto.randomUUID(), command: 'file_extract_pdf', payload: { path: largePath } })).rejects.toThrow('仍在处理');
      for (const worker of workers) await active.invoke('file_job_cancel', { id: worker.id });
      const isAlive = (pid: number) => {
        try { process.kill(pid, 0); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
      };
      for (let attempt = 0; attempt < 100 && workers.some(worker => isAlive(worker.workerPid)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(workers.map(worker => isAlive(worker.workerPid))).toEqual([false, false]);
      for (const worker of workers) await expect(active.invoke('file_job_poll', { id: worker.id })).rejects.toThrow('已取消');
      expect(await active.invoke('db_select', { sql: 'SELECT id FROM notes WHERE source_uri = ?', params: [largePath] })).toEqual([]);
      const retry = await active.runtime.application.useCases.importNote.execute({ kind: 'path', path: repeatedPath });
      expect(retry.id).toBe(importedPdf.id);
      // Reclaim only tracked, aged copies on restart. Referenced, edited, fresh,
      // legacy and malformed-ticket files must survive even when other copies expire.
      const tickets = join(directory, 'imports', '.unclaimed');
      const staleCopies: Record<string, string> = {};
      for (const name of ['unused.txt', 'edited.txt', 'fresh.txt', 'bad-ticket.txt']) {
        staleCopies[name] = await active.invoke<string>('file_stage', { name, kind: 'document', offset: 0, bytes: [65], complete: true });
        if (name !== 'fresh.txt') await utimes(join(tickets, `${name}.json`), yesterday, yesterday);
      }
      await writeFile(staleCopies['edited.txt'], 'edited after copy');
      await writeFile(join(tickets, 'bad-ticket.txt.json'), 'not JSON');
      await utimes(join(tickets, 'bad-ticket.txt.json'), yesterday, yesterday);
      await utimes(join(tickets, 'repeated.pdf.json'), yesterday, yesterday);
      await writeFile(join(directory, 'imports', 'legacy.txt'), 'untracked file');
      await utimes(join(directory, 'imports', 'legacy.txt'), yesterday, yesterday);
      // Even alternative path separators must be recognized as the same source.
      await active.invoke('db_execute', { sql: 'UPDATE notes SET source_uri = ? WHERE id = ?', params: [repeatedPath.replace(/\\/g, '/'), importedPdf.id] });
      await active.close();
      active = connect();
      await active.runtime.infrastructure.initialize();
      await expect(active.raw({ clientId: 'integration-window', leaseToken: firstLease.leaseToken, command: 'db_execute', args: { sql: 'DELETE FROM learning_reminders', params: [] } })).rejects.toThrow('ANNA_SESSION_EXPIRED');
      await expect(active.raw({ clientId: 'integration-window', leaseToken: firstLease.leaseToken, command: 'native_connect', args: {} })).rejects.toThrow('ANNA_SESSION_EXPIRED');
      expect(await readdir(join(directory, 'imports'))).not.toContain('unused.txt');
      expect((await active.runtime.application.useCases.learningReminders!.list()).find(item => item.id === learningReminder.id)).toMatchObject({ revision: 2, state: 'scheduled', knowledgeId: recall.id, history: [{ action: 'snooze', at: expect.any(String), previousDueAt: expect.any(String) }] });
      expect((await active.runtime.application.useCases.trackKnowledge!.list()).find(item => item.id === recall.id)?.observations[0]).toMatchObject({ rating: 'forgotten', difficulty: '边界条件' });
      expect((await active.runtime.repositories.review.findById('review-follow-up-check'))?.evidence?.sources[0].description).toBe('生成时快照');
      expect((await active.runtime.repositories.review.listFollowUps())[0]).toMatchObject({ todoId: adopted.todoId, status: 'completed' });
      expect(await readdir(tickets)).not.toContain('unused.txt.json');
      expect(await readdir(tickets)).not.toContain('repeated.pdf.json');
      expect((await readFile(repeatedPath)).length).toBe(repeatedPdf.length);
      expect(await readFile(staleCopies['edited.txt'], 'utf8')).toBe('edited after copy');
      expect(await readFile(staleCopies['fresh.txt'], 'utf8')).toBe('A');
      expect(await readFile(staleCopies['bad-ticket.txt'], 'utf8')).toBe('A');
      expect(await readFile(join(directory, 'imports', 'legacy.txt'), 'utf8')).toBe('untracked file');
      const audioBytes = Array.from({ length: 65536 }, (_, i) => i % 256);
      const audioName = '123_中文音乐.wav';
      const audioPath = await active.invoke<string>('file_stage', { name: audioName, kind: 'audio', offset: 0, bytes: audioBytes, complete: false });
      // Partial writes are neither listed nor playable, including attempts to address .pending.
      expect(await active.invoke('audio_list_music')).toEqual([]);
      await expect(active.invoke('audio_read_chunk', { path: audioPath, offset: 0 })).rejects.toThrow();
      await expect(active.invoke('audio_read_chunk', { path: join(directory, 'music', '.pending', audioName), offset: 0 })).rejects.toThrow();
      await expect(active.invoke('file_stage', { name: audioName, kind: 'audio', offset: 1, bytes: [1], complete: true })).rejects.toThrow('offset');
      await active.invoke('file_stage', { name: audioName, kind: 'audio', offset: 65536, bytes: [255, 128, 1], complete: false });
      await expect(active.invoke('file_stage_commit', { name: audioName, kind: 'audio', size: 1 })).rejects.toThrow('size');
      expect(await active.invoke('audio_list_music')).toEqual([]);
      await active.invoke('file_stage_commit', { name: audioName, kind: 'audio', size: 65539 });
      // Abort is idempotent and cannot delete the successfully committed file.
      await active.invoke('file_stage_abort', { name: audioName, kind: 'audio' });
      expect(await active.invoke('audio_list_music')).toEqual([{ path: audioPath, name: '中文音乐.wav', sizeBytes: 65539 }]);
      expect(await active.invoke('audio_read_chunk', { path: audioPath, offset: 0 })).toEqual({ bytes: [...audioBytes, 255, 128, 1], size: 65539 });
      for (const kind of ['audio', 'document']) {
        const name = kind === 'audio' ? 'cancelled.wav' : 'cancelled.txt';
        await active.invoke('file_stage', { name, kind, offset: 0, bytes: [1, 2], complete: false });
        await active.invoke('file_stage_abort', { name, kind });
        await active.invoke('file_stage_abort', { name, kind });
        const base = join(directory, kind === 'audio' ? 'music' : 'imports');
        expect(await readdir(join(base, '.pending'))).not.toContain(name);
        expect(await readdir(base)).not.toContain(name);
        await expect(active.invoke('file_stage_commit', { name, kind, size: 2 })).rejects.toThrow();
      }
      await expect(active.invoke('file_stage_abort', { name: '../private.mp3', kind: 'audio' })).rejects.toThrow();
      await writeFile(join(directory, 'private.mp3'), 'not imported');
      await expect(active.invoke('audio_read_chunk', { path: join(directory, 'private.mp3'), offset: 0 })).rejects.toThrow();
      await expect(active.invoke('file_stage', { name: '../escape.wav', kind: 'audio', offset: 0, bytes: [1] })).rejects.toThrow();
      await expect(active.invoke('file_stage', { name: 'invalid.exe', kind: 'audio', offset: 0, bytes: [1] })).rejects.toThrow();
      await expect(active.invoke('file_stage', { name: 'overflow.wav', kind: 'audio', offset: Number.MAX_SAFE_INTEGER, bytes: [1] })).rejects.toThrow();
      const backup = await active.invoke<string>('db_backup');
      const later = await active.runtime.application.useCases.createTodo.execute({ title: '备份之后才新增' });
      const restoredDirectory = await mkdtemp(join(directory, 'restored-'));
      await copyFile(backup, join(restoredDirectory, 'nativemind.db'));
      const restored = connect(restoredDirectory);
      try {
        await restored.runtime.infrastructure.initialize();
        expect(await restored.runtime.repositories.todo.findById(todo.id)).toMatchObject({ title: 'Anna 中的真实任务' });
        expect(await restored.runtime.repositories.todo.findById(later.id)).toBeNull();
        expect(await restored.invoke('db_integrity_check')).toBe('ok');
      } finally { await restored.close(); }
      for (let i = 0; i < 8; i++) await active.invoke('db_backup');
      expect((await readdir(join(directory, 'backups'))).filter((name) => name.endsWith('.bak'))).toHaveLength(7);
      await writeFile(join(directory, 'imports', 'source-note.txt'), '备份中的源文件');
      await active.invoke('db_execute', { sql: 'UPDATE notes SET source_uri = ? WHERE id = ?', params: [join(directory, 'imports', 'source-note.txt'), note.id] });
      for (const [key, value] of Object.entries({
        'focus.musicFile': audioPath,
        'ambient.filesByWeather': JSON.stringify({ rain: audioPath }),
        'paths.readDirs': JSON.stringify([join(directory, 'imports')]),
      })) await active.invoke('db_execute', { sql: 'INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)', params: [key, value, new Date().toISOString()] });
      const completeBackup = await active.invoke<{id:string;path:string}>('data_export_local');
      expect(await readdir(join(completeBackup.path, 'music'))).toContain(audioName);
      expect(await active.invoke('data_list_exports')).toContainEqual(completeBackup);
      await expect(active.invoke('data_restore_local', {id:'../private'})).rejects.toThrow();
      const afterExport = await active.runtime.application.useCases.createTodo.execute({title:'完整备份之后的新任务'});
      await writeFile(join(directory, 'imports', 'source-note.txt'), '修改后的源文件');
      await unlink(audioPath);
      const restore = await active.invoke<{safety:{path:string}}>('data_restore_local', {id:completeBackup.id});
      expect(await active.invoke('data_restore_status')).toMatchObject({ state: 'pending', backupId: completeBackup.id });
      expect(await readdir(restore.safety.path)).toContain('nativemind.db');
      await expect(active.invoke('db_execute', {sql:'DELETE FROM todos', params:[]})).rejects.toThrow('重启');
      await active.close();
      active = connect();
      await active.runtime.infrastructure.initialize();
      expect(await active.invoke('data_restore_status')).toMatchObject({ state: 'restored', backupId: completeBackup.id, safety: restore.safety });
      expect((await active.runtime.repositories.review.listFollowUps())[0]).toMatchObject({ todoId: adopted.todoId, status: 'completed' });
      expect(await active.runtime.repositories.todo.findById(todo.id)).toMatchObject({ title: 'Anna 中的真实任务' });
      expect(await active.runtime.repositories.companionInteraction.findById(oldInteraction.id)).toEqual(oldInteraction);
      expect(await active.runtime.repositories.companionInteraction.findLastByScene('health_reminder')).toEqual(health);
      expect(await active.runtime.repositories.todo.findById(afterExport.id)).toBeNull();
      const restoredNote = await active.runtime.repositories.note.findById(note.id);
      expect(await readFile(restoredNote!.sourceUri!, 'utf8')).toBe('备份中的源文件');
      expect(await readFile(join(directory, 'imports', 'source-note.txt'), 'utf8')).toBe('修改后的源文件');
      expect((await readFile(audioPath)).length).toBe(65539);
      expect(await active.runtime.repositories.note.findById(note.id)).toMatchObject({ content: '真实笔记正文' });
      expect(await active.runtime.repositories.focus.findById(focus.id)).toMatchObject({ status: 'completed' });
      expect(await active.invoke('audio_list_music')).toEqual([{ path: audioPath, name: '中文音乐.wav', sizeBytes: 65539 }]);
      // Move through a portable folder; the destination must survive without old asset paths.
      const portable = join(directory, '搬迁备份');
      await cp(completeBackup.path, portable, { recursive: true });
      const destination = join(directory, '新的数据目录');
      let moved = connect(destination);
      try {
        await moved.runtime.infrastructure.initialize();
        const before = await moved.runtime.application.useCases.createTodo.execute({ title: '搬迁前保留于安全备份' });
        await expect(moved.invoke('data_import_local', { path: 'relative/backup' })).rejects.toThrow('完整路径');
        await unlink(join(portable, 'music', audioName));
        await expect(moved.invoke('data_import_local', { path: portable })).rejects.toThrow('缺少引用文件');
        expect(await moved.invoke('data_list_exports')).toEqual([]);
        await copyFile(join(completeBackup.path, 'music', audioName), join(portable, 'music', audioName));
        const imported = await moved.invoke<{ id: string; path: string }>('data_import_local', { path: portable });
        expect(await moved.runtime.repositories.todo.findById(before.id)).not.toBeNull();
        await rename(portable, `${portable}-不再可用`);
        await moved.invoke('data_restore_local', { id: imported.id });
        await moved.close();
        await active.close();
        await rename(join(directory, 'imports'), join(directory, '原文档已移走'));
        await rename(join(directory, 'music'), join(directory, '原音乐已移走'));
        moved = connect(destination);
        await moved.runtime.infrastructure.initialize();
        const movedNote = await moved.runtime.repositories.note.findById(note.id);
        expect(movedNote?.content).toBe('真实笔记正文');
        expect(normalize(movedNote!.sourceUri!)).toBe(join(destination, 'imports', 'source-note.txt'));
        expect(await readFile(movedNote!.sourceUri!, 'utf8')).toBe('备份中的源文件');
        expect(await moved.runtime.repositories.todo.findById(before.id)).toBeNull();
        const settings = await moved.runtime.repositories.settings.getAll();
        expect(normalize(settings['focus.musicFile'])).toBe(join(destination, 'music', audioName));
        expect(JSON.parse(settings['ambient.filesByWeather'])).toEqual({ rain: settings['focus.musicFile'] });
        expect(settings['paths.readDirs']).toBeUndefined();
        expect(await moved.invoke('audio_read_chunk', { path: settings['focus.musicFile'], offset: 65536 })).toEqual({ bytes: [255, 128, 1], size: 65539 });
        expect(await moved.invoke('db_integrity_check')).toBe('ok');
        const damaged = await moved.invoke<{ id: string; path: string }>('data_export_local');
        const retained = await moved.runtime.application.useCases.createTodo.execute({ title: '恢复失败时必须保留的新任务' });
        await moved.invoke('data_restore_local', { id: damaged.id });
        await writeFile(join(damaged.path, 'nativemind.db'), 'damaged after scheduling');
        await moved.close();
        moved = connect(destination);
        await moved.runtime.infrastructure.initialize();
        expect(await moved.invoke('data_restore_status')).toMatchObject({ state: 'failed', backupId: damaged.id });
        expect(await moved.runtime.repositories.todo.findById(retained.id)).toMatchObject({ title: retained.title });
        // Normal writes and a new explicit restore remain available after the failure.
        const retryBackup = await moved.invoke<{ id: string }>('data_export_local');
        const afterRetry = await moved.runtime.application.useCases.createTodo.execute({ title: '重试备份之后的任务' });
        await moved.invoke('data_restore_local', { id: retryBackup.id });
        await moved.close();
        moved = connect(destination);
        await moved.runtime.infrastructure.initialize();
        expect(await moved.invoke('data_restore_status')).toMatchObject({ state: 'restored', backupId: retryBackup.id });
        expect(await moved.runtime.repositories.todo.findById(retained.id)).not.toBeNull();
        expect(await moved.runtime.repositories.todo.findById(afterRetry.id)).toBeNull();
        // A new window cannot interleave SQL with a live connection.
        const successor = moved.connectionFor('successor-window');
        await expect(successor.connect()).rejects.toThrow('ANNA_WINDOW_BUSY');
        await moved.invoke('db_execute', { sql: 'CREATE TABLE session_probe (value TEXT)', params: [] });
        await moved.invoke('db_execute', { sql: "INSERT INTO session_probe VALUES ('committed')", params: [] });
        await moved.invoke('db_execute', { sql: 'BEGIN', params: [] });
        await moved.invoke('db_execute', { sql: "INSERT INTO session_probe VALUES ('uncommitted')", params: [] });
        await moved.invoke('native_disconnect');
        await successor.connect();
        await expect(moved.invoke('db_execute', { sql: 'DELETE FROM session_probe', params: [] })).rejects.toThrow('ANNA_SESSION_EXPIRED');
        expect(await successor.invoke('db_select', { sql: 'SELECT value FROM session_probe', params: [] })).toEqual([{ value: 'committed' }]);
        // Simulate a crashed page: no disconnect and no heartbeat while its transaction is open.
        await successor.invoke('db_execute', { sql: 'BEGIN', params: [] });
        await successor.invoke('db_execute', { sql: "INSERT INTO session_probe VALUES ('abandoned')", params: [] });
        await new Promise(resolve => setTimeout(resolve, 15_100));
        const recovered = moved.connectionFor('recovered-window');
        await recovered.connect();
        await expect(successor.invoke('db_execute', { sql: 'COMMIT', params: [] })).rejects.toThrow('ANNA_SESSION_EXPIRED');
        // A stale close must not disconnect the new owner either.
        await expect(successor.close()).rejects.toThrow('ANNA_SESSION_EXPIRED');
        expect(await recovered.invoke('db_select', { sql: 'SELECT value FROM session_probe', params: [] })).toEqual([{ value: 'committed' }]);
        await recovered.close();
      } finally { await moved.close(); }
    } finally {
      await active.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

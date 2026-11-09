import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { launcherProfilePath, selectDataDirectory, readLauncherProfile, rememberDataDirectory, prepareDataDirectory, validateDataDirectory } from '../../../anna/local-launch/data-location.mjs';
import { assessPrerequisites, findNpxCli, checkOllama } from '../../../anna/local-launch/prerequisites.mjs';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'anna-local-launch-')); folders.push(root);
  const profilePath = launcherProfilePath(join(root, 'profile'));
  return { root, profilePath, packageRoot: join(root, 'package-v2') };
}

describe('Anna 本地数据目录选择与升级', () => {
  it('首次要求明确选择，检查不创建数据目录或配置', async () => {
    const f = await fixture();
    await expect(selectDataDirectory(f)).rejects.toThrow('首次启动');
    const selected = await selectDataDirectory({ ...f, explicit: join(f.root, '新 数据 & 学习') });
    expect(selected).toMatchObject({ exists: false, databaseExists: false, source: 'argument' });
    expect(await readdir(f.root)).toEqual([]);
  });
  it('旧包数据保持原样，换到新版包时沿用包外配置', async () => {
    const f = await fixture(); const dataDirectory = join(f.root, 'old-package', '.local-data');
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(dataDirectory, 'nativemind.db'), 'synthetic database');
    await rememberDataDirectory(f.profilePath, dataDirectory);
    const selected = await selectDataDirectory(f);
    expect(selected).toMatchObject({ dataDirectory, source: 'profile', exists: true, databaseExists: true });
    await prepareDataDirectory(selected.dataDirectory);
    expect(await readFile(join(dataDirectory, 'nativemind.db'), 'utf8')).toBe('synthetic database');
    expect(await readdir(dataDirectory)).toEqual(['nativemind.db']);
    expect((await selectDataDirectory({ ...f, packageRoot: join(f.root, 'package-v3') })).dataDirectory).toBe(dataDirectory);
  });
  it('原目录消失时停止，不重新初始化空库', async () => {
    const f = await fixture(); const missing = join(f.root, 'missing');
    await rememberDataDirectory(f.profilePath, missing);
    await expect(selectDataDirectory(f)).rejects.toThrow('没有创建空库');
    expect(await readdir(f.root)).toEqual(['profile']);
  });
  it('配置损坏要求修复；显式目录可修复且保存完整，不遗留临时文件', async () => {
    const f = await fixture(); await rememberDataDirectory(f.profilePath, join(f.root, 'old'));
    await writeFile(f.profilePath, '{invalid');
    await expect(selectDataDirectory(f)).rejects.toThrow('损坏');
    const choice = await selectDataDirectory({ ...f, explicit: join(f.root, 'chosen') });
    await prepareDataDirectory(choice.dataDirectory); await rememberDataDirectory(f.profilePath, choice.dataDirectory);
    expect(await readLauncherProfile(f.profilePath)).toMatchObject({ dataDirectory: choice.dataDirectory });
    expect(await readdir(join(f.root, 'profile', 'NativeMind', 'Anna'))).toEqual(['launcher.json']);
  });
  it('临时环境变量与显式参数优先，但读取不会覆盖已记住的目录', async () => {
    const f = await fixture(); await rememberDataDirectory(f.profilePath, join(f.root, 'saved'));
    expect((await selectDataDirectory({ ...f, environment: join(f.root, 'temporary') })).source).toBe('environment');
    expect((await selectDataDirectory({ ...f, environment: join(f.root, 'temporary'), explicit: join(f.root, 'chosen') })).source).toBe('argument');
    expect((await readLauncherProfile(f.profilePath))?.dataDirectory).toBe(join(f.root, 'saved'));
  });
  it('拒绝相对路径、当前包内部、伪装父路径、磁盘根目录和文件', async () => {
    const f = await fixture();
    for (const path of ['relative-data', f.packageRoot, join(f.packageRoot, '.local-data'), join(f.packageRoot, '..hidden'), parse(f.root).root]) {
      expect(() => validateDataDirectory(path, f.packageRoot)).toThrow();
    }
    if (process.platform === 'win32') expect(() => validateDataDirectory('\\\\server\\share\\data', f.packageRoot)).toThrow('网络');
    const file = join(f.root, 'file'); await writeFile(file, 'keep');
    await expect(selectDataDirectory({ ...f, explicit: file })).rejects.toThrow('普通目录');
    expect(await readFile(file, 'utf8')).toBe('keep');
  });
});

describe('Anna 启动依赖检查', () => {
  it('缺少 Node/uv/npm 或架构不匹配会阻止启动', () => {
    const checks = assessPrerequisites({ nodeVersion: '20.0.0', platform: 'win32', arch: 'arm64', packagePlatform: 'win32', packageArch: 'x64', uvAvailable: false, npxCli: null });
    expect(checks.filter(item => item.required && !item.ok).map(item => item.id)).toEqual(['platform', 'node', 'uv', 'npm']);
  });
  it('按已知 Node 安装目录定位 npx JS，不拼接 shell 命令', async () => {
    const f = await fixture(); const nodeDir = join(f.root, 'Node with space & symbol');
    const script = join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    await mkdir(join(nodeDir, 'node_modules', 'npm', 'bin'), { recursive: true }); await writeFile(script, '// fixture');
    expect(await findNpxCli(join(nodeDir, 'node.exe'))).toBe(script);
    expect(await findNpxCli(join(f.root, 'missing', 'node.exe'))).toBeNull();
  });
  it('仅查询本机模型列表，不启动/下载模型；缺模型不阻止非 AI 功能', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'qwen3:14b' }, { name: 'nomic-embed-text:latest' }] })));
    const checks = await checkOllama(fetcher);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags');
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
    expect(checks.find(item => item.id === 'embedding')?.ok).toBe(true);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] })));
    expect((await checkOllama(fetcher)).find(item => item.id === 'embedding')).toMatchObject({ ok: false, required: false });
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await checkOllama(fetcher)).toEqual([expect.objectContaining({ id: 'ollama', ok: false, required: false })]);
  });
});

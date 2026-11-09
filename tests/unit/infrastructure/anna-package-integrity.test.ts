import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyAnnaPackage, annaReleaseAssessment } from '../../../scripts/lib/verify-anna-package.mjs';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'anna-package-integrity-')); folders.push(root);
  const files = [];
  for (const path of ['manifest.json', 'app.json', 'README.txt', 'bundle/index.html', 'executas/nativemind/launch.mjs',
    'executas/nativemind/executa.json', 'executas/nativemind/bin/nativemind-anna-native.exe', 'executas/nativemind/bin/resources/vec0.dll']) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'test');
    files.push({ path, bytes: 4, sha256: createHash('sha256').update('test').digest('hex') });
  }
  const manifest = { format: 1, mode: 'local-development', publishReady: false, platform: 'win32', arch: 'x64', profile: 'release', files };
  const save = () => writeFile(join(root, 'package-manifest.json'), JSON.stringify(manifest));
  await save(); return { root, manifest, save };
}

describe('Anna 分发包完整性与发布检查', () => {
  it('完整本机包验证通过，但绝不把完整性检查当作正式发布许可', async () => {
    const { root } = await fixture();
    const integrity = await verifyAnnaPackage(root);
    expect(integrity.filesVerified).toBe(8);
    const report = annaReleaseAssessment({ state: 'verified', ...integrity });
    expect(report.publishReady).toBe(false);
    expect(report.blockers.map(item => item.id)).toContain('production-identity');
    expect(report.blockers.map(item => item.id)).toContain('private-transport');
    // The CLI only reads files: fake executables are never spawned.
    const checked = spawnSync(process.execPath, ['scripts/anna-release-check.mjs', '--package', root], { encoding: 'utf8', windowsHide: true });
    expect(checked.status).toBe(2);
    expect(JSON.parse(checked.stdout)).toMatchObject({ publishReady: false, packageIntegrity: { state: 'verified' } });
  });
  it('检测大小相同的内容篡改', async () => {
    const { root } = await fixture(); await writeFile(join(root, 'bundle/index.html'), 'evil');
    await expect(verifyAnnaPackage(root)).rejects.toThrow('校验失败');
  });
  it('缺失依赖或新增文件都不允许作为完整分发包', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'extra.exe'), 'unexpected');
    await expect(verifyAnnaPackage(root)).rejects.toThrow('清单外');
    await rm(join(root, 'extra.exe'));
    await rm(join(root, 'executas/nativemind/bin/resources/vec0.dll'));
    await expect(verifyAnnaPackage(root)).rejects.toThrow('缺少文件');
  });
  it('清单不允许大小写重复、父目录穿越、绝对路径和数据文件', async () => {
    const { root, manifest, save } = await fixture(); const original = manifest.files[0];
    for (const path of ['../outside', 'C:/outside', 'bundle\\outside', 'settings.json', '.local-data/notes.db', 'bundle/../outside', 'bundle/name.', 'bundle/name:stream']) {
      manifest.files.push({ ...original, path }); await save();
      await expect(verifyAnnaPackage(root)).rejects.toThrow(); manifest.files.pop();
    }
    manifest.files.push({ ...original, path: 'MANIFEST.JSON' }); await save();
    await expect(verifyAnnaPackage(root)).rejects.toThrow('重复');
  });
  it('存在本地学习库时停止，不读取该目录内的内容', async () => {
    const { root } = await fixture(); await mkdir(join(root, '.local-data'));
    await writeFile(join(root, '.local-data/private-note.txt'), 'DO_NOT_READ_OR_REPORT');
    await expect(verifyAnnaPackage(root)).rejects.toThrow('不会读取');
    expect(await readFile(join(root, '.local-data/private-note.txt'), 'utf8')).toBe('DO_NOT_READ_OR_REPORT');
  });
  it('拒绝清单内目录的链接或 Windows junction', async () => {
    const { root } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'anna-package-integrity-')); folders.push(outside);
    await rm(join(root, 'bundle'), { recursive: true });
    await symlink(outside, join(root, 'bundle'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(verifyAnnaPackage(root)).rejects.toThrow('链接');
  });
  it('手工把清单改成 publishReady 不能绕过本机包限制', async () => {
    const { root, manifest, save } = await fixture(); manifest.publishReady = true; await save();
    await expect(verifyAnnaPackage(root)).rejects.toThrow('格式');
  });
});

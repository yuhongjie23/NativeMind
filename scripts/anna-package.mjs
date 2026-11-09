import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, mkdtemp, readdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAnnaPackage } from './lib/verify-anna-package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result;
};

// Only files explicitly listed below enter the package: never copy the Anna workspace,
// its .local-data, credentials, models, Cargo cache or a developer's executables directory.
run('cargo', ['build', '--locked', '--manifest-path', 'anna/native/Cargo.toml', ...(debug ? [] : ['--release'])]);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'anna/vite.config.ts']);
const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'anna/native/Cargo.toml'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).stdout);
const executableName = `nativemind-anna-native${process.platform === 'win32' ? '.exe' : ''}`;
const library = { win32: 'vec0.dll', darwin: 'vec0.dylib', linux: 'vec0.so' }[process.platform];
if (!library) throw new Error(`Unsupported package platform: ${process.platform}`);
const outputRoot = join(root, 'anna', 'packages');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, `nativemind-local-${process.platform}-${process.arch}-${profile}-`));
const bin = join(output, 'executas', 'nativemind', 'bin');
await mkdir(join(bin, 'resources'), { recursive: true });
await copyFile(join(metadata.target_directory, profile, executableName), join(bin, executableName));
await copyFile(join(metadata.target_directory, profile, 'resources', library), join(bin, 'resources', library));
await mkdir(join(output, 'local-launch'), { recursive: true });
for (const file of ['manifest.json', 'app.json', 'executas/nativemind/launch.mjs', 'executas/nativemind/executa.json',
  'start-local.mjs', 'local-launch/data-location.mjs', 'local-launch/prerequisites.mjs', 'local-launch/package-integrity.mjs', 'local-launch/run-development.mjs']) {
  await copyFile(join(root, 'anna', file), join(output, file));
}
await cp(join(root, 'anna', 'bundle'), join(output, 'bundle'), { recursive: true, dereference: false });
await writeFile(join(output, 'README.txt'), `NativeMind Anna 本机验证包 (${process.platform}/${process.arch}, ${profile})

这是完整 App 的本地 Anna 调试包，不是已上架的安装包。
需要 Node.js 22+、uv，以及用于 AI 的本机 Ollama 和模型；不需要 Rust 或源码。
推荐使用 Windows x64 本地启动助手。在本目录打开终端，首次运行：
  node start-local.mjs --check --data-dir "E:\\NativeMindData"
  node start-local.mjs --data-dir "E:\\NativeMindData"
上面路径仅为示例。有旧学习库时，必须改为原数据目录（例如旧包的 .local-data）。
首次明确选择后，路径记在 %LOCALAPPDATA%\\NativeMind\\Anna\\launcher.json；
以后在任意新版包内运行 node start-local.mjs 即可沿用，包与数据分开保存。
--check 只检查，不保存路径、不创建数据目录、不启动或下载依赖。
实际启动首次可能下载官方调试依赖，打开终端显示的 localhost 地址。
Ollama 未运行不妨碍打开非 AI 功能，模型不会被自动下载或切换。
升级请先停止旧 Anna 服务，保留原数据目录，切换到完整新包后运行启动助手。
不自动搬移/覆盖学习库；目录消失时停止并提示修复，不悄悄新建空库。
本包不含笔记、密钥、备份、模型或内置大音乐。SHA-256 不是数字签名。
若直接使用 npx dev，仍遵循旧规则：NATIVEMIND_ANNA_DATA_DIR 或本包 .local-data；
直接启动不会读取启动助手保存的路径，因此升级推荐始终使用 start-local.mjs。

原生工具仍要求 --local-dev；界面拒绝公开宿主，不可将此开发命令桥直接发布为 Agent 工具。
正式私密数据通道、认证隔离、签名和平台审核尚未完成。
验证清单见 package-manifest.json（SHA-256 用于检查文件完整性，不是数字签名）。
`, 'utf8');

const files = [];
async function inventory(directory) {
  const contents = await readdir(directory, { withFileTypes: true });
  // Public assets can contain empty placeholder folders. Exclude them from this
  // newly created package; the distribution inventory intentionally lists files only.
  if (!contents.length && directory !== output) {
    const inside = relative(output, directory);
    if (!inside || inside.startsWith('..') || inside.includes(':')) throw new Error('Invalid package directory');
    await rmdir(directory); // Empty directory only, never recursive.
    return;
  }
  for (const entry of contents) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in package: ${path}`);
    if (entry.isDirectory()) await inventory(path);
    else if (entry.isFile()) {
      const content = await readFile(path);
      files.push({ path: relative(output, path).replaceAll('\\', '/'), bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    } else throw new Error(`Unsupported package entry: ${path}`);
  }
}
await inventory(output);
files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(output, 'package-manifest.json'), JSON.stringify({ format: 1, mode: 'local-development', platform: process.platform, arch: process.arch, profile, publishReady: false, files }, null, 2) + '\n');
await verifyAnnaPackage(output);
// Verify the copied binary, not the source build; tests relocate it again to a temp directory.
run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/anna-native.test.ts', 'tests/integration/anna-model-jobs.test.ts'], {
  env: { ...process.env, NATIVEMIND_ANNA_TEST_BINARY: join(bin, executableName), NATIVEMIND_ANNA_TEST_LAUNCHER: join(output, 'executas', 'nativemind', 'launch.mjs') },
});
console.log(`Local verification package ready: ${output}`);

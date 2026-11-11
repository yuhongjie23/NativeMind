// Build a separate production candidate. Never upload or include developer/user data.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 build required');
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build/check failed (${result.status})`);
  return result;
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const toolId = 'tool-forforever23-hongjie-yu-3qny9w3z';
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const target = resolve(process.env.CARGO_TARGET_DIR || join(root, 'src-tauri', 'target'));
// Reuse dependency cache; the final candidate is copied into a unique package directory.
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--no-bundle', '--features', 'anna-local', '--config', resolve(root, 'anna/desktop/tauri.local.conf.json')], {
  env: { ...process.env, CARGO_TARGET_DIR: target },
});
const app = join(target, 'release', 'nativemind.exe');
const vector = join(root, 'src-tauri/resources/vec0.dll');
const appHash = digest(await readFile(app)), vectorHash = digest(await readFile(vector));
const launcherTarget = join(root, 'anna/launcher/target');
const env = { ...process.env, CARGO_TARGET_DIR: launcherTarget, NATIVEMIND_DESKTOP_SHA256: appHash, NATIVEMIND_VECTOR_SHA256: vectorHash };
run('cargo', ['build', '--locked', '--release', '--manifest-path', 'anna/launcher/Cargo.toml'], { env });
run('cargo', ['test', '--locked', '--manifest-path', 'anna/launcher/Cargo.toml'], { env });
const packages = join(root, 'anna/desktop/packages');
await mkdir(packages, { recursive: true });
const output = await mkdtemp(join(packages, `nativemind-${version}-`));
// Reuse the server-minted identity when a later build lives in a new package directory.
// Without this CLI cache, `executa publish` attempts to create a duplicate tool.
const identityPath = join(root, 'anna/desktop/.anna/executa.json');
try {
  const identity = JSON.parse(await readFile(identityPath, 'utf8'));
  if (identity.tool_id !== toolId || identity.host !== 'https://anna.partners') throw new Error('Unexpected Executa identity');
  await mkdir(join(output, '.anna'));
  await copyFile(identityPath, join(output, '.anna/executa.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const payload = join(output, 'payload');
await mkdir(join(payload, 'bin'), { recursive: true });
await mkdir(join(payload, 'desktop'));
await copyFile(app, join(payload, 'desktop/nativemind.exe'));
await copyFile(vector, join(payload, 'desktop/vec0.dll'));
await copyFile(join(launcherTarget, 'release/nativemind-anna-launcher.exe'), join(payload, 'bin/nativemind-anna-launcher.exe'));
const manifest = { name: toolId, version, runtime: { binary: { entrypoint: { 'windows-x86_64': 'bin/nativemind-anna-launcher.exe' } } } };
await writeFile(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Describe/health and forbidden calls are safe without starting the desktop or reading its DB.
const frames = [
  { id: 1, method: 'describe' }, { id: 2, method: 'health' },
  { id: 3, method: 'invoke', params: { tool: 'native_command', arguments: { command: 'db_query' } } },
  { id: 4, method: 'invoke', params: { tool: 'open_app', arguments: { path: 'DO_NOT_READ' } } },
  { id: 5, method: 'invoke', params: { tool: 'open_app', arguments: {} } },
];
const smoke = run(join(payload, 'bin/nativemind-anna-launcher.exe'), [], {
  input: frames.map(frame => JSON.stringify({ jsonrpc: '2.0', ...frame })).join('\n') + '\n',
  stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 15000,
  env: { ...process.env, ANNA_RUNTIME_PROFILE: 'cloud-linux' },
});
const replies = smoke.stdout.trim().split('\n').map(line => JSON.parse(line));
if (replies.length !== 5 || replies[0].result.tools[0].name !== 'open_app' || replies[2].error?.code !== -32601
  || replies[3].error?.code !== -32602 || replies[4].result?.error !== 'SELECT_LOCAL_WINDOWS_AGENT'
  || smoke.stdout.includes('DO_NOT_READ')) throw new Error('Copied package protocol acceptance failed');
const oversized = run(join(payload, 'bin/nativemind-anna-launcher.exe'), [], {
  input: 'x'.repeat(8192) + '\n', stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000,
});
if (oversized.stdout !== '') throw new Error('Oversized frame was reflected');
const archive = `nativemind-${version}-windows-x86_64.zip`;
// Literal fixed filenames, argument array: no shell interpolation or user data.
run('tar.exe', ['-a', '-cf', join(output, archive), '-C', payload, 'manifest.json', 'bin', 'desktop']);
const archiveBytes = await readFile(join(output, archive));
await writeFile(join(output, 'executa.json'), JSON.stringify({
  tool_id: toolId, slug: 'nativemind-local', name: 'NativeMind Local Launcher', version,
  description: 'Open the full NativeMind local-only desktop app on a Windows x64 PC. No learning data is returned to Anna.',
  executa_type: 'tool', manifest_file: 'protocol-manifest.json',
  distribution: { type: 'binary', supports_protocol: true, executable_name: 'nativemind-anna-launcher',
    binary_artifacts: { 'windows-x86_64': { path: archive, entrypoint: 'bin/nativemind-anna-launcher.exe', format: 'zip' } } },
}, null, 2) + '\n');
await writeFile(join(output, 'protocol-manifest.json'), JSON.stringify(replies[0].result, null, 2) + '\n');
await writeFile(join(output, 'acceptance.json'), JSON.stringify({
  version, archive, bytes: archiveBytes.length, sha256: digest(archiveBytes), appSha256: appHash, vectorSha256: vectorHash,
  protocolSmoke: 'passed', cleanWindowsAcceptance: 'pending', annaInstallUpdateAcceptance: 'pending',
  authenticode: 'not_configured', uploaded: false, publishReady: false,
}, null, 2) + '\n');
await copyFile(join(root, 'anna/desktop/check-new-pc.ps1'), join(output, 'check-new-pc.ps1'));
console.log(`Candidate package (not published): ${output}`);

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';

const suffix = process.platform === 'win32' ? '.exe' : '';
const bundledDirectory = fileURLToPath(new URL('./bin', import.meta.url));
const targetDirectory = process.env.CARGO_TARGET_DIR;
if (targetDirectory && !isAbsolute(targetDirectory)) {
  throw new Error('Anna 开发启动请将 CARGO_TARGET_DIR 设置为绝对路径，确保构建与运行使用同一目录。');
}
const binaryDirectory = existsSync(bundledDirectory) ? bundledDirectory
  : targetDirectory ? join(targetDirectory, 'debug') : fileURLToPath(new URL('../../native/target/debug/', import.meta.url));
const binary = join(binaryDirectory, `nativemind-anna-native${suffix}`);
const child = spawn(binary, ['--local-dev'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NATIVEMIND_ANNA_DATA_DIR: process.env.NATIVEMIND_ANNA_DATA_DIR ?? fileURLToPath(new URL('../../.local-data', import.meta.url)) },
});
child.on('error', (error) => {
  console.error(`NativeMind native bridge unavailable. Run npm run anna:build first. ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const suffix = process.platform === 'win32' ? '.exe' : '';
const binaryDirectory = existsSync(fileURLToPath(new URL('./bin', import.meta.url))) ? './bin/' : '../../native/target/debug/';
const binary = fileURLToPath(new URL(`${binaryDirectory}nativemind-anna-native${suffix}`, import.meta.url));
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

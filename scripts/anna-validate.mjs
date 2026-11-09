import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', '@anna-ai/cli@0.1.63', 'validate'],
  { cwd: fileURLToPath(new URL('../anna', import.meta.url)), stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
process.exitCode = result.status ?? 1;

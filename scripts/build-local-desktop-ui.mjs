import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'anna/desktop/dist'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, VITE_NATIVEMIND_LOCAL_ONLY: 'true' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

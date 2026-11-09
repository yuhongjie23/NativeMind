import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const build = spawnSync('cargo', ['build', '--manifest-path', 'anna/native/Cargo.toml'], { cwd, stdio: 'inherit', windowsHide: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const binary = fileURLToPath(new URL(`../anna/native/target/debug/nativemind-anna-native${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/anna-native.test.ts', 'tests/integration/anna-model-jobs.test.ts'], {
  cwd, stdio: 'inherit', windowsHide: true, env: { ...process.env, NATIVEMIND_ANNA_TEST_BINARY: binary },
});
process.exitCode = result.status ?? 1;

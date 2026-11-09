import { spawn } from 'node:child_process';

/** Own only this launcher-created process tree, never unrelated Anna/Ollama processes. */
export function runLocalProcess(command, args, { cwd, env = process.env, quiet = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', windowsHide: true, shell: false,
    });
    let stopping = false; let timedOut = false;
    const stop = () => {
      if (stopping || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
      stopping = true;
      if (process.platform === 'win32') {
        // Node's child.kill only ends npx, leaving its local server/parser children alive.
        const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        terminator.on('error', () => { child.kill(); });
        terminator.on('exit', code => { if (code !== 0 && child.exitCode === null) child.kill(); });
      } else child.kill('SIGTERM');
    };
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; stop(); }, timeoutMs) : undefined;
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); if (timedOut) reject(new Error('准备本地运行依赖超时，请检查网络后重新启动。')); else resolve(stopping ? 130 : code ?? 1); });
  });
}

export async function runDevelopment({ npxCli, packageRoot, dataDirectory }) {
  const env = { ...process.env, NATIVEMIND_ANNA_DATA_DIR: dataDirectory };
  console.log('正在准备 Anna 本地运行依赖（首次可能需要下载）…');
  // The pinned bridge ignores --help: closed stdin makes it initialize and exit.
  // Warm exactly the CLI's uv tool environment before its 8-second ready deadline.
  const prepared = await runLocalProcess('uv', ['tool', 'run', '--from', 'anna-app-runtime-local==0.2.0a32', 'anna-app-bridge', '--help'], {
    cwd: packageRoot, env, quiet: true, timeoutMs: 120000,
  });
  if (prepared !== 0) {
    console.error('Anna 本地运行依赖未准备好；请检查网络和 uv 安装后重试，学习数据未搬移。');
    return prepared;
  }
  return runLocalProcess(process.execPath, [npxCli, '--yes', '@anna-ai/cli@0.1.63', 'dev', '--no-llm'], { cwd: packageRoot, env });
}

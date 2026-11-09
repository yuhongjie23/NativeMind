import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

export async function findNpxCli(nodePath, npmPath) {
  const candidates = [join(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npx-cli.js')];
  if (npmPath && isAbsolute(npmPath)) candidates.push(join(dirname(npmPath), 'npx-cli.js'));
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the next known npm layout. */ } }
  return null;
}

export function assessPrerequisites({ nodeVersion, platform, arch, packagePlatform, packageArch, uvAvailable, npxCli }) {
  return [
    { id: 'platform', required: true, ok: platform === 'win32' && arch === 'x64' && platform === packagePlatform && arch === packageArch,
      message: platform === 'win32' && arch === 'x64' && platform === packagePlatform && arch === packageArch ? '程序包与本机 Windows x64 匹配。' : '启动助手当前仅验收 Windows x64，程序包必须匹配本机架构。' },
    { id: 'node', required: true, ok: Number(nodeVersion.split('.')[0]) >= 22, message: Number(nodeVersion.split('.')[0]) >= 22 ? `Node.js ${nodeVersion} 已就绪。` : '需要 Node.js 22 或更高版本：https://nodejs.org/en/download' },
    { id: 'uv', required: true, ok: uvAvailable, message: uvAvailable ? 'uv 已就绪。' : '需要 uv；安装后重开终端：https://docs.astral.sh/uv/getting-started/installation/' },
    { id: 'npm', required: true, ok: Boolean(npxCli), message: npxCli ? 'npm/npx 已就绪。' : '需要随 Node.js 安装的 npm/npx；请修复 Node.js 安装并保留 npm 组件。' },
  ];
}

export function checkUv() {
  const result = spawnSync('uv', ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true, shell: false });
  return !result.error && result.status === 0 && /^uv\s+\d/.test(result.stdout.trim());
}

export async function checkOllama(fetcher = fetch) {
  try {
    const response = await fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('unavailable');
    const body = await response.json();
    if (!Array.isArray(body.models) || !body.models.every(model => typeof model?.name === 'string')) throw new Error('invalid response');
    const names = body.models.map(model => model.name.split(':')[0]);
    return [
      { id: 'ollama', required: false, ok: true, message: `Ollama 可用，已安装 ${names.length} 个模型。生成能力仍需在应用设置中检查，不会自动下载或切换模型。` },
      { id: 'embedding', required: false, ok: names.includes('nomic-embed-text'), message: names.includes('nomic-embed-text') ? 'nomic-embed-text 已安装。' : '知识语义检索需要 nomic-embed-text；可运行 ollama pull nomic-embed-text。' },
    ];
  } catch {
    return [{ id: 'ollama', required: false, ok: false, message: '本机 Ollama 未就绪；先打开 Ollama 或运行 ollama serve。任务、提醒和自评仍可使用。' }];
  }
}

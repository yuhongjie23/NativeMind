import { fileURLToPath } from 'node:url';
import { verifyAnnaPackage } from './local-launch/package-integrity.mjs';
import { launcherProfilePath, selectDataDirectory, prepareDataDirectory, rememberDataDirectory } from './local-launch/data-location.mjs';
import { findNpxCli, assessPrerequisites, checkUv, checkOllama } from './local-launch/prerequisites.mjs';
import { runDevelopment } from './local-launch/run-development.mjs';

async function main() {
  const args = process.argv.slice(2); let explicit; let checkOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check' && !checkOnly) checkOnly = true;
    else if (args[index] === '--data-dir' && explicit === undefined && args[index + 1] && !args[index + 1].startsWith('--')) explicit = args[++index];
    else throw new Error('用法：node start-local.mjs [--check] [--data-dir "完整数据目录路径"]');
  }
  const packageRoot = fileURLToPath(new URL('.', import.meta.url));
  const integrity = await verifyAnnaPackage(packageRoot);
  const profilePath = launcherProfilePath(process.env.LOCALAPPDATA);
  const location = await selectDataDirectory({ explicit, environment: process.env.NATIVEMIND_ANNA_DATA_DIR, profilePath, packageRoot });
  const npxCli = await findNpxCli(process.execPath, process.env.npm_execpath);
  const checks = assessPrerequisites({ nodeVersion: process.versions.node, platform: process.platform, arch: process.arch,
    packagePlatform: integrity.platform, packageArch: integrity.arch, uvAvailable: checkUv(), npxCli });
  checks.push(...await checkOllama());
  for (const check of checks) console.log(`${check.ok ? '[通过]' : check.required ? '[需处理]' : '[提示]'} ${check.message}`);
  console.log(`数据目录：${location.dataDirectory}`);
  console.log(location.databaseExists ? '将使用已有学习库，不搬移或覆盖数据。' : '此目录尚无学习库，实际启动后将初始化新库。');
  if (checks.some(check => check.required && !check.ok)) { process.exitCode = 1; return; }
  if (checkOnly) { console.log('检查完成；没有创建目录、修改启动配置或启动服务。'); return; }
  await prepareDataDirectory(location.dataDirectory);
  if (location.source === 'argument') await rememberDataDirectory(profilePath, location.dataDirectory);
  console.log('正在启动 Anna 本机验证环境，首次运行可能下载官方开发依赖；这不会上传学习库或提交上架。');
  process.exitCode = await runDevelopment({ npxCli, packageRoot, dataDirectory: location.dataDirectory });
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve, win32 } from 'node:path';

// Shared by repository release checks and the standalone local launcher.
// Integrity of an unopened distribution folder, not proof of publisher identity.
// Never execute package code, follow symlinks, or traverse unlisted user-data folders.
export async function verifyAnnaPackage(directory) {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('验证目录必须是普通目录，不能是链接。');
  const inventoryPath = join(root, 'package-manifest.json');
  const inventoryStat = await lstat(inventoryPath);
  if (!inventoryStat.isFile() || inventoryStat.isSymbolicLink() || inventoryStat.size > 4 * 1024 * 1024) throw new Error('文件清单无效。');
  const manifest = JSON.parse(await readFile(inventoryPath, 'utf8'));
  if (manifest.format !== 1 || manifest.mode !== 'local-development' || manifest.publishReady !== false ||
      !['win32', 'darwin', 'linux'].includes(manifest.platform) || !['x64', 'arm64'].includes(manifest.arch) ||
      !['debug', 'release'].includes(manifest.profile) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10000) {
    throw new Error('不支持的验证包格式；此检查只接受本机开发验证包。');
  }
  const entries = new Map(); const directories = new Set();
  for (const entry of manifest.files) {
    const path = entry.path;
    if (typeof path !== 'string' || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\') || path.includes(':') ||
        path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /[\x00-\x1f]/.test(part)) ||
        path.toLowerCase() === 'package-manifest.json' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('文件清单包含不合法路径或摘要。');
    const key = path.toLowerCase();
    if (entries.has(key)) throw new Error('文件清单包含重复路径。');
    const parts = path.split('/');
    if (parts.some(part => /^(\.local-data|node_modules|target|\.git|backups|models|settings\.json|paths\.json|\.env(?:\..*)?)$/i.test(part)) || /\.(db|sqlite|pem|key)(?:-|$)/i.test(path)) {
      throw new Error('分发包不能包含用户数据、凭据或开发缓存。');
    }
    entries.set(key, entry);
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/').toLowerCase());
  }
  const suffix = manifest.platform === 'win32' ? '.exe' : '';
  const extension = { win32: 'dll', darwin: 'dylib', linux: 'so' }[manifest.platform];
  const required = ['manifest.json', 'app.json', 'README.txt', 'bundle/index.html', 'executas/nativemind/launch.mjs',
    'executas/nativemind/executa.json', `executas/nativemind/bin/nativemind-anna-native${suffix}`, `executas/nativemind/bin/resources/vec0.${extension}`];
  if (required.some(path => !entries.has(path.toLowerCase()))) throw new Error('缺少界面、启动器或原生依赖的清单记录。');
  const actual = new Map();
  async function visit(relative = '') {
    for (const child of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${child.name}` : child.name;
      if (path === 'package-manifest.json') continue;
      const key = path.toLowerCase();
      if (child.isSymbolicLink()) throw new Error('验证包包含链接，不能作为完整分发包。');
      if (child.isDirectory()) {
        if (!directories.has(key)) throw new Error('验证包包含清单外目录，请重新打包；不会读取其中的用户数据。');
        await visit(path);
      } else if (child.isFile()) {
        if (!entries.has(key) || actual.has(key)) throw new Error('验证包包含清单外文件或大小写冲突。');
        actual.set(key, path);
      } else throw new Error('验证包包含不支持的文件类型。');
    }
  }
  await visit();
  for (const [key, entry] of entries) {
    const path = actual.get(key);
    if (!path) throw new Error(`验证包缺少文件：${entry.path}`);
    const file = join(root, path); const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes) throw new Error(`文件大小或类型不符：${entry.path}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) throw new Error(`文件校验失败：${entry.path}`);
  }
  return { format: 1, mode: manifest.mode, platform: manifest.platform, arch: manifest.arch, profile: manifest.profile, filesVerified: actual.size };
}

export function annaReleaseAssessment(packageIntegrity) {
  return {
    stage: 'local-verification', publishReady: false,
    packageIntegrity,
    blockers: [
      { id: 'private-transport', owner: 'Anna + developer', detail: '待平台确认学习内容不经云端转发的本机通道，并完成实际接入。' },
      { id: 'production-identity', owner: 'developer', detail: '当前随机凭据仅保护开发连接，尚未验证正式宿主、应用、安装和用户身份。' },
      { id: 'development-command-surface', owner: 'developer', detail: '开发命令桥仍提供 SQL 接口，不能公开为 Agent 工具；正式业务接口尚未完成。' },
      { id: 'distribution', owner: 'developer', detail: '当前仅本机验证包，尚未完成签名、正式安装更新及全新设备验收。' },
      { id: 'store-review', owner: 'account owner + Anna', detail: '尚未通过该版本的商店审核和发布；此离线检查不读取平台账号状态。' },
    ],
    note: '文件完整性通过不等于数字签名、正式认证或已上架。此命令不会上传或发布。',
  };
}

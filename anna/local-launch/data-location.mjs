import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, parse, sep } from 'node:path';

export function launcherProfilePath(localAppData) {
  if (!localAppData || !isAbsolute(localAppData)) throw new Error('找不到本机用户配置目录（LOCALAPPDATA）。');
  return join(localAppData, 'NativeMind', 'Anna', 'launcher.json');
}

export function validateDataDirectory(value, packageRoot) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error('请用 --data-dir 指定完整的本地数据目录路径。');
  if (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value)) throw new Error('请使用带盘符的本地目录，不支持网络共享或设备路径。');
  const dataDirectory = resolve(value); const appDirectory = resolve(packageRoot);
  const inside = relative(appDirectory, dataDirectory);
  if (inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) throw new Error('请选择当前程序包之外的数据目录；升级时可指定旧包的 .local-data。');
  if (dataDirectory === parse(dataDirectory).root) throw new Error('请选一个专用文件夹，不要直接使用磁盘根目录。');
  return dataDirectory;
}

export async function readLauncherProfile(path) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('启动配置无效，请显式指定数据目录。');
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('启动配置损坏，请用 --data-dir 重新指定原数据目录。'); }
  if (value?.format !== 1 || typeof value.dataDirectory !== 'string') throw new Error('启动配置版本无效，请显式指定原数据目录。');
  return value;
}

export async function selectDataDirectory({ explicit, environment, profilePath, packageRoot }) {
  const source = explicit !== undefined ? 'argument' : environment !== undefined ? 'environment' : 'profile';
  const profile = source === 'profile' ? await readLauncherProfile(profilePath) : null;
  const value = source === 'argument' ? explicit : source === 'environment' ? environment : profile?.dataDirectory;
  if (!value) throw new Error('首次启动请用 --data-dir 明确选择数据目录。有旧数据时，请指定旧包中的 .local-data；不要另建空目录。');
  const dataDirectory = validateDataDirectory(value, packageRoot);
  let exists = false;
  try {
    const stat = await lstat(dataDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('数据路径必须是普通目录，不能是文件或目录链接。');
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (source === 'profile' && !exists) throw new Error('原数据目录不存在。请检查盘符/移动硬盘，或用 --data-dir 指定原目录；没有创建空库。');
  let databaseExists = false;
  try {
    const database = await lstat(join(dataDirectory, 'nativemind.db'));
    if (!database.isFile() || database.isSymbolicLink()) throw new Error('数据目录中的 nativemind.db 必须是普通文件。');
    databaseExists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { dataDirectory, source, exists, databaseExists };
}

export async function prepareDataDirectory(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true });
  const probe = join(dataDirectory, `.nativemind-write-check-${randomUUID()}`);
  let handle;
  try { handle = await open(probe, 'wx'); await handle.writeFile('NativeMind local launch check'); }
  finally { if (handle) { await handle.close(); await unlink(probe); } }
}

export async function rememberDataDirectory(profilePath, dataDirectory) {
  await mkdir(dirname(profilePath), { recursive: true });
  const temporary = `${profilePath}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ format: 1, dataDirectory }) + '\n');
    await handle.sync(); await handle.close();
    await rename(temporary, profilePath);
  } catch (error) { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error; }
}

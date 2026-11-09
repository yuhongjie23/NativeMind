import { lstat, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

// Conservative decimal MB limits, valid whether the server interprets MB or MiB.
export const bundleLimits = { totalBytes: 50_000_000, fileBytes: 10_000_000, files: 2000 };
const extensions = new Set(['.html', '.css', '.txt', '.md', '.js', '.json', '.wasm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.mp4', '.webm']);

export function assessBundleFiles(files) {
  const errors = []; let totalBytes = 0;
  const seen = new Set();
  for (const file of files) {
    const path = file.path;
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.includes('//') || path.split('/').some(part => part === '..' || part === '.')) errors.push(`不支持的资源路径：${path}`);
    if (seen.has(path.toLowerCase())) errors.push(`重复资源路径：${path}`);
    seen.add(path.toLowerCase());
    if (!extensions.has(extname(path).toLowerCase())) errors.push(`不支持的资源类型：${path}`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) errors.push(`资源大小无效：${path}`);
    else { totalBytes += file.bytes; if (file.bytes > bundleLimits.fileBytes) errors.push(`单文件超过 10 MB：${path}`); }
  }
  if (!seen.has('index.html')) errors.push('缺少 index.html');
  if (files.length > bundleLimits.files) errors.push('资源数量超过 2000');
  if (totalBytes > bundleLimits.totalBytes) errors.push('界面资源总大小超过 50 MB');
  return { valid: !errors.length, fileCount: files.length, totalBytes, errors };
}

export async function checkAnnaBundle(root) {
  const files = [];
  async function visit(path = '') {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`界面资源不允许链接：${path}`);
    if (stat.isDirectory()) { for (const name of await readdir(join(root, path))) await visit(path ? `${path}/${name}` : name); }
    else if (stat.isFile()) files.push({ path, bytes: stat.size });
    else throw new Error(`不支持的资源条目：${path}`);
  }
  await visit();
  const result = assessBundleFiles(files);
  if (!result.valid) throw new Error(result.errors.join('\n'));
  return result;
}

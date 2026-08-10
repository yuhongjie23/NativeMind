/**
 * paths-api 非 Tauri 环境下的行为
 *
 * 浏览器/测试环境没有 Rust 命令，这些函数必须返回安全的空桩，
 * 不能抛错，否则设置页和专注页在纯浏览器预览时会崩。
 */
import { describe, expect, it } from 'vitest';
import {
  getAppPaths,
  listMusic,
  readMusicBytes,
  updateAppPaths,
} from '@infrastructure/paths/paths-api';

describe('paths-api（非 Tauri 环境）', () => {
  it('getAppPaths 返回空目录信息', async () => {
    expect(await getAppPaths()).toEqual({ dataDir: '', resourceDir: '', readDirs: [] });
  });

  it('listMusic 返回空列表', async () => {
    expect(await listMusic()).toEqual([]);
  });

  it('readMusicBytes 返回空 ArrayBuffer', async () => {
    const bytes = await readMusicBytes('/music/a.mp3');
    expect(bytes.byteLength).toBe(0);
  });

  it('updateAppPaths 是安全 no-op，不抛错', async () => {
    await expect(updateAppPaths(['/books'], '/music')).resolves.toBeUndefined();
  });
});

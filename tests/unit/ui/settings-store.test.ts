/**
 * 设置 store 的路径配置
 *
 * 目录设置是这次新增的持久化项：readDirs 存 JSON 数组、musicDir 存单个路径。
 * 重点是「改完能落库、重载能读回」，否则配置的读取/音乐目录重启即丢。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { repositories } from '@ui/stores/runtime';
import { useSettingsStore } from '@ui/stores/settings-store';

describe('settings-store 路径', () => {
  beforeEach(async () => {
    // store 是模块级单例，每个用例从干净状态开始
    useSettingsStore.setState({ paths: { readDirs: [] }, loaded: false, error: undefined });
    await repositories.settings.set('paths.readDirs', '[]');
    await repositories.settings.set('paths.musicDir', '');
  });

  it('空设置下 load 得到空路径', async () => {
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().paths.readDirs).toEqual([]);
    expect(useSettingsStore.getState().paths.musicDir).toBeUndefined();
  });

  it('updatePaths 更新状态、落库，并能在重新 load 时读回', async () => {
    await useSettingsStore.getState().updatePaths({
      readDirs: ['C:/books', 'D:/papers'],
      musicDir: 'C:/music',
    });

    expect(useSettingsStore.getState().paths).toEqual({
      readDirs: ['C:/books', 'D:/papers'],
      musicDir: 'C:/music',
    });

    // 模拟重启：清掉内存状态再 load，配置应来自仓储
    useSettingsStore.setState({ paths: { readDirs: [] }, loaded: false });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().paths.readDirs).toEqual(['C:/books', 'D:/papers']);
    expect(useSettingsStore.getState().paths.musicDir).toBe('C:/music');
  });

  it('readDirs 以 JSON 数组字符串落库', async () => {
    await useSettingsStore.getState().updatePaths({ readDirs: ['/a', '/b'] });
    expect(await repositories.settings.get('paths.readDirs')).toBe('["/a","/b"]');
  });
});

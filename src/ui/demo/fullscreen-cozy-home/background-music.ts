/**
 * 背景内置音乐映射（按文件名适配各场景）。
 *
 * 文件在 src-tauri/resources/audio/backgrounds/（作为 bundle 资源装到目标机，
 * 不内嵌进 exe，避免构建 OOM / rlib 损坏）。命名规则：
 * - day.mp3                日常（书房晴天）白天/黄昏/夜晚同一首
 * - rain_all.mp3 / snow_all.mp3 / spring_all.mp3 / summer_firefly.mp3  对应天气全天一首
 * - library_day_dusk.mp3   图书馆白天 + 黄昏
 * - library_night.mp3      图书馆夜晚
 * - backup1.mp3            备用（不参与映射）
 * 未匹配 → 返回 undefined（静默，不播放）。返回的是文件名（在 resources/audio/backgrounds
 * 内），播放时由 useBackgroundMusic 经 bgm_read 读字节转 Blob。
 */
import type { SceneId, TimePhase, WeatherType } from './types';

export const backgroundMusicFor = (
  scene: SceneId,
  weather: WeatherType,
  timePhase: TimePhase
): string | undefined => {
  if (scene === 'library') {
    return timePhase === 'night' ? 'library_night.mp3' : 'library_day_dusk.mp3';
  }
  switch (weather) {
    case 'clear':
      return 'day.mp3';
    case 'rain':
      return 'rain_all.mp3';
    case 'snow':
      return 'snow_all.mp3';
    case 'spring':
      return 'spring_all.mp3';
    case 'summer':
      return 'summer_firefly.mp3';
    default:
      return undefined;
  }
};

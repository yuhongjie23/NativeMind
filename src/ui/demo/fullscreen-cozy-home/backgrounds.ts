/**
 * 背景图片映射（src/ui/background/*.png）
 *
 * 6 组背景（日常/雨天/雪天/春日樱花/夏日萤火虫/图书馆）各有白天、黄昏、夜晚三版（共 18 张）。
 * 书房（study-room）按天气选组；图书馆（library）只用图书馆三版、天气不干扰。
 * 日常白天是视频（日常_白天.mp4），其余为图。
 */
import rainDay from '../../background/雨天_白天.png';
import rainDusk from '../../background/雨天_黄昏.png';
import rainNight from '../../background/雨天_夜晚.png';
import snowDay from '../../background/雪天_白天.png';
import snowDusk from '../../background/雪天_黄昏.png';
import snowNight from '../../background/雪天_夜晚.png';
import dailyDayVideo from '../../background/日常_白天.mp4';
import dailyDusk from '../../background/日常_黄昏.png';
import dailyNight from '../../background/日常_夜晚.png';
import springDay from '../../background/春日樱花_白天.png';
import springDusk from '../../background/春日樱花_黄昏.png';
import springNight from '../../background/春日樱花_夜晚.png';
import summerDay from '../../background/夏日_白天.png';
import summerDusk from '../../background/夏日_黄昏.png';
import summerNight from '../../background/夏日_夜晚_萤火虫.png';
import libraryDay from '../../background/图书馆_白天.png';
import libraryDusk from '../../background/图书馆_黄昏.png';
import libraryNight from '../../background/图书馆_夜晚.png';
import type { SceneId, TimePhase, WeatherType } from './types';

/** 背景资产：图片或视频 */
export interface BackgroundAsset {
  kind: 'image' | 'video';
  src: string;
}

const img = (src: string): BackgroundAsset => ({ kind: 'image', src });
const vid = (src: string): BackgroundAsset => ({ kind: 'video', src });

/** 白天 / 黄昏 / 夜晚 三版 */
interface PhaseSet {
  day: BackgroundAsset;
  dusk: BackgroundAsset;
  night: BackgroundAsset;
}

const phases = (day: BackgroundAsset, dusk: BackgroundAsset, night: BackgroundAsset): PhaseSet => ({
  day,
  dusk,
  night,
});

/** 书房：按天气选组 */
const STUDY_MAP: Record<WeatherType, PhaseSet> = {
  clear: phases(vid(dailyDayVideo), img(dailyDusk), img(dailyNight)),
  rain: phases(img(rainDay), img(rainDusk), img(rainNight)),
  snow: phases(img(snowDay), img(snowDusk), img(snowNight)),
  spring: phases(img(springDay), img(springDusk), img(springNight)),
  summer: phases(img(summerDay), img(summerDusk), img(summerNight)),
};

/** 图书馆：只用图书馆三版，天气不干扰 */
const LIBRARY_PHASES: PhaseSet = phases(img(libraryDay), img(libraryDusk), img(libraryNight));

export const resolveBackground = (
  weather: WeatherType,
  timePhase: TimePhase,
  scene: SceneId = 'study-room'
): BackgroundAsset => {
  const set = scene === 'library' ? LIBRARY_PHASES : STUDY_MAP[weather];
  return set[timePhase];
};

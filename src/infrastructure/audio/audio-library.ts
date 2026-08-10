/**
 * 音频素材清单
 *
 * 把「场景 → 音频」的映射集中在这里，UI 和用例只说场景名。
 * 音量默认值也放这儿：专注类白噪声要低到能被忽略，提示音才需要被听见。
 *
 * 目录结构与 public/audio 一致：ambient / cue / companion。
 * 当前这些 .wav 由 scripts/generate-placeholder-audio.mjs 生成，可替换成正式素材。
 */

export type AudioCategory = 'ambient' | 'cue' | 'companion';

export interface AudioTrack {
  id: string;
  /** 相对 public/ 的路径，由打包器处理 */
  src: string;
  category: AudioCategory;
  /** 0-1 的建议音量，用户设置会在此基础上再乘一次 */
  defaultVolume: number;
  loop: boolean;
}

export const AUDIO_LIBRARY: Record<string, AudioTrack> = {
  focus_rain: {
    id: 'focus_rain',
    src: '/audio/ambient/rain.wav',
    category: 'ambient',
    defaultVolume: 0.35,
    loop: true,
  },
  focus_cafe: {
    id: 'focus_cafe',
    src: '/audio/ambient/cafe.wav',
    category: 'ambient',
    defaultVolume: 0.3,
    loop: true,
  },
  focus_snow: {
    id: 'focus_snow',
    src: '/audio/ambient/snow.wav',
    category: 'ambient',
    defaultVolume: 0.3,
    loop: true,
  },
  focus_sunny: {
    id: 'focus_sunny',
    src: '/audio/ambient/sunny.wav',
    category: 'ambient',
    defaultVolume: 0.22,
    loop: true,
  },
  focus_start: {
    id: 'focus_start',
    src: '/audio/cue/start.wav',
    category: 'cue',
    defaultVolume: 0.6,
    loop: false,
  },
  focus_complete: {
    id: 'focus_complete',
    src: '/audio/cue/complete.wav',
    category: 'cue',
    defaultVolume: 0.7,
    loop: false,
  },
  companion_greet: {
    id: 'companion_greet',
    src: '/audio/companion/greet.wav',
    category: 'companion',
    defaultVolume: 0.5,
    loop: false,
  },
};

export const getTrack = (id: string): AudioTrack | undefined => AUDIO_LIBRARY[id];

export const listByCategory = (category: AudioCategory): AudioTrack[] =>
  Object.values(AUDIO_LIBRARY).filter((track) => track.category === category);

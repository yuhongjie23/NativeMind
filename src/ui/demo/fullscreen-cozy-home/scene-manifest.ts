/**
 * 场景 Manifest（V4 §10-§12 / §16-§17）。
 *
 * 当前没有正式美术资源，manifest 只描述「锚点 + 未来资源路径」；
 * Asset Resolver 收到 resolve() 时会因资源缺失而落到 CSS fallback。
 * 用户放入 public/visual-packs/cozy-home/ 后，只改这里的路径即可接入，
 * 组件布局与 Agent 契约不用动。
 */

import type { SceneId, SceneManifest } from './types';

export const PACK_BASE = 'visual-packs/cozy-home';

const studyRoom: SceneManifest = {
  id: 'study-room',
  name: '书房',
  backgrounds: {
    day: `${PACK_BASE}/scenes/study-room/backgrounds/day.webp`,
    dusk: `${PACK_BASE}/scenes/study-room/backgrounds/dusk.webp`,
    night: `${PACK_BASE}/scenes/study-room/backgrounds/night.webp`,
    fallback: `${PACK_BASE}/scenes/study-room/backgrounds/fallback.webp`,
  },
  windowMask: `${PACK_BASE}/scenes/study-room/masks/window-mask.png`,
  anchors: {
    girl: { x: 0.48, y: 0.78, scale: 1 },
    pet: { x: 0.7, y: 0.62, scale: 1 },
    focusHud: { x: 0.87, y: 0.45, scale: 1 },
    dock: { x: 0.5, y: 0.06, scale: 1 },
    speechBubble: { x: 0.74, y: 0.5, scale: 1 },
  },
};

const library: SceneManifest = {
  id: 'library',
  name: '图书馆',
  backgrounds: {
    day: `${PACK_BASE}/scenes/library/backgrounds/day.webp`,
    dusk: `${PACK_BASE}/scenes/library/backgrounds/dusk.webp`,
    night: `${PACK_BASE}/scenes/library/backgrounds/night.webp`,
    fallback: `${PACK_BASE}/scenes/library/backgrounds/fallback.webp`,
  },
  windowMask: `${PACK_BASE}/scenes/library/masks/window-mask.png`,
  anchors: {
    girl: { x: 0.46, y: 0.8, scale: 1 },
    pet: { x: 0.65, y: 0.63, scale: 1 },
    focusHud: { x: 0.87, y: 0.45, scale: 1 },
    dock: { x: 0.5, y: 0.06, scale: 1 },
    speechBubble: { x: 0.68, y: 0.52, scale: 1 },
  },
};

export const SCENES: Record<SceneId, SceneManifest> = {
  'study-room': studyRoom,
  library,
};

export const getSceneManifest = (id: SceneId): SceneManifest => SCENES[id];

/** 各角色语义动作的基准时长（CSS fallback 单次动作用，单位 ms） */
export const GIRL_ACTION_DURATION: Partial<Record<string, number>> = {
  stretch: 3200,
  drink: 2600,
  turn_page: 2200,
  look_outside: 3200,
};

export const PET_ACTION_DURATION: Partial<Record<string, number>> = {
  greet: 900,
  cheer: 1200,
  concerned: 1800,
  sleep_enter: 1200,
  wake: 900,
  look_at_girl: 1600,
  needs_input: 1600,
  ready: 1500,
};

/** 宠物台词轮换（V3 §18 台词，≤30 字、无感叹号） */
export const PET_LINES = [
  '来了。今天想做点什么？',
  '先挑一件小事就好。',
  '我在旁边待着。',
  '写一行，也算开始。',
  '累了就慢一点。',
  '先喝口水吧。',
  '这段做完再歇一会儿。',
];

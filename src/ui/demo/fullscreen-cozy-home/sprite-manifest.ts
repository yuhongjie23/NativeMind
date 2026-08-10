/**
 * 宠物 Sprite Sheet Manifest（代码侧，不含美术）
 *
 * 对应 docs/LEARNING_DESKTOP_PET_SPRITESHEET_PROMPT_V1.md §7.3 的 Manifest 格式。
 * Manifest + Sprite Sheet 是**美术资源**（后续由 AI 生成后替换到 companion.assetBase），
 * 这里只负责：加载、按帧播放、状态映射、reduced-motion 与降级（加载失败 → CSS PetActor）。
 */

export interface PetManifestFrame {
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export interface PetManifestAnimation {
  frames: number[];
  fps?: number;
  frameDurationsMs?: number[];
  loop: boolean;
  fallback?: string;
  reducedMotionFrame: number;
}

export interface PetManifest {
  schemaVersion: number;
  id: string;
  spritesheet: string;
  frame: PetManifestFrame;
  animations: Record<string, PetManifestAnimation>;
}

/** 行优先：格子序号 → 背景偏移（px）。col = frame % columns；row = frame / columns。`|| 0` 归一化 -0 */
export const frameOffset = (
  frame: number,
  frameWidth: number,
  frameHeight: number,
  columns: number
): { x: number; y: number } => ({
  x: -((frame % columns) * frameWidth) || 0,
  y: -(Math.floor(frame / columns) * frameHeight) || 0,
});

/** fps → 单帧时长（ms） */
export const frameDurationMs = (fps: number): number => 1000 / fps;

/**
 * 计算某时刻应显示的格子序号（纯函数，可测）。
 *
 * frames = 该动画的格子序号列表；时长逐帧取 frameDurationsMs，缺省按 fps 均分。
 * loop=true 时先播 loopStart 前的开场帧（一次性），再在 loopStart..末尾循环。
 * 一次性动作播完返回 ended=true（调用方据此触发 fallback）。
 */
export const spriteFrameAt = (
  elapsedMs: number,
  frames: number[],
  options: { fps?: number; frameDurationsMs?: number[]; loop: boolean; loopStart?: number }
): { frame: number; ended: boolean } => {
  if (frames.length === 0) return { frame: 0, ended: true };
  const durations = frames.map((_, i) => options.frameDurationsMs?.[i] ?? frameDurationMs(options.fps ?? 10));

  const loopStart = Math.min(options.loopStart ?? 0, frames.length);

  if (!options.loop) {
    let t = 0;
    for (let i = 0; i < frames.length; i += 1) {
      if (elapsedMs < t + durations[i]) return { frame: frames[i], ended: false };
      t += durations[i];
    }
    return { frame: frames[frames.length - 1], ended: true };
  }

  // 循环：先放开场帧（loopStart 之前，一次性），再进入循环段
  let t = 0;
  for (let i = 0; i < loopStart; i += 1) {
    if (elapsedMs < t + durations[i]) return { frame: frames[i], ended: false };
    t += durations[i];
  }
  const loopDurations = durations.slice(loopStart);
  const loopTotal = loopDurations.reduce((sum, d) => sum + d, 0);
  const cycleMs = (elapsedMs - t) % loopTotal;
  let ct = 0;
  for (let i = 0; i < loopDurations.length; i += 1) {
    if (cycleMs < ct + loopDurations[i]) return { frame: frames[loopStart + i], ended: false };
    ct += loopDurations[i];
  }
  return { frame: frames[frames.length - 1], ended: false };
};

/**
 * 把本地文件路径转成 WebView 可加载的 URL。
 * 桌面端（Tauri）用 asset:// 协议（convertFileSrc）才能读本地文件；浏览器环境回退原路径。
 * 缓存引用避免同步函数里 async import。
 */
let convertFileSrcFn: ((path: string) => string) | null = null;
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  void import('@tauri-apps/api/core').then((mod) => {
    convertFileSrcFn = mod.convertFileSrc;
  });
}

export const toAssetUrl = (path: string | undefined): string | undefined => {
  if (!path) return undefined;
  if (/^(?:https?:|data:|blob:|asset:)/.test(path) || path.startsWith('/')) return path;
  return convertFileSrcFn ? convertFileSrcFn(path) : path;
};

/** 尝试加载 Manifest；失败返回 null（走 CSS 降级），不抛错 */
export const loadPetManifest = async (manifestUrl: string | undefined): Promise<PetManifest | null> => {
  if (!manifestUrl) return null;
  try {
    const response = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!response.ok) return null;
    const manifest = (await response.json()) as PetManifest;
    if (!manifest.frame || !manifest.animations || !manifest.spritesheet) return null;
    return manifest;
  } catch {
    return null;
  }
};

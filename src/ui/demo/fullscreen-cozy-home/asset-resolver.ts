/**
 * Asset Resolver（V4 §26 / §28 / §48）。
 *
 * 把 (actor, action) 语义键解析为 AnimationDescriptor，并执行降级链：
 *
 *   指定动画资源 -> poster 静态图 -> CSS fallback -> 简单色块占位
 *
 * 内置咕咕嘎嘎与自定义角色都通过 companion.assetBase 加载；资源缺失时
 * `tryResolveAsset` 返回 null，组件继续使用 CSS descriptor。
 */

import { GIRL_ACTION_DURATION, PET_ACTION_DURATION } from './scene-manifest';
import { loadPetManifest, toAssetUrl, type PetManifest } from './sprite-manifest';
import type {
  AnimationDescriptor,
  GirlAction,
  PetAction,
} from './types';

/** 桌面宠物展示缩放：sprite 帧原始尺寸（如 346×288）太大，渲染时缩小显示。
 *  0.4 = 原来 0.2 的一倍（用户要求放大一倍）。 */
const PET_SPRITE_SCALE = 0.4;

export const GIRL_ACTIONS: GirlAction[] = [
  'idle',
  'writing',
  'stretch',
  'drink',
  'turn_page',
  'look_outside',
];

export const PET_ACTIONS: PetAction[] = [
  'idle',
  'greet',
  'cheer',
  'concerned',
  'sleep_enter',
  'sleep_loop',
  'wake',
  'look_at_girl',
  'study_loop',
  'needs_input',
  'ready',
  'move_left',
  'move_right',
  'examining',
];

/* ---------- 宠物 Sprite Sheet Manifest（美术资源，加载失败静默降级 CSS） ---------- */

let petManifest: PetManifest | null = null;
let petAssetBase = '';

/** 预加载一张图，成功返回；失败抛错（用于 sprite 图加载校验） */
const preloadImage = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });

/**
 * 配置宠物 Sprite Sheet 资源目录并加载 Manifest。
 * 资源放 companion.assetBase：pet-manifest.json + 各动作 Spritesheet。
 * 加载失败 / 未配置 → petManifest 保持 null，全部回退 CSS PetActor。
 * 额外校验 sprite 图能真正加载：manifest 在而图失败时也回退 CSS，
 * 避免「manifest 加载了但图空白」的加载丢失（全屏/非全屏都一样）。
 */
export const configurePetSprite = async (assetBase: string | undefined): Promise<void> => {
  petAssetBase = (assetBase ?? '').replace(/\/+$/, '');
  const manifest = await loadPetManifest(
    petAssetBase ? toAssetUrl(`${petAssetBase}/pet-manifest.json`) : undefined
  );
  if (!manifest) {
    petManifest = null;
    return;
  }
  const spriteUrl = toAssetUrl(`${petAssetBase}/${manifest.spritesheet}`);
  if (spriteUrl) {
    try {
      await preloadImage(spriteUrl);
    } catch {
      petManifest = null; // 图加载失败 → 回退 CSS，不显示空白宠物
      return;
    }
  }
  petManifest = manifest;
};

/** 测试用：清空缓存，模拟「无美术资源」状态 */
export const resetPetSprite = (): void => {
  petManifest = null;
  petAssetBase = '';
};

/** v1 角色包兼容：字符串动画名规范化为 CSS descriptor（V4 §13） */
export function normalizeDescriptor(value: string | AnimationDescriptor): AnimationDescriptor {
  if (typeof value !== 'string') return value;
  return { renderer: 'css', loop: false, returnTo: 'idle' };
}

/** 有 Sprite Manifest 时：把语义动作解析为 sprite descriptor；否则 null → CSS fallback */
function tryResolveAsset(actor: string, action: string): AnimationDescriptor | null {
  if (actor !== 'pet' || !petManifest) return null;
  const anim = petManifest.animations[action];
  if (!anim) return null;
  const src = petManifest.spritesheet
    ? toAssetUrl(`${petAssetBase}/${petManifest.spritesheet}`)
    : undefined;
  if (!src) return null;
  return {
    renderer: 'sprite',
    src,
    frameWidth: petManifest.frame.width,
    frameHeight: petManifest.frame.height,
    columns: petManifest.frame.columns,
    rows: petManifest.frame.rows,
    frames: anim.frames,
    fps: anim.fps,
    frameDurationsMs: anim.frameDurationsMs,
    loop: anim.loop,
    fallback: anim.fallback,
    reducedMotionFrame: anim.reducedMotionFrame,
    scale: PET_SPRITE_SCALE,
  };
}

export function resolveAnimation(
  actor: 'girl' | 'pet',
  action: string,
): AnimationDescriptor {
  const fromAsset = tryResolveAsset(actor, action);
  if (fromAsset) return fromAsset;

  const durations =
    actor === 'girl' ? GIRL_ACTION_DURATION : PET_ACTION_DURATION;
  const loopActions = new Set(
    actor === 'girl'
      ? ['idle', 'writing']
      : ['idle', 'sleep_loop', 'look_at_girl', 'study_loop', 'move_left', 'move_right'],
  );

  const durationMs = durations[action];
  const returnTo = actor === 'girl' ? 'writing' : 'idle';
  return {
    renderer: 'css',
    loop: loopActions.has(action),
    ...(durationMs ? { durationMs } : null),
    ...(durationMs ? { returnTo } : null),
  };
}

/** 语义动作 allowlist：未知 action 一律拒绝（V4 §28 / §57） */
export const ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  ...GIRL_ACTIONS,
  ...PET_ACTIONS,
  'sleep',
  'stretch',
  'switch_study_room',
  'switch_library',
  'set_clear',
  'set_rain',
  'set_snow',
]);

export function isAllowedAction(action: string): boolean {
  return ALLOWED_ACTIONS.has(action);
}

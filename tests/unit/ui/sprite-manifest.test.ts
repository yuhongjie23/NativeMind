/**
 * Sprite Sheet 桌宠：帧计算纯函数测试
 *
 * frameOffset（格子 → 背景偏移）与 spriteFrameAt（时刻 → 帧/结束）不依赖 DOM。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  frameDurationMs,
  frameOffset,
  spriteFrameAt,
  toAssetUrl,
  type PetManifest,
} from '@ui/demo/fullscreen-cozy-home/sprite-manifest';

/** 当前默认角色是芙莉莲；改动默认角色时要同步换这里的 manifest 路径 */
const manifest = JSON.parse(
  readFileSync(resolve('public/companions/fulilian/animations/pet-manifest.json'), 'utf8')
) as PetManifest;

/** 应用里实际会触发的宠物动作（含 PetActor 拖拽内部动作） */
const EXPECTED_ACTIONS = [
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
  'drag_lift',
  'drag_hold',
  'drag_left',
  'drag_right',
  'drag_release',
];

describe('fulilian pet-manifest 覆盖', () => {
  it('帧网格合法：5 列 × 8 行，所有帧序号在 [0, 40) 内', () => {
    expect(manifest.frame.columns).toBe(5);
    expect(manifest.frame.rows).toBe(8);
    const total = manifest.frame.columns * manifest.frame.rows;
    for (const animation of Object.values(manifest.animations)) {
      expect(animation.frames.length).toBeGreaterThan(0);
      for (const frame of animation.frames) {
        expect(frame).toBeGreaterThanOrEqual(0);
        expect(frame).toBeLessThan(total);
      }
    }
  });

  it('每个会触发的动作都有 sprite 帧，新角色不静默回退旧 CSS 形象', () => {
    for (const action of EXPECTED_ACTIONS) {
      expect(manifest.animations[action], `missing action: ${action}`).toBeTruthy();
    }
  });
});

describe('frameOffset', () => {
  it('行优先：frame → (col, row) 背景偏移', () => {
    expect(frameOffset(0, 192, 208, 8)).toEqual({ x: 0, y: 0 });
    expect(frameOffset(7, 192, 208, 8)).toEqual({ x: -7 * 192, y: 0 });
    expect(frameOffset(8, 192, 208, 8)).toEqual({ x: 0, y: -208 });
    expect(frameOffset(15, 192, 208, 8)).toEqual({ x: -7 * 192, y: -208 });
  });
});

describe('spriteFrameAt', () => {
  it('一次性动作：按帧推进，播完停在最后一帧并 ended', () => {
    const frames = [0, 1, 2];
    const opts = { fps: 10, loop: false }; // 每帧 100ms
    expect(spriteFrameAt(0, frames, opts)).toEqual({ frame: 0, ended: false });
    expect(spriteFrameAt(150, frames, opts)).toEqual({ frame: 1, ended: false });
    expect(spriteFrameAt(250, frames, opts)).toEqual({ frame: 2, ended: false });
    expect(spriteFrameAt(500, frames, opts)).toEqual({ frame: 2, ended: true });
  });

  it('循环动作：永不 ended，越过总时长后从头再播', () => {
    const frames = [0, 1];
    const opts = { fps: 10, loop: true }; // 每帧 100ms，总 200ms
    expect(spriteFrameAt(0, frames, opts).ended).toBe(false);
    expect(spriteFrameAt(150, frames, opts).frame).toBe(1);
    expect(spriteFrameAt(250, frames, opts).frame).toBe(0); // 循环回第一帧
    expect(spriteFrameAt(250, frames, opts).ended).toBe(false);
  });

  it('loopStart：开场帧只播一次，之后在循环段内循环', () => {
    const frames = [0, 1, 2, 3];
    const opts = { fps: 10, loop: true, loopStart: 2 }; // 0,1 一次性；2,3 循环（总 200ms）
    expect(spriteFrameAt(50, frames, opts).frame).toBe(0);
    expect(spriteFrameAt(150, frames, opts).frame).toBe(1);
    expect(spriteFrameAt(220, frames, opts).frame).toBe(2); // 进入循环段
    expect(spriteFrameAt(320, frames, opts).frame).toBe(3);
    expect(spriteFrameAt(420, frames, opts).frame).toBe(2); // 循环回 2
  });

  it('逐帧时长优先于 fps', () => {
    const frames = [0, 1, 2];
    const opts = { frameDurationsMs: [50, 200, 50], loop: false };
    expect(spriteFrameAt(30, frames, opts).frame).toBe(0);
    expect(spriteFrameAt(60, frames, opts).frame).toBe(1); // 50ms 后进入第 2 帧
    expect(spriteFrameAt(260, frames, opts).frame).toBe(2);
  });

  it('空帧列表 → 直接 ended', () => {
    expect(spriteFrameAt(0, [], { loop: false })).toEqual({ frame: 0, ended: true });
  });

  it('frameDurationMs 由 fps 换算', () => {
    expect(frameDurationMs(10)).toBe(100);
    expect(frameDurationMs(2.5)).toBe(400);
  });
});

describe('toAssetUrl', () => {
  it('保留内置 public 资源路径', () => {
    expect(toAssetUrl('/companions/gugu-gaga/animations/pet-manifest.json')).toBe(
      '/companions/gugu-gaga/animations/pet-manifest.json'
    );
  });

  it('保留远程和已转换资源 URL', () => {
    expect(toAssetUrl('https://example.com/pet.png')).toBe('https://example.com/pet.png');
    expect(toAssetUrl('asset://localhost/pet.png')).toBe('asset://localhost/pet.png');
  });
});

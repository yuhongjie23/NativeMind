/**
 * Provider 侧的可测部分：相似度换算、本机地址校验、空档计算、音频互斥
 * 涉及真实 SQLite / HTTP 的路径留给集成测试。
 */
import { describe, expect, it } from 'vitest';
import { findFreeSlots } from '@infrastructure/calendar/calendar-interface';
import { AudioPlayer, type AudioHandle } from '@infrastructure/audio/audio-player';
import { assertLocalUrl } from '@infrastructure/model-runtime/model-interface';
import { ChromaProvider } from '@infrastructure/vector-store/chroma-provider';
import {
  cosineSimilarity,
  distanceToScore,
} from '@infrastructure/vector-store/vector-store-interface';

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('维度不一致视为不相关而不抛错', () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });
});

describe('distanceToScore', () => {
  it('距离越小分数越高，落在 0-1', () => {
    expect(distanceToScore(0)).toBe(1);
    expect(distanceToScore(1)).toBeCloseTo(0.5);
    expect(distanceToScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('本机地址校验', () => {
  it('放行 localhost 并去掉尾部斜杠', () => {
    expect(assertLocalUrl('http://localhost:11434/')).toBe('http://localhost:11434');
  });

  it('拦截远端地址', () => {
    expect(() => assertLocalUrl('http://example.com:11434')).toThrow('只允许连本机');
    expect(() => new ChromaProvider({ baseUrl: 'http://example.com:8000' })).toThrow('只允许连本机');
  });
});

describe('findFreeSlots', () => {
  const day = (hour: number) => new Date(`2026-07-31T${String(hour).padStart(2, '0')}:00:00.000Z`);

  it('找出日程之间足够长的空档', () => {
    const slots = findFreeSlots(
      [
        {
          id: '1',
          title: '会议',
          startAt: day(10).toISOString(),
          endAt: day(11).toISOString(),
          allDay: false,
        },
      ],
      day(9),
      day(12),
      25
    );

    expect(slots).toHaveLength(2);
    expect(slots[0].endAt).toBe(day(10).toISOString());
  });

  it('忽略太短的间隙', () => {
    const slots = findFreeSlots(
      [
        {
          id: '1',
          title: 'A',
          startAt: day(9).toISOString(),
          endAt: day(11).toISOString(),
          allDay: false,
        },
      ],
      day(9),
      day(11),
      25
    );

    expect(slots).toHaveLength(0);
  });
});

describe('AudioPlayer', () => {
  const createFake = () => {
    const log: string[] = [];
    const factory = (src: string): AudioHandle => ({
      play: async () => {
        log.push(`play:${src}`);
      },
      pause: () => log.push(`pause:${src}`),
      set volume(value: number) {
        log.push(`volume:${src}=${value.toFixed(2)}`);
      },
      set loop(_value: boolean) {},
    });
    return { log, factory };
  };

  it('切换环境音时停掉上一条', async () => {
    const { log, factory } = createFake();
    const player = new AudioPlayer(factory);

    await player.play('focus_rain');
    await player.play('focus_cafe');

    expect(player.playingAmbient).toBe('focus_cafe');
    expect(log).toContain('pause:/audio/ambient/rain.wav');
  });

  it('静音时环境音按 0 音量、提示音不响，取消静音恢复', async () => {
    const { log, factory } = createFake();
    const player = new AudioPlayer(factory);

    await player.play('focus_rain');
    player.setMuted(true);

    // 环境音保持「在播」但音量归零（取消静音能接着响）
    expect(player.playingAmbient).toBe('focus_rain');
    expect(log).toContain('volume:/audio/ambient/rain.wav=0.00');

    // 提示音静音时不响
    await player.play('focus_complete');
    expect(log).not.toContain('play:/audio/cue/complete.wav');

    // 取消静音恢复音量
    player.setMuted(false);
    expect(log).toContain('volume:/audio/ambient/rain.wav=0.35');
  });
});

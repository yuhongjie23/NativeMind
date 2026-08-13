/**
 * 音乐播放核心逻辑单测
 *
 * 播放本身走 HTML Audio + Blob URL，node 环境下没有 DOM 可测；
 * 这里覆盖决定「上一首/下一首/随机」行为的纯函数，正是最容易出错的部分。
 */
import { describe, expect, it } from 'vitest';
import { mimeByExtension, nextIndex, prevIndex } from '@ui/stores/music-store';

describe('nextIndex', () => {
  it('顺序模式按 +1 循环推进', () => {
    expect(nextIndex(0, 3, 'sequence')).toBe(1);
    expect(nextIndex(1, 3, 'sequence')).toBe(2);
    expect(nextIndex(2, 3, 'sequence')).toBe(0);
  });

  it('随机模式不重复当前曲目，单曲时保持不变', () => {
    for (let round = 0; round < 20; round += 1) {
      const next = nextIndex(0, 3, 'shuffle');
      expect([1, 2]).toContain(next);
    }
    expect(nextIndex(0, 1, 'shuffle')).toBe(0);
  });
});

describe('prevIndex', () => {
  it('按 -1 回绕', () => {
    expect(prevIndex(0, 3)).toBe(2);
    expect(prevIndex(2, 3)).toBe(1);
    expect(prevIndex(1, 3)).toBe(0);
  });
});

describe('mimeByExtension', () => {
  it('常见音频扩展映射到正确的 MIME，大小写不敏感', () => {
    expect(mimeByExtension('a.mp3')).toBe('audio/mpeg');
    expect(mimeByExtension('a.wav')).toBe('audio/wav');
    expect(mimeByExtension('a.ogg')).toBe('audio/ogg');
    expect(mimeByExtension('a.m4a')).toBe('audio/mp4');
    expect(mimeByExtension('a.FLAC')).toBe('audio/flac');
  });

  it('未知扩展回退到通用 audio/mpeg', () => {
    expect(mimeByExtension('noext')).toBe('audio/mpeg');
    expect(mimeByExtension('a.xyz')).toBe('audio/mpeg');
  });
});

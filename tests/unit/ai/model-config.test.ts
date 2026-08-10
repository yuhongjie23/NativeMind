/**
 * 双模型配置单测
 * fast → 小模型，coach/deep → 大模型；设置里改了立即生效。
 */
import { describe, expect, it } from 'vitest';
import { getModelConfig, resolveModel, setModelConfig } from '@ai/router/model-config';

describe('model-config', () => {
  it('fast 用小模型，coach/deep 用大模型', () => {
    const { small, big } = getModelConfig();
    expect(resolveModel('fast')).toBe(small);
    expect(resolveModel('coach')).toBe(big);
    expect(resolveModel('deep')).toBe(big);
    expect(small).not.toBe(big);
  });

  it('setModelConfig 后立即生效', () => {
    setModelConfig({ small: 'tiny:1b', big: 'big:32b' });
    expect(resolveModel('fast')).toBe('tiny:1b');
    expect(resolveModel('coach')).toBe('big:32b');
    expect(resolveModel('deep')).toBe('big:32b');
  });
});

/**
 * PrivacyPolicy 默认值测试：外部搜索默认开启，每次联网默认仍需确认
 */
import { describe, expect, it } from 'vitest';
import { PrivacyPolicy } from '@application/policies/privacy-policy';

describe('PrivacyPolicy', () => {
  it('外部搜索默认开启（联网功能可用，每次联网仍需确认）', () => {
    const policy = new PrivacyPolicy();
    expect(policy.canSearchExternally().allowed).toBe(true);
    expect(policy.canSearchExternally().requiresConfirmation).toBe(true);
  });

  it('用户关闭后拒绝联网', () => {
    const policy = new PrivacyPolicy({
      allowExternalSearch: false,
      requireConfirmationPerRequest: true,
    });
    expect(policy.canSearchExternally().allowed).toBe(false);
  });
});

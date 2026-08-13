/**
 * PrivacyPolicy - 隐私与联网裁决
 * 本地优先：笔记原文不出本机；外部搜索默认开启（用户可关），
 * 每次联网默认仍需确认（requireConfirmationPerRequest）。
 */
export interface PrivacySettings {
  /** 允许外部搜索 */
  allowExternalSearch: boolean;
  /** 每次联网都需用户确认 */
  requireConfirmationPerRequest: boolean;
}

export const defaultPrivacySettings: PrivacySettings = {
  allowExternalSearch: true,
  requireConfirmationPerRequest: true,
};

export interface NetworkDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export class PrivacyPolicy {
  constructor(private settings: PrivacySettings = defaultPrivacySettings) {}

  update(patch: Partial<PrivacySettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  get current(): PrivacySettings {
    return this.settings;
  }

  /** 外部搜索裁决 */
  canSearchExternally(): NetworkDecision {
    if (!this.settings.allowExternalSearch) {
      return { allowed: false, requiresConfirmation: false, reason: '外部搜索已在设置中关闭' };
    }
    return { allowed: true, requiresConfirmation: this.settings.requireConfirmationPerRequest };
  }
}

export const privacyPolicy = new PrivacyPolicy();

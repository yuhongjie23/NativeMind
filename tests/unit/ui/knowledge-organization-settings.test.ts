import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@ui/stores/settings-store';
import { repositories, runtime } from '@ui/stores/runtime';
import { getModelConfig, setModelConfig } from '@ai/router/model-config';

describe('knowledge organization consent settings', () => {
  const original = { ...getModelConfig() };
  beforeEach(async () => {
    vi.unstubAllEnvs();
    useSettingsStore.setState({ models: { ...original, apiKey: undefined, knowledgeOrganizationEnabled: false }, error: undefined });
    setModelConfig({ apiKey: undefined, knowledgeOrganizationEnabled: false });
    await repositories.settings.setMany({ 'models.apiKey': '', 'models.knowledgeOrganizationEnabled': 'false' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setModelConfig(original); });

  it('cannot enable without a nonblank key', async () => {
    await useSettingsStore.getState().updateModels({ knowledgeOrganizationEnabled: true, apiKey: '  ' });
    expect(useSettingsStore.getState().models.knowledgeOrganizationEnabled).toBe(false);
    expect(useSettingsStore.getState().error).toContain('API Key');
  });

  it('persists opt-in independently and clears it when the key is removed', async () => {
    await useSettingsStore.getState().updateModels({ apiKey: 'test-key' });
    expect(getModelConfig().knowledgeOrganizationEnabled).toBe(false);
    await useSettingsStore.getState().updateModels({ knowledgeOrganizationEnabled: true });
    await useSettingsStore.getState().load();
    expect(getModelConfig().knowledgeOrganizationEnabled).toBe(true);
    await useSettingsStore.getState().updateModels({ apiKey: undefined });
    expect(getModelConfig().knowledgeOrganizationEnabled).toBe(false);
    expect(await runtime.deepseek.isAvailable('test')).toBe(false);
  });

  it('does not activate consent when persistence fails', async () => {
    vi.spyOn(repositories.settings, 'setMany').mockRejectedValueOnce(new Error('disk full'));
    await useSettingsStore.getState().updateModels({ apiKey: 'test-key', knowledgeOrganizationEnabled: true });
    expect(getModelConfig().knowledgeOrganizationEnabled).toBe(false);
    expect(useSettingsStore.getState().models.knowledgeOrganizationEnabled).toBe(false);
    expect(useSettingsStore.getState().error).toContain('disk full');
  });

  it('ignores restored consent in the Anna local build', async () => {
    vi.stubEnv('VITE_NATIVEMIND_LOCAL_ONLY', 'true');
    await repositories.settings.setMany({ 'models.apiKey': 'test-key', 'models.knowledgeOrganizationEnabled': 'true' });
    await useSettingsStore.getState().load();
    expect(getModelConfig().knowledgeOrganizationEnabled).toBe(false);
    await useSettingsStore.getState().updateModels({ knowledgeOrganizationEnabled: true });
    expect(useSettingsStore.getState().error).toContain('纯本地');
  });
});

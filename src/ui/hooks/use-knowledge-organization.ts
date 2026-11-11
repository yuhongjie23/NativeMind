import { knowledgeOrganizationBlockReason } from '@application/policies/knowledge-organization-policy';
import { isAnna } from '@infrastructure/anna';
import { useSettingsStore } from '../stores/settings-store';
import { aiMode } from '../stores/runtime';

export function useKnowledgeOrganization(): string | undefined {
  return useKnowledgeOrganizationAvailability().blocked;
}

export function useKnowledgeOrganizationAvailability() {
  const models = useSettingsStore((state) => state.models);
  const localOnly = isAnna() || import.meta.env.VITE_NATIVEMIND_LOCAL_ONLY === 'true';
  return {
    canConfigure: !localOnly && aiMode !== 'template',
    blocked: !localOnly && aiMode === 'template'
      ? '浏览器演示模式不支持 DeepSeek 知识整理，请使用桌面版。'
      : knowledgeOrganizationBlockReason({ ...models, localOnly }),
  };
}

/** Cloud organization is opt-in and never available in the local-only edition. */
export function knowledgeOrganizationBlockReason(config: {
  localOnly?: boolean;
  apiKey?: string;
  knowledgeOrganizationEnabled?: boolean;
}): string | undefined {
  if (config.localOnly) return 'Anna 纯本地版不支持 DeepSeek 知识整理；仍可手动关联和本地检索。';
  if (!config.apiKey?.trim()) return '未配置 DeepSeek API Key，无法开启 AI 知识整理。请前往设置配置。';
  if (!config.knowledgeOrganizationEnabled) return 'AI 知识整理未开启。请在设置中了解数据发送范围并开启。';
  return undefined;
}

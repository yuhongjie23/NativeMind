export type EmbeddingPurpose = 'document' | 'query';
const isNomic = (model: string) => model.split(':')[0] === 'nomic-embed-text';
export const embeddingVersion = (model: string, base: string) => isNomic(model) ? `${base}:search-prefix-v1` : base;
export const embeddingInput = (model: string, text: string, purpose: EmbeddingPurpose) =>
  isNomic(model) ? `${purpose === 'query' ? 'search_query' : 'search_document'}: ${text}` : text;

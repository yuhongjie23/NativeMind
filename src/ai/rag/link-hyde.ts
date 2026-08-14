/**
 * 知识关联 HyDE（Hypothetical Document Embeddings）标签生成
 *
 * 思路：判断「两篇笔记是否相关」之前，先让模型假设性地回答——
 * 「如果有一篇和这篇内容相似的旧笔记，它最可能叫什么、打什么标签、
 * 围绕什么主题」。用这些假设标签/主题去检索真实旧笔记，字面不重叠但
 * 语义相近的笔记（如「低秩适配」vs「LoRA」）也能被召回。
 *
 * 生成结果只用于检索（query.tags / 关键词），不落库、不展示（C1）。
 * 模型不可用 / 超时 / 输出不合法一律回退启发式（正文关键词 + 已有标签），
 * 绝不阻塞知识关联流程。
 */
import type { ModelRouter } from '../router/model-router';
import { extractKeywords } from './retrieval-strategy';

export interface HydeTags {
  /** 可能的相似标签（按标签精确匹配旧笔记） */
  tags: string[];
  /** 相关主题/概念关键词（按正文关键词召回） */
  topics: string[];
}

/** 启发式兜底：正文关键词 + 主题词，保证模型不可用时链路不空转 */
const fallbackHyde = (content: string, existingTags: string[]): HydeTags => ({
  tags: [...new Set(existingTags)].slice(0, 6),
  topics: extractKeywords(content, 6),
});

const HYDE_SYSTEM =
  '你是学习笔记检索助手。给你一篇新笔记的内容，请假设性地推断：' +
  '如果知识库里存在与它内容相关/相似的旧笔记，那些旧笔记最可能被打上什么标签、围绕什么主题。' +
  '输出 JSON：tags 是可能的标签（2-6 字为主，贴近真实打标签习惯）；topics 是相关主题/概念关键词（可含英文术语）。' +
  '只输出 JSON，不要其它内容。';

/** 超时包装：模型调用超时视为「生成失败」，走启发式兜底 */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HyDE 标签生成超时')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export class LinkHydeGenerator {
  constructor(private readonly router: ModelRouter, private readonly timeoutMs = 8000) {}

  async generate(content: string, existingTags: string[] = []): Promise<HydeTags> {
    // 输入太短（几句碎片）时模型没什么可假设的，直接走启发式
    if (!content.trim() || content.trim().length < 20) {
      return fallbackHyde(content, existingTags);
    }

    try {
      const result = await withTimeout(
        this.router.run<{ content: string }, { tags?: string[]; topics?: string[] }>({
          taskType: 'tag_generation',
          input: { content },
          inlinePrompt: {
            system: HYDE_SYSTEM,
            user: `新笔记内容：\n${content.slice(0, 2000)}`,
          },
          modelPolicy: {
            // 快档即可：标签生成不需要大模型的理解深度，失败也不值得升级降级链
            preferredTier: 'fast',
            noFallback: true,
            noRetry: true,
          },
        }),
        this.timeoutMs
      );

      if (!result.ok || !result.output) return fallbackHyde(content, existingTags);

      const tags = (result.output.tags ?? []).filter((t) => t.trim()).slice(0, 6);
      const topics = (result.output.topics ?? []).filter((t) => t.trim()).slice(0, 6);
      if (tags.length === 0 && topics.length === 0) return fallbackHyde(content, existingTags);

      return {
        tags: [...new Set([...existingTags, ...tags])].slice(0, 8),
        topics: [...new Set(topics)].slice(0, 6),
      };
    } catch (error) {
      console.warn('[LinkHyde] 标签生成失败，回退启发式:', error);
      return fallbackHyde(content, existingTags);
    }
  }
}

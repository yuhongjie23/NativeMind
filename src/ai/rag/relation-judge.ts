/**
 * 关系判断（§11.3 模型层）
 *
 * 只在候选集上做判断，不做全库扫描。产出的是**建议**，
 * 写入 knowledge_links 必须经用户确认（C1）。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';
import type { AIResult } from '../types';
import type { RetrievalCandidate } from './retrieval-strategy';

/** 固定枚举，模型不得发明（C9）。新增类型要扩枚举 + 升 Schema 版本 */
export const RELATION_TYPES = [
  'same_concept',
  'prerequisite',
  'example_of',
  'contrast',
  'extends',
  'review_later',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

/** 通用端点类型（§13.5）。MVP 只用 note / chunk */
export const LINK_ENDPOINT_TYPES = ['note', 'chunk', 'concept', 'todo', 'review_item'] as const;

export type LinkEndpointType = (typeof LINK_ENDPOINT_TYPES)[number];

/** 模型直出的建议，字段与 knowledge-link.v1.json 对应 */
export interface RawRelationSuggestion {
  toId: string;
  toType?: LinkEndpointType;
  relationType: RelationType;
  reason: string;
  confidence: number;
}

/** 补齐来源端点信息后的建议，交给 UI 展示 */
export interface RelationSuggestion extends RawRelationSuggestion {
  toType: LinkEndpointType;
  toNoteId: string;
  /** 候选原文摘要，UI 展示「为什么相关」时一起给出，避免用户盲选 */
  excerpt: string;
}

export interface JudgeOptions {
  /** 默认展示最相关 3 条，不一次给太多（§13.3） */
  maxLinks: number;
  /** 低置信度建议不展示，宁缺勿滥 */
  minConfidence: number;
}

export const defaultJudgeOptions: JudgeOptions = { maxLinks: 3, minConfidence: 0.6 };

const MAX_SOURCE_CHARS = 1200;
const MAX_CANDIDATE_CHARS = 400;

export class RelationJudge {
  constructor(
    private readonly router: ModelRouter,
    private readonly options: JudgeOptions = defaultJudgeOptions
  ) {}

  /**
   * 返回值区分「模型不可用」和「模型认为没有关系」：
   * 前者 ok=false，UI 应提示功能降级；后者 ok=true 但 suggestions 为空。
   */
  async judge(
    sourceText: string,
    candidates: RetrievalCandidate[]
  ): Promise<{ ok: boolean; suggestions: RelationSuggestion[]; result?: AIResult<RawRelationSuggestion[]> }> {
    if (candidates.length === 0) return { ok: true, suggestions: [] };

    const candidateList = candidates
      .map((c) => `- id: ${c.chunkId}\n  标题: ${truncate(c.title ?? '', 80)}\n  内容: ${truncate(c.text, MAX_CANDIDATE_CHARS)}`)
      .join('\n');

    const result = await this.router.run<{ sourceText: string; candidateIds: string[] }, RawRelationSuggestion[]>({
      taskType: 'rag_relation',
      input: { sourceText, candidateIds: candidates.map((c) => c.chunkId) },
      promptVars: {
        sourceText: truncate(sourceText, MAX_SOURCE_CHARS),
        candidates: candidateList,
        maxLinks: this.options.maxLinks,
      },
    });

    if (!result.ok || !result.output) return { ok: false, suggestions: [], result };

    // 模型可能编造不存在的 id，这里按候选集过滤一遍（Schema 管不了这个）
    const byId = new Map(candidates.map((c) => [c.chunkId, c]));

    const suggestions = result.output
      .filter((s) => s.confidence >= this.options.minConfidence && byId.has(s.toId))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.options.maxLinks)
      .map<RelationSuggestion>((s) => {
        const candidate = byId.get(s.toId)!;
        return {
          ...s,
          toType: s.toType ?? 'chunk',
          toNoteId: candidate.noteId,
          excerpt: truncate(candidate.text, 120),
        };
      });

    return { ok: true, suggestions, result };
  }
}

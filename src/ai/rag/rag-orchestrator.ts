/**
 * RAGOrchestrator - RAG 编排入口（§11.3）
 *
 * 编排三层：规则层 → 向量层 → 模型层，产出「相关旧笔记 + 关系建议」。
 * 只读 + 只产出建议，不写库、不写向量库（C1）。切分与 embedding 的实际落库
 * 由 application 的 note-index-subscriber 转交 BackgroundJob（§4.3）。
 *
 * 扩展位：想加「概念节点」「复盘卡点」作为端点（§13.5），
 * 在 candidateProvider 里多喂一类候选即可，本文件不用改。
 */
import type { ModelRouter } from '../router/model-router';
import { chunkText, defaultChunkOptions, type ChunkDraft, type ChunkOptions } from './chunk-strategy';
import { RelationJudge, type RelationSuggestion } from './relation-judge';
import {
  RetrievalStrategy,
  type RetrievalCandidate,
  type RetrievalQuery,
  type RuleCandidateSource,
} from './retrieval-strategy';

/**
 * 规则层候选来源。由 application 层实现（查 SQLite），
 * AI 层不直接碰数据库（C2 依赖单向）。
 */
export interface CandidateProvider {
  /** 建议实现里带上 limit 与标签过滤，别把全库拉出来 */
  listCandidates(query: RetrievalQuery, limit: number): Promise<RuleCandidateSource[]>;
}

export interface ConnectionResult {
  /** 检索到的相关内容，即便模型层不可用也有值（C3 离线可用） */
  candidates: RetrievalCandidate[];
  /** 关系建议，需用户确认后才写入 knowledge_links */
  suggestions: RelationSuggestion[];
  /** 模型层是否成功。false 时 UI 只展示 candidates，不展示关系 */
  relationJudged: boolean;
}

export interface OrchestratorOptions {
  /** 规则层候选上限，控制模型层输入规模 */
  ruleCandidateLimit: number;
  /** 合并后进入模型层的候选上限 */
  judgeCandidateLimit: number;
  chunkOptions: ChunkOptions;
}

export const defaultOrchestratorOptions: OrchestratorOptions = {
  ruleCandidateLimit: 50,
  judgeCandidateLimit: 8,
  chunkOptions: defaultChunkOptions,
};

export class RAGOrchestrator {
  constructor(
    private readonly retrieval: RetrievalStrategy,
    private readonly judge: RelationJudge,
    private readonly candidateProvider: CandidateProvider,
    private readonly options: OrchestratorOptions = defaultOrchestratorOptions
  ) {}

  /** 纯检索，不调模型。供「查找相关旧笔记」按钮与本地搜索用 */
  async retrieve(query: RetrievalQuery, limit = 10): Promise<RetrievalCandidate[]> {
    const ruleCandidates = await this.candidateProvider.listCandidates(
      query,
      this.options.ruleCandidateLimit
    );
    return this.retrieval.retrieve(query, ruleCandidates, limit);
  }

  /**
   * 检索 + 关系判断。新笔记或新 Todo 落地后调用，
   * 结果交 UI 展示，用户确认后由 application 写入 KnowledgeLink。
   */
  async findConnections(query: RetrievalQuery): Promise<ConnectionResult> {
    const candidates = await this.retrieve(query, this.options.judgeCandidateLimit);
    if (candidates.length === 0) {
      return { candidates: [], suggestions: [], relationJudged: true };
    }

    const { ok, suggestions } = await this.judge.judge(query.text, candidates);
    return { candidates, suggestions, relationJudged: ok };
  }

  /**
   * 切分文本为 chunk 草稿。由 ChunkNoteJob 调用，
   * 落库与 embedding 在 infrastructure 侧完成。
   */
  chunk(text: string, sourceType: 'markdown' | 'pdf' | 'text'): ChunkDraft[] {
    return chunkText(text, sourceType, this.options.chunkOptions);
  }
}

/** 便捷装配，bootstrap 里一行拿到编排器 */
export function createRAGOrchestrator(deps: {
  router: ModelRouter;
  retrieval: RetrievalStrategy;
  candidateProvider: CandidateProvider;
  options?: Partial<OrchestratorOptions>;
}): RAGOrchestrator {
  return new RAGOrchestrator(
    deps.retrieval,
    new RelationJudge(deps.router),
    deps.candidateProvider,
    { ...defaultOrchestratorOptions, ...deps.options }
  );
}

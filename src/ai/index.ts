/**
 * AI 编排层公共出口与装配
 *
 * 上层（application / UI）只从这里引用，不深入内部路径。
 *
 * 装配关系：
 *   ModelProvider ──> ModelRouter ──> 各能力模块
 *   EmbeddingProvider + VectorStore ──> RetrievalStrategy ──> RAGOrchestrator
 *   能力模块 ──> Adapters ──> application/ports 的接口
 *
 * 扩展指引：
 * - 新 AI 任务：types.ts 的 TaskType 加一项 + tier-config 的 TASK_ROUTES 加一行 + 补 prompt/schema
 * - 新能力模块：在这里加一个字段，用例通过 adapters 或直接注入使用
 * - 换模型 / 向量库 / 搜索源：只换 Provider 实现，本文件与业务代码都不动
 */
export * from './types';
export * from './router/tier-config';
export * from './router/model-router';
export * from './prompts';
export * from './schemas';
export * from './evaluation/json-validator';
export * from './rag/chunk-strategy';
export * from './rag/retrieval-strategy';
export * from './rag/relation-judge';
export * from './rag/rag-orchestrator';
export * from './rag/query-rewriter';
export * from './rag/self-rag';
export * from './flora/flora-agent';
export * from './search/keyword-generator';
export * from './search/result-filter';
export * from './search/search-gate';
export * from './companion/interaction-generator';
export * from './adapters';

import {
  CompanionQuestionAdapter,
  DeepQAAdapter,
  FloraAdapter,
  KnowledgeLinkSuggestionAdapter,
  MonthlyDigestAdapter,
  NoteSearchAdapter,
  ReviewGeneratorAdapter,
  SearchResultEnhancerAdapter,
  SocraticQuestionAdapter,
  TodoStructuringAdapter,
} from './adapters';
import { FloraAgent } from './flora/flora-agent';
import { InteractionGenerator, type CompanionVoice } from './companion/interaction-generator';
import {
  RAGOrchestrator,
  createRAGOrchestrator,
  type CandidateProvider,
  type OrchestratorOptions,
} from './rag/rag-orchestrator';
import {
  RetrievalStrategy,
  type RetrievalOptions,
  type RetrievalWeights,
} from './rag/retrieval-strategy';
import { QueryRewriter } from './rag/query-rewriter';
import { ReRanker } from './rag/rerank';
import { SelfRag } from './rag/self-rag';
import { ModelRouter, type RouterOptions } from './router/model-router';
import { getModelConfig } from './router/model-config';
import { KeywordGenerator } from './search/keyword-generator';
import { ResultFilter } from './search/result-filter';
import { SearchGate, type SearchProvider } from './search/search-gate';
import type { EmbeddingProvider, ModelProvider, ModelRunRecorder, RerankProvider, VectorStorePort } from './types';

export interface AILayerDeps {
  /** 本地模型运行时（Ollama / llama.cpp），由 infrastructure 提供 */
  modelProvider: ModelProvider;
  /** 云端 DeepSeek provider（可选）：配置 API key 后教练档走它，未配则全部走本地 */
  deepseekProvider?: ModelProvider;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStorePort;
  /** 规则层候选来源，由 application 层查 SQLite 实现 */
  candidateProvider: CandidateProvider;
  /**
   * 外部搜索 Provider，或每次搜索现取的工厂。
   * 工厂用于「设置里切引擎后无需重启」。不注入则 searchGate 为 undefined，联网功能整体关闭。
   */
  searchProvider?: SearchProvider | (() => SearchProvider);
  /** 专用 cross-encoder 重排（深度检索优先用）。未配置则回退生成式 ReRanker */
  rerankProvider?: RerankProvider;
  /** model_runs 日志落库 */
  modelRunRecorder?: ModelRunRecorder;
  companionVoice?: CompanionVoice;
  options?: {
    router?: RouterOptions;
    retrievalWeights?: RetrievalWeights;
    retrieval?: Partial<RetrievalOptions>;
    orchestrator?: Partial<OrchestratorOptions>;
  };
}

export interface AILayer {
  router: ModelRouter;
  rag: RAGOrchestrator;
  companion: InteractionGenerator;
  /** 未注入 searchProvider 时为 undefined，UI 应据此隐藏联网入口 */
  searchGate?: SearchGate;
  /** 直接对接 application/ports，在 createApplication 的 ai 字段里传入 */
  ports: {
    todoStructuring: TodoStructuringAdapter;
    reviewGenerator: ReviewGeneratorAdapter;
    companionQuestion: CompanionQuestionAdapter;
    socraticQuestion: SocraticQuestionAdapter;
    noteSearch: NoteSearchAdapter;
    suggestionPort: KnowledgeLinkSuggestionAdapter;
    searchResultEnhancer: SearchResultEnhancerAdapter;
    noteDigest: MonthlyDigestAdapter;
    deepQA: DeepQAAdapter;
    flora: FloraAdapter;
  };
}

export function createAILayer(deps: AILayerDeps): AILayer {
  const deepseek = deps.deepseekProvider;
  const local = deps.modelProvider;

  // 组合 provider：本地优先，DeepSeek 兜底。
  // 用于 fast 档——本地小模型不可用（Ollama 没装/模型没拉）但配了 DeepSeek key 时，
  // fast 任务自动走云端，而不是整条链路挂掉。
  const fastWithCloudFallback: ModelProvider = {
    isAvailable: async (model) =>
      (await local.isAvailable(model)) || (deepseek ? await deepseek.isAvailable(model) : false),
    complete: async (request) => {
      if (await local.isAvailable(request.model)) return local.complete(request);
      if (deepseek) return deepseek.complete(request);
      throw new Error('本地模型不可用且未配置 DeepSeek');
    },
  };

  const router = new ModelRouter(
    deps.modelProvider,
    {
      ...deps.options?.router,
      recorder: deps.modelRunRecorder ?? deps.options?.router?.recorder,
    },
    (tier) => {
      if (!deepseek) return null; // 没配 DeepSeek → 全部回退默认（本地）
      // 用户切回本地模式（providerMode='local'）→ 教练档也走本地
      if (getModelConfig().providerMode !== 'deepseek') return null;
      // DeepSeek 模式：coach/deep 走 DeepSeek；fast 本地优先 + DeepSeek 兜底
      return tier === 'fast' ? fastWithCloudFallback : deepseek;
    }
  );

  const retrieval = new RetrievalStrategy(
    deps.embeddingProvider,
    deps.vectorStore,
    deps.options?.retrievalWeights,
    {
      ...deps.options?.retrieval,
      // 深度检索（LLM Multi-Query + HyDE + 模型重排）：模型不可用/慢时内部回退启发式
      queryRewriter: new QueryRewriter(router),
      reranker: new ReRanker(router),
      // cross-encoder 专用重排：有配置时深度检索优先用它，失败回退生成式 ReRanker
      crossEncoder: deps.rerankProvider,
    }
  );

  const rag = createRAGOrchestrator({
    router,
    retrieval,
    candidateProvider: deps.candidateProvider,
    options: deps.options?.orchestrator,
  });

  const companion = new InteractionGenerator(router, deps.companionVoice);

  const searchGate = deps.searchProvider
    ? new SearchGate(deps.searchProvider, new KeywordGenerator(router), new ResultFilter(router))
    : undefined;

  return {
    router,
    rag,
    companion,
    searchGate,
    ports: {
      todoStructuring: new TodoStructuringAdapter(router, rag),
      reviewGenerator: new ReviewGeneratorAdapter(router),
      companionQuestion: new CompanionQuestionAdapter(companion),
      socraticQuestion: new SocraticQuestionAdapter(router, rag),
      noteSearch: new NoteSearchAdapter(rag),
      suggestionPort: new KnowledgeLinkSuggestionAdapter(rag),
      searchResultEnhancer: new SearchResultEnhancerAdapter(router),
      noteDigest: new MonthlyDigestAdapter(router),
      deepQA: new DeepQAAdapter(new SelfRag(router, rag)),
      flora: new FloraAdapter(new FloraAgent(router)),
    },
  };
}

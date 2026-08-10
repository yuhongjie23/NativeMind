/**
 * 生产运行时装配：SQLite 仓储 + 真实 AI 层
 *
 * 与 local-demo.ts 的关系：那个是内存仓储 + 模板 AI，用于测试和无 Tauri 环境的
 * 浏览器预览；这个是真家伙。两者产出结构兼容，UI 侧可以按环境二选一。
 *
 * 装配顺序（有依赖，不能随意调换）：
 *   invoke → SqlDriver ─┐
 *                       ├→ Infrastructure（仓储 / 向量库 / Job 队列）
 *   TauriModelProvider ─┘         │
 *                                 ├→ AILayer（Router / RAG / 四个 Port）
 *                                 └→ Application（用例 / 策略 / 事件）
 *
 * 关键点：AI 层的 candidateProvider 需要 note 仓储，所以必须先有 infrastructure
 * 才能建 AI 层；而 application 又需要 AI 层的 ports。这条链决定了下面的顺序。
 */
import { createAILayer, type AILayer } from '@ai/index';
import { createApplication, type Application } from '@application/bootstrap';
import type { ConfirmPrompt, ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import { createSearchProvider, type HttpFetcher } from '@ai/search/search-providers';
import { getSearchConfig } from '@ai/search/search-config';
import { defaultSearchEngineConfig } from '@shared-types/search-config';

import { TauriSqlDriver, type TauriInvoke } from './db/tauri-driver';
import type { EbookDocument, PdfDocument } from './file-import';
import { createInfrastructure, type Infrastructure } from './index';
import { TauriModelProvider } from './model-runtime/tauri-model-provider';
import { NoteCandidateProvider } from './rag/note-candidate-provider';

/** 后台任务轮询间隔。索引不是实时需求，给长一点省电 */
const DRAIN_INTERVAL_MS = 30_000;

export interface TauriRuntimeOptions {
  /** 由 UI 注入 @tauri-apps/api 的 invoke，便于测试替换 */
  invoke: TauriInvoke;
  confirmationPrompt: ConfirmationPrompt;
  /** 简单确认入口（删除等破坏性操作） */
  confirmPrompt?: ConfirmPrompt;
  embeddingModel?: string;
  /** 向量维度需与 embedding 模型匹配，nomic-embed-text 是 768 */
  vectorDimension?: number;
}

export interface TauriRuntime {
  application: Application;
  infrastructure: Infrastructure;
  ai: AILayer;
  /** 与 LocalDemoRuntime.aiMode 对齐：这条路径上是真模型 */
  aiMode: 'model';
  repositories: Infrastructure['repositories'];

  /** 建表 → 恢复中断任务 → 起轮询。返回停止轮询的函数 */
  start(): Promise<() => void>;
}

export const createTauriRuntime = (options: TauriRuntimeOptions): TauriRuntime => {
  const driver = new TauriSqlDriver(options.invoke);

  const modelProvider = new TauriModelProvider(options.invoke, {
    embeddingModel: options.embeddingModel,
  });

  const infrastructure = createInfrastructure({
    driver,
    fileImport: {
      // 文本读取交给 Rust：WebView 没有文件系统权限
      readTextFile: (uri: string) => options.invoke<string>('file_read_text', { path: uri }),
      pdfExtractor: (uri: string) => options.invoke<PdfDocument>('file_extract_pdf', { path: uri }),
      // PDF：Rust 侧 file_extract_pdf 用 pdf-extract 按页抽取，返回与 PdfDocument 一致
      ebookExtractor: (uri: string) =>
        options.invoke<EbookDocument>('file_extract_ebook', { path: uri }),
      // 电子书：Rust 侧 file_extract_ebook 用 lib-epub / mobi 解包，返回分章节文本
    },
    vectorStore: { kind: 'sqlite-vec', dimension: options.vectorDimension },
    // 直接注入 Tauri IPC 版 provider：embedJob 等内部引用也会用它，
    // 避免桌面端嵌入向量还走 WebView fetch 本机 Ollama
    modelRuntime: { kind: 'custom', provider: modelProvider },
  });

  const infra: Infrastructure = infrastructure;

  const httpFetcher: HttpFetcher = {
    fetchText: async (url: string) => {
      const response = await options.invoke<{ body: string; status: number; finalUrl: string }>(
        'search_fetch',
        { url }
      );
      return response.body;
    },
  };

  // 每次搜索现取配置：用户在设置里切了引擎不用重启。配置无效（如自定义没填 URL）时退回默认
  const searchProvider = () => {
    try {
      return createSearchProvider(getSearchConfig(), httpFetcher);
    } catch {
      return createSearchProvider(defaultSearchEngineConfig, httpFetcher);
    }
  };

  const ai = createAILayer({
    modelProvider,
    embeddingProvider: modelProvider,
    vectorStore: infra.vectorStore,
    candidateProvider: new NoteCandidateProvider(infra.repositories.note),
    modelRunRecorder: infra.modelRunRecorder,
    searchProvider,
    rerankProvider: infra.rerank,
  });

  const application = createApplication({
    repositories: {
      todo: infra.repositories.todo,
      focus: infra.repositories.focus,
      note: infra.repositories.note,
      review: infra.repositories.review,
      companionInteraction: infra.repositories.companionInteraction,
      socratic: infra.repositories.socratic,
      knowledgeLink: infra.repositories.knowledgeLink,
      audit: infra.repositories.audit,
      ask: infra.repositories.ask,
      checkIn: infra.repositories.checkIn,
      letter: infra.repositories.letter,
      settings: infra.repositories.settings,

      actionProposal: infra.repositories.actionProposal,
    },
    ai: {
      ...ai.ports,
      searchGate: ai.searchGate,
      // whats_up 来信：Flora 的近况见闻来自网络搜索（失败则空，来信退化为通用近况）
      searchBrief: async (query) => {
        try {
          const provider = searchProvider();
          const results = await provider.search(query, 3);
          const first = results[0];
          return first?.title ?? first?.snippet ?? null;
        } catch {
          return null;
        }
      },
    },
    infrastructure: {
      fileImport: infra.fileImport,
      jobQueue: infra.jobQueue,
      // 陪伴状态机目前只记录当前场景，无持久化需求
      companionStateMachine: { transition: async () => undefined },
      // 删除笔记时清理其向量
      vectorCleanup: infra.vectorStore,
    },
    confirmationPrompt: options.confirmationPrompt,
    confirmPrompt: options.confirmPrompt,
  });

  /**
   * 建表只允许发生一次。
   *
   * StrictMode 会把挂载 effect 跑两遍，两次 startRuntime() 并发进来时，
   * 都会读到空的 schema_migrations，于是都去跑 001_init —— 后到的那个
   * 撞上 "table todos already exists"，把一个其实已经成功的初始化
   * 报成启动失败。这里用 Promise 去重，两次调用共享同一次初始化。
   *
   * 失败时清掉缓存：初始化没成功就该允许下次重试，
   * 否则一次偶发失败会把整个会话钉死在错误页。
   */
  let initializing: Promise<void> | undefined;
  const initializeOnce = (): Promise<void> => {
    initializing ??= infra.initialize().catch((error: unknown) => {
      initializing = undefined;
      throw error;
    });
    return initializing;
  };

  const start = async (): Promise<() => void> => {
    await initializeOnce();


    // 专注期间不跑后台任务：embedding 会占满 CPU，直接毁掉专注体验（§4.3）
    const timer = setInterval(() => {
      if (application.policies.focus.isActive()) return;
      void infra.jobQueue.drain().catch((error) => {
        // 单次失败不该让轮询停摆，任务自身有重试计数
        console.warn('[TauriRuntime] 后台任务执行失败:', error);
      });
    }, DRAIN_INTERVAL_MS);

    return () => clearInterval(timer);
  };

  return {
    application,
    infrastructure: infra,
    ai,
    aiMode: 'model',
    repositories: infra.repositories,
    start,
  };
}

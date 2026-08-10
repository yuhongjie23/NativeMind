/**
 * 基础设施层装配
 *
 * 对外只暴露一个 createInfrastructure：给它驱动和配置，
 * 拿回一组已经接好线的 Repository / Provider / Job 队列，直接喂给 createApplication。
 *
 * 选型都遵循「本地优先 + 可降级」：
 * - 向量库默认 sqlite-vec，探测不到就用关键词检索兜底（C3）
 * - 模型运行时默认 Ollama，可切 llama.cpp
 * - 日历默认 Noop，不碰用户隐私数据
 */
import { Database, type SqlDriver } from './db/database';
import { SqliteAskSessionRepository } from './db/repositories/ask-repository';
import { SqliteDailyCheckInRepository } from './db/repositories/checkin-repository';
import { SqliteCompanionRepository } from './db/repositories/companion-repository';
import { SqliteFocusRepository } from './db/repositories/focus-repository';
import { SqliteLetterRepository } from './db/repositories/letter-repository';
import { SqliteKnowledgeLinkRepository } from './db/repositories/knowledge-link-repository';

import { SqliteNoteRepository } from './db/repositories/note-repository';
import { SqliteReviewRepository } from './db/repositories/review-repository';
import {
  SqliteActionProposalRepository,
  SqliteAuditRepository,
  SqliteModelRunRecorder,
  SqliteSettingsRepository,
  SqliteSocraticRepository,
} from './db/repositories/support-repositories';
import { SqliteTodoRepository } from './db/repositories/todo-repository';

import { ChromaProvider } from './vector-store/chroma-provider';
import { SqliteVecProvider } from './vector-store/sqlite-vec-provider';
import type { VectorStoreProvider } from './vector-store/vector-store-interface';

import { FileImportService, type FileImportOptions } from './file-import';
import { LlamaCppRerankProvider } from './model-runtime/llama-cpp-rerank-provider';
import { LlamaCppProvider, type LlamaCppOptions } from './model-runtime/llama-cpp-provider';
import { OllamaProvider, type OllamaOptions } from './model-runtime/ollama-provider';
import type { EmbeddingProvider, ModelRuntime } from './model-runtime/model-interface';

import { AudioPlayer } from './audio/audio-player';
import { NoopCalendarProvider, type CalendarProvider } from './calendar/calendar-interface';

import { ChunkNoteJob } from './background-jobs/chunk-note-job';
import { EmbedChunksJob } from './background-jobs/embed-job';
import { JobQueue } from './background-jobs/job-queue';
import { ParseNoteJob } from './background-jobs/parse-note-job';
import { ReindexNoteJob } from './background-jobs/reindex-note-job';

export * from './db/database';
export * from './vector-store/vector-store-interface';
export * from './model-runtime/model-interface';
export * from './background-jobs/job-queue';
export { AudioPlayer } from './audio/audio-player';
export { NoopCalendarProvider, findFreeSlots } from './calendar/calendar-interface';

export interface InfrastructureConfig {
  driver: SqlDriver;
  fileImport: FileImportOptions;
  modelRuntime?:
    | { kind: 'ollama'; options?: OllamaOptions }
    | { kind: 'llama.cpp'; options?: LlamaCppOptions }
    /** 注入外部已建好的 provider（桌面端用 Tauri IPC 通道）；embedJob 等内部引用会用它 */
    | { kind: 'custom'; provider: ModelRuntime & EmbeddingProvider };
  /** 可选：专用 cross-encoder 重排（本地 llama-server 跑 bge-reranker 类模型）。未配置则深度检索用生成式重排 */
  rerank?: { baseUrl?: string; model?: string };
  vectorStore?: { kind: 'sqlite-vec' | 'chroma'; dimension?: number; baseUrl?: string };
  calendar?: CalendarProvider;
  /** 专注期间暂停后台任务，由 application 的 FocusModePolicy 提供 */
  canRunJobs?: () => boolean | Promise<boolean>;
  /** 一篇笔记索引完成后的回调（前端 NoteIndexed 事件，用于刷新列表） */
  onNoteIndexed?: (noteId: string) => void;
}

export interface Infrastructure {
  db: Database;
  repositories: {
    todo: SqliteTodoRepository;
    focus: SqliteFocusRepository;
    note: SqliteNoteRepository;
    review: SqliteReviewRepository;
    companionInteraction: SqliteCompanionRepository;
    socratic: SqliteSocraticRepository;
    knowledgeLink: SqliteKnowledgeLinkRepository;
    audit: SqliteAuditRepository;
    ask: SqliteAskSessionRepository;
    checkIn: SqliteDailyCheckInRepository;
    letter: SqliteLetterRepository;

    actionProposal: SqliteActionProposalRepository;
    settings: SqliteSettingsRepository;
  };
  modelRuntime: ModelRuntime & EmbeddingProvider;
  /** 未配置 rerank 服务时为 undefined，深度检索回退生成式重排 */
  rerank?: LlamaCppRerankProvider;
  modelRunRecorder: SqliteModelRunRecorder;
  vectorStore: VectorStoreProvider;
  fileImport: FileImportService;
  jobQueue: JobQueue;
  /** 索引任务（装配阶段由 bootstrap 接 NoteIndexed 事件），demo 内存运行时可缺省 */
  embedJob?: EmbedChunksJob;
  audioPlayer: AudioPlayer;
  calendar: CalendarProvider;
  /** 建表 + 恢复上次中断的任务，启动时调一次 */
  initialize(): Promise<void>;
}

const createModelRuntime = (config: InfrastructureConfig): ModelRuntime & EmbeddingProvider => {
  if (config.modelRuntime?.kind === 'llama.cpp') {
    return new LlamaCppProvider(config.modelRuntime.options);
  }
  if (config.modelRuntime?.kind === 'custom') {
    return config.modelRuntime.provider;
  }
  return new OllamaProvider(config.modelRuntime?.options);
};

const createVectorStore = (db: Database, config: InfrastructureConfig): VectorStoreProvider => {
  if (config.vectorStore?.kind === 'chroma') {
    return new ChromaProvider({
      baseUrl: config.vectorStore.baseUrl,
      dimension: config.vectorStore.dimension,
    });
  }
  return new SqliteVecProvider(db, config.vectorStore?.dimension);
};

export function createInfrastructure(config: InfrastructureConfig): Infrastructure {
  const db = new Database(config.driver);

  const notes = new SqliteNoteRepository(db);
  const letters = new SqliteLetterRepository(db);
  const modelRuntime = createModelRuntime(config);
  const vectorStore = createVectorStore(db, config);
  const fileImport = new FileImportService(config.fileImport);

  const jobQueue = new JobQueue(db, { canRun: config.canRunJobs });
  jobQueue.register(new ParseNoteJob(notes, fileImport, jobQueue));
  jobQueue.register(new ChunkNoteJob(notes, jobQueue, vectorStore));
  const embedJob = new EmbedChunksJob(notes, modelRuntime, vectorStore, {
    onIndexed: config.onNoteIndexed,
  });
  jobQueue.register(embedJob);
  // 编辑笔记内容触发的事件入队 reindex_note，只转发回 parse_note 复用整条链路
  jobQueue.register(new ReindexNoteJob(jobQueue));

  return {
    db,
    repositories: {
      todo: new SqliteTodoRepository(db),
      focus: new SqliteFocusRepository(db),
      note: notes,
      review: new SqliteReviewRepository(db),
      companionInteraction: new SqliteCompanionRepository(db),
      socratic: new SqliteSocraticRepository(db),
      knowledgeLink: new SqliteKnowledgeLinkRepository(db),
      audit: new SqliteAuditRepository(db),
      ask: new SqliteAskSessionRepository(db),
      checkIn: new SqliteDailyCheckInRepository(db),
      letter: letters,

      actionProposal: new SqliteActionProposalRepository(db),
      settings: new SqliteSettingsRepository(db),
    },
    modelRuntime,
    rerank: config.rerank ? new LlamaCppRerankProvider(config.rerank) : undefined,
    modelRunRecorder: new SqliteModelRunRecorder(db),
    vectorStore,
    fileImport,
    jobQueue,
    embedJob,
    audioPlayer: new AudioPlayer(),
    calendar: config.calendar ?? new NoopCalendarProvider(),
    initialize: async () => {
      // 先修复「列已存在但迁移未记录」的旧库状态，再跑迁移，避免 duplicate column
      await letters.syncSchemaState();
      await db.migrate();
      await jobQueue.recoverStaleJobs();
      // 向量维度变化会触发全量重建（DROP + 笔记打回 stale）：检测到就把 stale 笔记
      // 重新入队，让 parse→chunk→embed 流水线整体重建，而不是静默丢向量
      await vectorStore.isAvailable();
      if (vectorStore.didRebuild) {
        const stale = await notes.findByIndexStatus('stale', 200);
        for (const note of stale) {
          await jobQueue.enqueue({ type: 'parse_note', entityId: note.id });
        }
      }
    },
  };
}

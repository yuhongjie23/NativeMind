/**
 * 应用层装配

 * 注入基础设施/AI 实现，构建用例并注册事件订阅者。
 */
import type { ActionProposalRepository } from './confirmation/action-proposal';
import {
  ConfirmationService,
  type ConfirmationPrompt,
  type ConfirmPrompt,
} from './confirmation/confirmation-service';

import { SimpleEventBus, type EventBus } from './events/event-bus';
import { registerAuditSubscriber } from './events/subscribers/audit-subscriber';
import { registerCheckInSubscriber } from './events/subscribers/checkin-subscriber';
import { registerCompanionSubscriber } from './events/subscribers/companion-subscriber';
import { registerNoteIndexSubscriber } from './events/subscribers/note-index-subscriber';
import { FocusModePolicy } from './policies/focus-mode-policy';
import { InteractionPolicy } from './policies/interaction-policy';
import { PrivacyPolicy, type PrivacySettings } from './policies/privacy-policy';

import type {
  AskNotesPort,
  AskSessionRepository,
  AuditRepository,
  CompanionInteractionRepository,
  DailyCheckInRepository,
  FloraPort,
  LetterRepository,
  SettingsKeyValuePort,
  AppUsageRepository,
  CompanionQuestionPort,
  CompanionStateMachinePort,
  FileImportPort,
  FocusRepository,
  JobQueuePort,
  KnowledgeLinkRepository,
  KnowledgeLinkSuggestionPort,
  NoteRepository,
  NoteSearchPort,
  NoteVectorCleanupPort,
  ReviewGeneratorPort,
  ReviewRepository,
  SearchResultEnhancerPort,
  SocraticQuestionPort,
  SocraticRepository,
  TodoRepository,
  TodoStructuringPort,
} from './ports';
import { DeleteAskSessionUseCase } from './use-cases/ask/delete-ask-session';
import { ListAskSessionsUseCase } from './use-cases/ask/list-ask-sessions';
import { SaveAskSessionUseCase } from './use-cases/ask/save-ask-session';
import { GetDailyCheckInUseCase } from './use-cases/checkin/get-daily-checkin';
import { ListDailyCheckInsUseCase } from './use-cases/checkin/list-month-checkins';
import { RecordDailyCheckInUseCase } from './use-cases/checkin/record-daily-checkin';
import { AppUsageTracker } from './use-cases/usage/app-usage-tracker';
import { DeleteConversationUseCase } from './use-cases/flora/delete-conversation';
import { GenerateIncomingLetterUseCase } from './use-cases/flora/generate-incoming-letter';
import { ListConversationsUseCase } from './use-cases/flora/list-conversations';
import { ListLettersUseCase } from './use-cases/flora/list-letters';
import { ProcessLettersUseCase } from './use-cases/flora/process-letters';
import { SendLetterUseCase } from './use-cases/flora/send-letter';
import { WriteLetterUseCase } from './use-cases/flora/write-letter';
import { ArchiveKnowledgeLinkUseCase } from './use-cases/knowledge-link/archive-link';
import { CreateKnowledgeLinkUseCase } from './use-cases/knowledge-link/create-link';
import { QueryKnowledgeLinksUseCase } from './use-cases/knowledge-link/query-links';
import { SuggestKnowledgeLinksUseCase } from './use-cases/knowledge-link/suggest-links';

import { HandleUserResponseUseCase } from './use-cases/companion/handle-user-response';
import { TriggerInteractionUseCase } from './use-cases/companion/trigger-interaction';
import { AbortFocusUseCase } from './use-cases/focus/abort-focus';
import { CompleteFocusUseCase } from './use-cases/focus/complete-focus';
import { StartFocusUseCase } from './use-cases/focus/start-focus';
import { AskNotesUseCase, emptyAskNotesAnswer } from './use-cases/note/ask-notes';
import { EnhanceSearchResultsUseCase } from './use-cases/note/enhance-search-results';
import { ImportNoteUseCase } from './use-cases/note/import-note';
import { SearchNotesUseCase } from './use-cases/note/search-notes';
import { UpdateNoteUseCase } from './use-cases/note/update-note';
import type { SearchGate } from '@ai/search/search-gate';
import { GenerateDailyReviewUseCase } from './use-cases/review/generate-daily-review';
import { GenerateWeeklyReviewUseCase } from './use-cases/review/generate-weekly-review';
import { GenerateMonthlyReviewUseCase } from './use-cases/review/generate-monthly-review';
import { RecoverPendingReviewUseCase } from './use-cases/review/recover-pending-review';
import { DeleteReviewUseCase } from './use-cases/review/delete-review';
import { UpdateReviewUseCase } from './use-cases/review/update-review';
import { ProactiveCompanionTickUseCase } from './use-cases/companion/proactive-tick';
import { CompanionContextBuilder } from './use-cases/companion/companion-context';
import { DeleteNoteUseCase } from './use-cases/note/delete-note';
import { AbandonSocraticSessionUseCase } from './use-cases/socratic/abandon-session';
import { AskSocraticQuestionUseCase } from './use-cases/socratic/ask-question';
import { CompleteSocraticSessionUseCase } from './use-cases/socratic/complete-session';
import { StartSocraticSessionUseCase } from './use-cases/socratic/start-session';

import { CompleteTodoUseCase } from './use-cases/todo/complete-todo';
import { CreateTodoUseCase } from './use-cases/todo/create-todo';
import { DeleteTodoUseCase } from './use-cases/todo/delete-todo';
import { UpdateTodoUseCase } from './use-cases/todo/update-todo';

export interface ApplicationDeps {
  repositories: {
    todo: TodoRepository;
    focus: FocusRepository;
    note: NoteRepository;
    review: ReviewRepository;
    companionInteraction: CompanionInteractionRepository;
    socratic: SocraticRepository;
    knowledgeLink: KnowledgeLinkRepository;
    audit: AuditRepository;
    ask: AskSessionRepository;
    checkIn: DailyCheckInRepository;
    appUsage: AppUsageRepository;
    letter: LetterRepository;
    settings: SettingsKeyValuePort;
    actionProposal: ActionProposalRepository;
  };

  ai: {
    todoStructuring?: TodoStructuringPort;
    reviewGenerator: ReviewGeneratorPort;
    companionQuestion: CompanionQuestionPort;
    socraticQuestion: SocraticQuestionPort;
    noteSearch: NoteSearchPort;
    suggestionPort: KnowledgeLinkSuggestionPort;
    searchResultEnhancer?: SearchResultEnhancerPort;
    /** 不注入则外部搜索整体关闭 */
    searchGate?: SearchGate;
    /** 深度问答（Self-RAG）。未注入则 askNotes 用例返回空降级 */
    askNotes?: AskNotesPort;
    /** Flora 写信。未注入则 sendLetter 用例返回空降级 */
    flora?: FloraPort;
    /** whats_up 来信用的「一句近期见闻」搜索（可选，未注入则退化为通用近况） */
    searchBrief?: (query: string) => Promise<string | null>;
  };
  infrastructure: {
    fileImport: FileImportPort;
    jobQueue: JobQueuePort;
    companionStateMachine: CompanionStateMachinePort;
    /** 删除笔记时清理向量（可选，web 演示没有向量库） */
    vectorCleanup?: NoteVectorCleanupPort;
    /** 笔记索引完成回调（装配阶段接 NoteIndexed 事件） */
    embedJob?: { setOnIndexed(fn: (noteId: string, chunkCount: number) => void): void };
  };
  /** UI 侧确认入口 */
  confirmationPrompt: ConfirmationPrompt;
  /** UI 侧简单确认入口（删除等破坏性操作），未提供时默认拒绝 */
  confirmPrompt?: ConfirmPrompt;
  privacySettings?: Partial<PrivacySettings>;
}

export interface Application {
  eventBus: EventBus;
  policies: {
    focus: FocusModePolicy;
    interaction: InteractionPolicy;
    privacy: PrivacyPolicy;
  };
  confirmation: ConfirmationService;
  useCases: {
    createTodo: CreateTodoUseCase;
    completeTodo: CompleteTodoUseCase;
    updateTodo: UpdateTodoUseCase;
    deleteTodo: DeleteTodoUseCase;
    startFocus: StartFocusUseCase;
    completeFocus: CompleteFocusUseCase;
    abortFocus: AbortFocusUseCase;
    importNote: ImportNoteUseCase;
    updateNote: UpdateNoteUseCase;
    deleteNote: DeleteNoteUseCase;
    searchNotes: SearchNotesUseCase;
    askNotes: AskNotesUseCase;
    saveAskSession: SaveAskSessionUseCase;
    listAskSessions: ListAskSessionsUseCase;
    deleteAskSession: DeleteAskSessionUseCase;
    recordDailyCheckIn: RecordDailyCheckInUseCase;
    getDailyCheckIn: GetDailyCheckInUseCase;
    listDailyCheckIns: ListDailyCheckInsUseCase;
    sendLetter: SendLetterUseCase;
    writeLetter: WriteLetterUseCase;
    processLetters: ProcessLettersUseCase;
    listLetters: ListLettersUseCase;
    listConversations: ListConversationsUseCase;
    deleteConversation: DeleteConversationUseCase;
    generateIncomingLetter: GenerateIncomingLetterUseCase;
    enhanceSearchResults: EnhanceSearchResultsUseCase;
    generateDailyReview: GenerateDailyReviewUseCase;
    generateWeeklyReview: GenerateWeeklyReviewUseCase;
    generateMonthlyReview: GenerateMonthlyReviewUseCase;
    recoverPendingReview: RecoverPendingReviewUseCase;
    deleteReview: DeleteReviewUseCase;
    updateReview: UpdateReviewUseCase;
    triggerInteraction: TriggerInteractionUseCase;
    handleUserResponse: HandleUserResponseUseCase;
    proactiveCompanionTick: ProactiveCompanionTickUseCase;
    startSocraticSession: StartSocraticSessionUseCase;
    askSocraticQuestion: AskSocraticQuestionUseCase;
    completeSocraticSession: CompleteSocraticSessionUseCase;
    abandonSocraticSession: AbandonSocraticSessionUseCase;

    queryKnowledgeLinks: QueryKnowledgeLinksUseCase;
    createKnowledgeLink: CreateKnowledgeLinkUseCase;
    archiveKnowledgeLink: ArchiveKnowledgeLinkUseCase;
    suggestKnowledgeLinks: SuggestKnowledgeLinksUseCase;

    appUsage: AppUsageTracker;
  };

  /** 注销所有订阅者 */
  dispose(): void;
}

export function createApplication(deps: ApplicationDeps): Application {
  const { repositories: repos, ai, infrastructure: infra } = deps;

  const eventBus = new SimpleEventBus();
  // 笔记索引完成 → 发布 NoteIndexed，前端刷新列表（之前只定义不发布，导入后一直显示「索引中」）
  infra.embedJob?.setOnIndexed((noteId, chunkCount) => {
    void eventBus.publish({
      type: 'NoteIndexed',
      noteId,
      chunkCount,
      timestamp: new Date().toISOString(),
    });
  });
  const confirmation = new ConfirmationService(
    repos.actionProposal,
    deps.confirmationPrompt,
    deps.confirmPrompt
  );

  const focusPolicy = new FocusModePolicy();
  const privacyPolicy = new PrivacyPolicy();
  if (deps.privacySettings) privacyPolicy.update(deps.privacySettings);
  const interactionPolicy = new InteractionPolicy(repos.companionInteraction, focusPolicy);

  const triggerInteraction = new TriggerInteractionUseCase(
    repos.companionInteraction,
    ai.companionQuestion,
    interactionPolicy,
    eventBus,
    new CompanionContextBuilder(repos.todo, repos.focus, repos.companionInteraction)
  );

  const generateDailyReview = new GenerateDailyReviewUseCase(
    repos.review,
    repos.todo,
    repos.focus,
    ai.reviewGenerator,
    confirmation,
    eventBus,
    focusPolicy,
    repos.appUsage,
    repos.knowledgeLink,
    repos.note
  );

  const useCases: Application['useCases'] = {
    createTodo: new CreateTodoUseCase(repos.todo, eventBus, confirmation, ai.todoStructuring),
    completeTodo: new CompleteTodoUseCase(repos.todo, eventBus),
    updateTodo: new UpdateTodoUseCase(repos.todo, eventBus),
    deleteTodo: new DeleteTodoUseCase(repos.todo, eventBus),
    startFocus: new StartFocusUseCase(repos.focus, eventBus, focusPolicy),
    completeFocus: new CompleteFocusUseCase(repos.focus, eventBus, focusPolicy),
    abortFocus: new AbortFocusUseCase(repos.focus, eventBus, focusPolicy),
    importNote: new ImportNoteUseCase(repos.note, infra.fileImport, eventBus),
    updateNote: new UpdateNoteUseCase(repos.note, infra.fileImport, eventBus),
    deleteNote: new DeleteNoteUseCase(repos.note, infra.vectorCleanup, confirmation, eventBus, repos.knowledgeLink),
    searchNotes: new SearchNotesUseCase(ai.noteSearch, privacyPolicy, focusPolicy, deps.ai.searchGate),
    askNotes: new AskNotesUseCase(
      ai.askNotes ?? { ask: async () => emptyAskNotesAnswer }
    ),
    saveAskSession: new SaveAskSessionUseCase(repos.ask),
    listAskSessions: new ListAskSessionsUseCase(repos.ask),
    deleteAskSession: new DeleteAskSessionUseCase(repos.ask),
    recordDailyCheckIn: new RecordDailyCheckInUseCase(repos.todo, repos.focus, repos.checkIn),
    getDailyCheckIn: new GetDailyCheckInUseCase(repos.checkIn),
    listDailyCheckIns: new ListDailyCheckInsUseCase(repos.checkIn),
    sendLetter: new SendLetterUseCase(
      ai.flora ?? { sendLetter: async () => ({ reply: '', verified: false, regenerated: false, ok: false }) }
    ),
    writeLetter: new WriteLetterUseCase(
      repos.letter,
      ai.flora ?? { sendLetter: async () => ({ reply: '', verified: false, regenerated: false, ok: false }) }
    ),
    processLetters: new ProcessLettersUseCase(
      repos.letter,
      ai.flora ?? { sendLetter: async () => ({ reply: '', verified: false, regenerated: false, ok: false }) }
    ),
    listLetters: new ListLettersUseCase(repos.letter),
    listConversations: new ListConversationsUseCase(repos.letter),
    deleteConversation: new DeleteConversationUseCase(repos.letter),
    generateIncomingLetter: new GenerateIncomingLetterUseCase(
      repos.letter,
      repos.settings,
      deps.ai.searchBrief
    ),
    enhanceSearchResults: new EnhanceSearchResultsUseCase(
      ai.searchResultEnhancer ?? { enhance: async (results) => results.map((r, i) => ({ id: r.id, summary: r.text.slice(0, 40), rank: i + 1 })) }
    ),
    generateDailyReview,
    generateWeeklyReview: new GenerateWeeklyReviewUseCase(
      repos.review,
      repos.todo,
      repos.focus,
      ai.reviewGenerator,
      confirmation,
      eventBus,
      focusPolicy,
      repos.appUsage,
      repos.knowledgeLink,
      repos.note
    ),
    generateMonthlyReview: new GenerateMonthlyReviewUseCase(
      repos.review,
      repos.todo,
      repos.focus,
      ai.reviewGenerator,
      confirmation,
      eventBus,
      focusPolicy,
      repos.appUsage,
      repos.knowledgeLink,
      repos.note
    ),
    recoverPendingReview: new RecoverPendingReviewUseCase(
      repos.actionProposal,
      repos.review,
      confirmation,
      eventBus
    ),
    deleteReview: new DeleteReviewUseCase(repos.review, confirmation, eventBus),
    updateReview: new UpdateReviewUseCase(repos.review),
    triggerInteraction,
    handleUserResponse: new HandleUserResponseUseCase(
      repos.companionInteraction,
      ai.companionQuestion,
      eventBus
    ),
    proactiveCompanionTick: new ProactiveCompanionTickUseCase(
      repos.todo,
      repos.focus,
      repos.companionInteraction,
      interactionPolicy,
      ai.companionQuestion
    ),
    // 传入 focusPolicy：专注中禁止开启提问会话，判断在用例层而不是只靠 UI 禁按钮
    startSocraticSession: new StartSocraticSessionUseCase(repos.socratic, eventBus, focusPolicy),
    askSocraticQuestion: new AskSocraticQuestionUseCase(repos.socratic, ai.socraticQuestion),
    completeSocraticSession: new CompleteSocraticSessionUseCase(repos.socratic),
    abandonSocraticSession: new AbandonSocraticSessionUseCase(repos.socratic),

    queryKnowledgeLinks: new QueryKnowledgeLinksUseCase(repos.knowledgeLink),
    createKnowledgeLink: new CreateKnowledgeLinkUseCase(
      repos.knowledgeLink,
      eventBus,
      confirmation
    ),
    suggestKnowledgeLinks: new SuggestKnowledgeLinksUseCase(
      repos.note,
      repos.knowledgeLink,
      ai.suggestionPort,
      new CreateKnowledgeLinkUseCase(repos.knowledgeLink, eventBus, confirmation)
    ),
    archiveKnowledgeLink: new ArchiveKnowledgeLinkUseCase(repos.knowledgeLink),
    appUsage: new AppUsageTracker(repos.appUsage),
  };


  const unsubscribes = [
    registerAuditSubscriber(eventBus, repos.audit),
    registerNoteIndexSubscriber(eventBus, infra.jobQueue),
    registerCheckInSubscriber(eventBus, useCases.recordDailyCheckIn),
    // 复盘由用户主动生成（全屏复盘面板按钮），确认门确认后落库；无自动生成。
    // 崩溃前未确认的草稿由 recoverPendingReview 在启动时重新弹窗恢复。
    registerCompanionSubscriber(
      eventBus,
      infra.companionStateMachine,
      focusPolicy,
      triggerInteraction
    ),
  ];

  return {
    eventBus,
    policies: { focus: focusPolicy, interaction: interactionPolicy, privacy: privacyPolicy },
    confirmation,
    useCases,
    dispose: () => unsubscribes.forEach((off) => off()),
  };
}

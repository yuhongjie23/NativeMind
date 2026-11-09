import { Database } from '@infrastructure/db/database';
import { SqliteTodoRepository } from '@infrastructure/db/repositories/todo-repository';
import { SqliteFocusRepository } from '@infrastructure/db/repositories/focus-repository';
import { SqliteReviewRepository } from '@infrastructure/db/repositories/review-repository';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { TemplateReviewGeneratorPort } from '@infrastructure/local-demo';
import { ConfirmationService, type ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import { CreateTodoUseCase } from '@application/use-cases/todo/create-todo';
import { CompleteTodoUseCase } from '@application/use-cases/todo/complete-todo';
import { UpdateTodoUseCase } from '@application/use-cases/todo/update-todo';
import { StartFocusUseCase } from '@application/use-cases/focus/start-focus';
import { CompleteFocusUseCase } from '@application/use-cases/focus/complete-focus';
import { AbortFocusUseCase } from '@application/use-cases/focus/abort-focus';
import { GenerateDailyReviewUseCase } from '@application/use-cases/review/generate-daily-review';
import { GenerateWeeklyReviewUseCase } from '@application/use-cases/review/generate-weekly-review';
import { GenerateMonthlyReviewUseCase } from '@application/use-cases/review/generate-monthly-review';
import { AdoptReviewSuggestionUseCase } from '@application/use-cases/review/adopt-review-suggestion';
import { RecoverPendingReviewUseCase } from '@application/use-cases/review/recover-pending-review';
import type { ReviewGeneratorPort } from '@application/ports';
import { NodeSqliteDriver } from '../sqlite-driver';

// Real migrated SQLite and use cases; template generation tests persistence, not AI quality.
export async function openLearningRuntime(path: string, prompt: ConfirmationPrompt = async () => true) {
  const db = new Database(new NodeSqliteDriver(path));
  await db.migrate();
  const todos = new SqliteTodoRepository(db);
  const focus = new SqliteFocusRepository(db);
  const reviews = new SqliteReviewRepository(db);
  const proposals = new SqliteActionProposalRepository(db);
  const confirmation = new ConfirmationService(proposals, prompt);
  const events = new SimpleEventBus();
  const policy = new FocusModePolicy();
  const inputs: Parameters<ReviewGeneratorPort['generate']>[0][] = [];
  const template = new TemplateReviewGeneratorPort();
  const generator: ReviewGeneratorPort = { generate: async input => { inputs.push(input); return template.generate(input); } };
  return {
    db, todos, focus, reviews, proposals, confirmation, events, policy, inputs,
    create: new CreateTodoUseCase(todos, events, confirmation, { structure: async () => [{ title: '阅读排序算法' }, { title: '整理排序笔记' }] }),
    complete: new CompleteTodoUseCase(todos, events),
    update: new UpdateTodoUseCase(todos, events),
    startFocus: new StartFocusUseCase(focus, events, policy),
    completeFocus: new CompleteFocusUseCase(focus, events, policy),
    abortFocus: new AbortFocusUseCase(focus, events, policy),
    daily: new GenerateDailyReviewUseCase(reviews, todos, focus, generator, confirmation, events, policy),
    weekly: new GenerateWeeklyReviewUseCase(reviews, todos, focus, generator, confirmation, events, policy),
    monthly: new GenerateMonthlyReviewUseCase(reviews, todos, focus, generator, confirmation, events, policy),
    adopt: new AdoptReviewSuggestionUseCase(reviews, confirmation, events),
    recover: new RecoverPendingReviewUseCase(proposals, reviews, confirmation, events),
  };
}

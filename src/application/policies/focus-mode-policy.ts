/**
 * FocusModePolicy - 专注模式裁决
 * 专注期间拦截所有 AI 主动行为与重后台任务。
 */
export type InterruptKind =
  | 'companion_dialogue'
  | 'companion_question'
  | 'ai_suggestion'
  | 'notification'
  | 'background_job'
  | 'external_search'
  /**
   * 苏格拉底提问会话。
   *
   * 这条是用户主动发起的，但仍要拦：它本身就是一段需要投入的深度对话，
   * 专注期间开启等于用另一件事替换掉当前那件事。
   * 拦在用例层而不是只靠 UI 禁用按钮 —— UI 可以被绕过（快捷键、
   * 后续新增的入口），策略是唯一的裁决处。
   */
  | 'socratic_session';


/** 专注期间仍允许的行为（计时相关的必要反馈） */
const ALLOWED_DURING_FOCUS: InterruptKind[] = [];

export class FocusModePolicy {
  private activeSessionId: string | null = null;

  /** 由 StartFocusUseCase 调用 */
  activate(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  /** 由 Complete / Abort 用例调用 */
  deactivate(): void {
    this.activeSessionId = null;
  }

  isActive(): boolean {
    return this.activeSessionId !== null;
  }

  /** AI 主动行为的唯一裁决入口 */
  canInterrupt(kind: InterruptKind): boolean {
    if (!this.isActive()) return true;
    return ALLOWED_DURING_FOCUS.includes(kind);
  }
}

export const focusModePolicy = new FocusModePolicy();

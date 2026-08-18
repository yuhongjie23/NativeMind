/**
 * 宠物互动内容生成
 *
 * 定位是轻量陪伴与状态反馈，不是主 AI 助手（§7.7）。
 * 是否该说话由 application 的 InteractionPolicy + FocusModePolicy 决定，
 * 这里只负责「已经决定要说了，说什么」。
 *
 * 每个场景都有台词模板兜底：模型不可用时角色照常有反应，不会变成哑巴（§16.1）。
 * 扩展新角色 = 换一份 CompanionVoice 资源包，不改本文件（§17.3）。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';

/** 场景与 companion-subscriber 里订阅的事件对应；user_invoked=用户点击宠物 */
export type CompanionScene =
  | 'app_entered'
  | 'focus_start'
  | 'focus_complete'
  | 'focus_abort'
  | 'repeatedly_aborted'
  | 'review_generated'
  | 'app_exiting'
  | 'feedback'
  | 'health_reminder'
  | 'user_invoked';

/** 角色资源包：语气 + 各场景台词。新增角色只加一份配置 */
export interface CompanionVoice {
  companionId: string;
  name: string;
  /** 注入 prompt 的语气说明 */
  tone: string;
  /** 兜底台词，每个场景至少一条 */
  lines: Record<CompanionScene, string[]>;
}

export const fulilianVoice: CompanionVoice = {
  companionId: 'fulilian',
  name: '芙莉莲',
  tone: '平实、简短、像旁边安静待着的小玩偶。不吹捧，不打鸡血，不用感叹号。',
  lines: {
    app_entered: ['来了。今天想做点什么？'],
    focus_start: ['开始了，我先安静一会儿。'],
    focus_complete: ['这一段结束了，要记一笔吗？'],
    focus_abort: ['先停下来也没关系。'],
    repeatedly_aborted: ['这个任务卡了几次了，要不要拆小一点？'],
    review_generated: ['复盘草稿写好了，看看要不要改。'],
    app_exiting: ['那我先待着，下次见。'],
    feedback: ['记下了。'],
    // 用户点宠物：随机互动兜底（问候 / 关心 / 轻问题混合，每次随机取一条）
    user_invoked: [
      '来了。今天过得怎么样？',
      '吃饭了吗？没吃的话先歇口气。',
      '累不累？喝口水再继续吧。',
      '这个概念，你能用自己的话讲一遍吗？',
      '你现在卡在哪一步？',
      '这个说法和你笔记里的哪条能对上？',
      '今天有什么想先做完的小事吗？',
    ],
    // 久坐健康提醒（每 30 分钟一轮，model 改写前先有确定性台词兜底）
    health_reminder: [
      '盯屏幕好一会儿了，眨眨眼。',
      '起来扭扭腰、伸个懒腰吧。',
      '喝口水，润润嗓子。',
      '看看远处，让眼睛歇 20 秒。',
    ],
  },
};

export interface DialogueContext {
  scene: CompanionScene;
  /** 简短事实描述，如「专注 25 分钟，任务：理解 LoRA」。不要传笔记原文 */
  facts?: string;
  /** 用户对上一轮提问的回答，仅 feedback 场景使用 */
  userResponse?: string;
  /** 规则 Planner 已决定的言语行为（P1 Agent）：代码选意图，模型只改写 */
  speechAct?:
    | 'acknowledge_completion' // 专注/任务完成 → 承认投入并收尾
    | 'continue_task' // 追问是否继续当前任务
    | 'check_in' // 轻轻问候
    | 'light_question' // 轻巧的学习问题
    | 'acknowledge_answer' // 复述用户回答中的具体点
    | 'statement';
  /** responseMode：statement 禁提问；question 只问一个 */
  responseMode?: 'statement' | 'question';
  /** 规则已选好的最近台词（供模型避免复述） */
  recentLines?: string[];
}

export interface GeneratedInteraction {
  content: string;
  /** 意图：驱动页面下一步（acknowledge/clarify/suggest_one_step/close） */
  intent?: 'acknowledge' | 'clarify' | 'suggest_one_step' | 'close';
  /** 情绪：驱动 Sprite 动画 */
  emotion?: 'calm' | 'curious' | 'happy' | 'concerned';
  /** 快捷回应（随这句话展示，最多 3 个） */
  quickReplies?: string[];
  /** true 表示用了模板兜底，未调用模型 */
  fromTemplate: boolean;
}

/** JSON prompt 输出格式（小模型只完成一个明确动作，emotion 驱动动画、intent 驱动下一步） */
export interface CompanionTurnOutput {
  /** 轻量思维链：模型输出前一句内部简评，不展示给用户，只用于推理质量与可审计 */
  think?: string;
  intent: 'acknowledge' | 'clarify' | 'suggest_one_step' | 'close';
  emotion: 'calm' | 'curious' | 'happy' | 'concerned';
  text: string;
  quickReplies: string[];
}

const pickLine = (voice: CompanionVoice, scene: CompanionScene): string => {
  const lines = voice.lines[scene] ?? voice.lines.feedback;
  return lines[Math.floor(Math.random() * lines.length)];
};

const MAX_FACT_CHARS = 300;
/** 宠物气泡 2.5 秒未生成就直接用模板：对延迟比对文采更敏感（小模型调用策略） */
const DIALOGUE_TIMEOUT_MS = 2_500;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('气泡生成超时')), ms);
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

/** 宽松解析模型 JSON 输出；失败返回 null（调用方模板兜底） */
const parseTurnOutput = (raw: string): CompanionTurnOutput | null => {
  const text = raw
    .replace(/```json|```/g, '')
    .trim()
    .replace(/^\{/, '{');
  try {
    const parsed = JSON.parse(text) as Partial<CompanionTurnOutput>;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return {
      // think 是模型内部推理，允许缺失、允许短（1.5B 能力有限，不强求）
      think: typeof parsed.think === 'string' ? parsed.think.slice(0, 40) : undefined,
      intent: parsed.intent ?? 'acknowledge',
      emotion: parsed.emotion ?? 'calm',
      text: parsed.text.trim(),
      quickReplies: Array.isArray(parsed.quickReplies)
        ? parsed.quickReplies.filter((q): q is string => typeof q === 'string').slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
};

export class InteractionGenerator {
  constructor(
    private readonly router: ModelRouter,
    private readonly voice: CompanionVoice = fulilianVoice
  ) {}

  /** 一句陪伴短语。speechAct 由规则决定，模型只把明确意图改写成自然的一句话（P1 Agent） */
  async generateDialogue(ctx: DialogueContext): Promise<GeneratedInteraction> {
    const runPromise = this.router.run<DialogueContext, string>({
      taskType: 'companion_dialogue',
      input: ctx,
      modelPolicy: {
        // 宠物对延迟比对文采敏感：单次调用、不升级 14B、短预算、温度适中（小模型调用策略）
        // maxTokens 从 96 提到 200：给轻量思维链(think)留出输出空间，仍远低于小模型单次上限
        temperature: 0.5,
        maxTokens: 200,
        noRetry: true,
        noFallback: true,
      },
      inlinePrompt: {
        system: [
          '你是学习陪伴宠物，不是教师、心理咨询师或效率教练。',
          '当前任务：先准确接住用户刚才的话，再给出一个很小的下一步。',
          '思考（轻量思维链）：输出前先在 think 字段写一句话，判断「用户此刻的状态」和「最合适的回应方向」。',
          '  - think 是内部推理，不构成对用户说的话；内容不出现「加油、坚持、应该」等口号。',
          '  - 例：{"think":"专注结束，先肯定再提示记一笔","intent":"acknowledge", ...}',
          '规则：',
          '1. 只能使用输入中的事实，不补充不存在的任务、时长和情绪。',
          '2. 回复 20～60 个中文字符。',
          '3. 不要同时提两个问题。不要评价用户是否努力。',
          '4. 不使用「加油、坚持、你一定可以、你应该、效率、优秀」等激励口号。',
          '5. 信息不足时，只问一个容易回答的问题。',
          '6. 输出严格 JSON：{"think":"...","intent":"acknowledge|clarify|suggest_one_step|close","emotion":"calm|curious|happy|concerned","text":"...","quickReplies":["...","..."]}，think 不超过 20 字，不要输出其它内容。',
        ].join('\n'),
        user: [
          `speechAct: ${ctx.speechAct ?? 'statement'}`,
          ctx.facts ? `事实：${truncate(ctx.facts, MAX_FACT_CHARS)}` : '',
          ctx.userResponse ? `用户回答：${truncate(ctx.userResponse, MAX_FACT_CHARS)}` : '',
          ctx.recentLines && ctx.recentLines.length > 0
            ? `最近台词（不要复述）：${ctx.recentLines.slice(-3).join(' / ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });

    // 2.5s 超时：超时/失败一律模板兜底，绝不拖慢气泡
    const result = await withTimeout(runPromise, DIALOGUE_TIMEOUT_MS).catch(() => null);
    if (!result) {
      return { content: pickLine(this.voice, ctx.scene), fromTemplate: true };
    }

    const raw = typeof result.output === 'string' ? result.output.trim() : '';
    const parsed = raw ? parseTurnOutput(raw) : null;
    if (!parsed) {
      // 模型没给合法 JSON / 输出太短：模板兜底
      return { content: pickLine(this.voice, ctx.scene), fromTemplate: true };
    }
    return {
      content: parsed.text,
      intent: parsed.intent,
      emotion: parsed.emotion,
      quickReplies: parsed.quickReplies,
      fromTemplate: false,
    };
  }

  /**
   * 主动提问。规则先决定提问类型（continue_task / check_in / light_question），
   * 模型只把「要不要继续任务 / 轻轻问候 / 轻巧问题」改写成一句自然的话。
   */
  async generateQuestion(ctx: DialogueContext): Promise<GeneratedInteraction> {
    // 代码先选言语行为（用户点击时在 application 层随机 check_in / continue_task / light_question）
    return this.generateDialogue({
      ...ctx,
      speechAct: ctx.speechAct ?? 'light_question',
      responseMode: 'question',
    });
  }

  /**
   * 用户回答后的简短回应。speechAct=acknowledge_answer（复述一个具体点），
   * 带上宠物上一句问题与上下文事实（P1-6），不做点评、不立即说教。
   */
  async generateFeedback(ctx: {
    previousQuestion: string;
    userResponse: string;
    scene: string;
    facts?: string;
    recentLines?: string[];
  }): Promise<GeneratedInteraction> {
    return this.generateDialogue({
      scene: 'feedback',
      speechAct: 'acknowledge_answer',
      responseMode: 'statement',
      userResponse: ctx.userResponse,
      facts: [
        ctx.previousQuestion ? `宠物刚才说：${truncate(ctx.previousQuestion, 120)}` : '',
        ctx.facts ?? '',
      ]
        .filter(Boolean)
        .join('；'),
      recentLines: ctx.recentLines,
    });
  }
}

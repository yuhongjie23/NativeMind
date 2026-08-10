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
  },
};

export interface DialogueContext {
  scene: CompanionScene;
  /** 简短事实描述，如「专注 25 分钟，任务：理解 LoRA」。不要传笔记原文 */
  facts?: string;
  /** 用户对上一轮提问的回答，仅 feedback 场景使用 */
  userResponse?: string;
}

export interface GeneratedInteraction {
  content: string;
  /** true 表示用了模板兜底，未调用模型 */
  fromTemplate: boolean;
}

const pickLine = (voice: CompanionVoice, scene: CompanionScene): string => {
  const lines = voice.lines[scene] ?? voice.lines.feedback;
  return lines[Math.floor(Math.random() * lines.length)];
};

const MAX_FACT_CHARS = 300;

export class InteractionGenerator {
  constructor(
    private readonly router: ModelRouter,
    private readonly voice: CompanionVoice = fulilianVoice
  ) {}

  /** 一句陪伴短语。场景固定，长度硬性受限，避免角色变成聊天机器人 */
  async generateDialogue(ctx: DialogueContext): Promise<GeneratedInteraction> {
    const result = await this.router.run<DialogueContext, string>({
      taskType: 'companion_dialogue',
      input: ctx,
      inlinePrompt: {
        system: [
          `你是一个叫「${this.voice.name}」的陪伴角色。`,
          this.voice.tone,
          '只输出一句话，不超过 30 字。不要解释，不要引号，不要 emoji。',
        ].join('\n'),
        user: [
          `场景：${ctx.scene}`,
          ctx.facts ? `情况：${truncate(ctx.facts, MAX_FACT_CHARS)}` : '',
          ctx.userResponse ? `用户刚说：${truncate(ctx.userResponse, MAX_FACT_CHARS)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });

    const content = typeof result.output === 'string' ? result.output.trim() : '';
    // 模型话太多就不要了，宁可用模板，也不让角色抢注意力
    if (!content || content.length > 60) {
      return { content: pickLine(this.voice, ctx.scene), fromTemplate: true };
    }
    return { content, fromTemplate: false };
  }

  /**
   * 主动提问。语气与提问深度都受限：这不是苏格拉底提问，
   * 只是一句关心式的追问，用户可以一句话答完。
   */
  async generateQuestion(ctx: DialogueContext): Promise<GeneratedInteraction> {
    // 用户主动点宠物：随机互动（打招呼 / 随口关心 / 轻巧问题），每次有变化
    const isUserInvoked = ctx.scene === 'user_invoked';
    const system = isUserInvoked
      ? [
          `你是一个叫「${this.voice.name}」的陪伴角色。`,
          this.voice.tone,
          '随机做其中一类，每次都不一样：打招呼、随口关心（如吃饭了吗 / 累不累 / 今天怎么样）、或问一个轻巧的学习问题。',
          '只输出一句话，不超过 30 字，不要解释，不要引号。',
          '绝对不要问「这次反馈主要基于哪些方面」「这次互动关注什么」「你觉得怎么样」这类抽象元问题。',
        ].join('\n')
      : [
          `你是一个叫「${this.voice.name}」的陪伴角色。`,
          this.voice.tone,
          '只问一个能一句话答完的问题，不超过 30 字。',
          '不要追问原因，不要评判，不要给建议。',
          '问题要具体、贴近当下（如刚完成的专注、卡住的待办、今天学的内容），',
          '不要问「这次反馈/这次互动关注什么」「你觉得怎么样」这类抽象元问题。',
        ].join('\n');

    const result = await this.router.run<DialogueContext, string>({
      taskType: 'companion_dialogue',
      input: ctx,
      inlinePrompt: {
        system: [system].join('\n'),
        user: [
          `场景：${ctx.scene}`,
          ctx.facts ? `情况：${truncate(ctx.facts, MAX_FACT_CHARS)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });

    const content = typeof result.output === 'string' ? result.output.trim() : '';
    if (!content || content.length > 60) {
      return { content: pickLine(this.voice, ctx.scene), fromTemplate: true };
    }
    return { content, fromTemplate: false };
  }

  /** 用户回答后的简短回应。不做点评，只表示收到 */
  async generateFeedback(userResponse: string): Promise<GeneratedInteraction> {
    return this.generateDialogue({ scene: 'feedback', userResponse });
  }
}

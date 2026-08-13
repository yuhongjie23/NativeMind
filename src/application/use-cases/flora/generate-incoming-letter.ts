/**
 * GenerateIncomingLetterUseCase - Flora 主动来信
 *
 * 分两类触发：
 *  - 每月一次学习鼓励信（settings `letter.lastEncourageMonth` = YYYY-MM，跨月才发）
 *  - 每日一次 30% 抽签（settings `letter.lastDrawDate` = 今天，当天只抽一次）；
 *    抽中后按类型出信：encourage 学习鼓励 / whats_up Flora 近况（调网络搜索）/ warm 温暖鼓励。
 *
 * 内容按设置语言（app.language）输出。searchBrief 未注入（web 模板/无搜索）时 whats_up 退化为通用近况。
 */
import type { Letter, LetterRepository, LetterType, SettingsKeyValuePort } from '../../ports';
import { newId, now } from '../../shared/utils';

const LAST_DRAW_KEY = 'letter.lastDrawDate';
const LAST_ENCOURAGE_KEY = 'letter.lastEncourageMonth';
const LANGUAGE_KEY = 'app.language';
/** 每天 Flora 主动写信的概率 */
const INCOMING_CHANCE = 0.3;

type Lines = Record<'zh' | 'en', string[]>;

const ENCOURAGE_LINES: Lines = {
  zh: [
    '这个月你也在坚持学习，真棒。慢一点没关系，继续就好。',
    '这阵子的积累，会在某天突然串起来。我在旁边看着呢。',
  ],
  en: [
    'You kept learning this month — that is great. Slow is fine, just keep going.',
    'All this effort will click one day. I am here watching.',
  ],
};

const WARM_LINES: Lines = {
  zh: ['今天也辛苦了，我在旁边陪着你。', '别忘了休息一下，喝口水再继续。', '慢慢来，不用急，我在。'],
  en: ['You worked hard today — I am right here.', 'Take a break and some water.', 'Take it easy, I am here.'],
};

const pick = (lines: string[]): string => lines[Math.floor(Math.random() * lines.length)];

export class GenerateIncomingLetterUseCase {
  constructor(
    private readonly letterRepo: LetterRepository,
    private readonly settings: SettingsKeyValuePort,
    /** 可选：whats_up 来信用的「一句近期见闻」（调网络搜索），未注入则退化为通用近况 */
    private readonly searchBrief?: (query: string) => Promise<string | null>
  ) {}

  /** 返回是否真的生成了来信 */
  async execute(today = new Date().toISOString().slice(0, 10)): Promise<boolean> {
    const language: 'zh' | 'en' = (await this.settings.get(LANGUAGE_KEY)) === 'en' ? 'en' : 'zh';
    const yearMonth = today.slice(0, 7);

    // 1) 每月一次学习鼓励信
    const lastEncourage = await this.settings.get(LAST_ENCOURAGE_KEY);
    if (lastEncourage !== yearMonth) {
      await this.settings.set(LAST_ENCOURAGE_KEY, yearMonth);
      await this.saveIncoming('encourage', pick(ENCOURAGE_LINES[language]), language);
      return true;
    }

    // 2) 每日一次 30% 抽签
    const last = await this.settings.get(LAST_DRAW_KEY);
    if (last === today) return false;
    await this.settings.set(LAST_DRAW_KEY, today);
    if (Math.random() >= INCOMING_CHANCE) return false;

    // 类型分配：约 1/3 鼓励、1/3 whats_up、1/3 温暖
    const roll = Math.random();
    const type: LetterType = roll < 0.34 ? 'encourage' : roll < 0.67 ? 'whats_up' : 'warm';

    const content =
      type === 'whats_up' ? await this.buildWhatsUp(language) : pick((type === 'encourage' ? ENCOURAGE_LINES : WARM_LINES)[language]);

    await this.saveIncoming(type, content, language);
    return true;
  }

  /** whats_up：Flora 近况 + 一条网络搜索到的有趣见闻 */
  private async buildWhatsUp(language: 'zh' | 'en'): Promise<string> {
    const query = language === 'en' ? 'interesting things happening this week' : '本周 有趣 新鲜事';
    let snippet: string | null = null;
    if (this.searchBrief) {
      try {
        snippet = await this.searchBrief(query);
      } catch {
        snippet = null;
      }
    }
    if (snippet) {
      return language === 'en'
        ? `I have been looking at a lot of things lately. When I came across "${snippet}", I thought it was interesting. What have you been up to?`
        : `最近我在翻一些有意思的东西，看到「${snippet}」的时候觉得挺有趣的。你呢，最近在忙什么？`;
    }
    return language === 'en'
      ? 'I have been reading and looking around lately. Nothing too big, just enjoying the quiet. What are you up to?'
      : '最近我读了些东西，也看了些风景，日子安静又舒服。你呢，最近在忙什么？';
  }

  private async saveIncoming(type: LetterType, content: string, language: 'zh' | 'en'): Promise<void> {
    const letter: Letter = {
      id: newId(),
      letter: content,
      language,
      direction: 'in',
      type,
      sendAfter: now(),
      status: 'sent',
      createdAt: now(),
    };
    await this.letterRepo.save(letter);
  }
}

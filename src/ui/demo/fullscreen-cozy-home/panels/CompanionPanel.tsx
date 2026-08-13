/**
 * 「陪伴」面板 —— 安静空间。
 *
 * 定位：不是聊天软件，也不是宠物管理页；是「继续当前短对话、观察宠物状态、
 * 回看少量陪伴片段」的安静空间。
 *
 * 布局：主舞台（宠物 + 当前一句话 + 快捷回应 + 自由输入）+ 弱化记忆栏（对话片段）。
 * 宠物开关 / 模型配置等管理项移去「设置」页，这里只保留陪伴本身。
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n';
import fulilianArt from '../../../pets/fulilian.png';
import { SpriteRenderer } from '../components/SpriteRenderer';
import { useCompanionStore, type CompanionConversationState } from '../../../stores/companion-store';
import { useFocusStore } from '../../../stores/focus-store';
import { usePanelDirty } from '../panel-dirty';

/** 快捷回应：一句就能答完的轻选项，最多 3 个，常驻主舞台 */
const FALLBACK_QUICK_REPLIES = ['继续', '先歇会儿', '不太懂'] as const;

/**
 * 状态 → 帧组（四：状态驱动宠物动作，不再永远同一套「认真查看问题」）
 * 对应 fulilian sprite manifest 的命名动作
 */
const FRAMES_BY_ANIMATION: Record<string, { frames: number[]; fps: number; loop: boolean; reducedMotionFrame: number }> = {
  idle: { frames: [10, 11, 12, 13, 14], fps: 0.2, loop: true, reducedMotionFrame: 14 },
  needs_input: { frames: [25, 26, 27, 28, 29], fps: 0.2, loop: true, reducedMotionFrame: 27 },
  examining: { frames: [35, 36, 37, 38, 39], fps: 0.2, loop: true, reducedMotionFrame: 38 },
  look_at_girl: { frames: [15, 16, 17, 18, 19], fps: 2.5, loop: false, reducedMotionFrame: 18 },
  cheer: { frames: [30, 31, 32, 33, 34], fps: 4, loop: false, reducedMotionFrame: 30 },
  concerned: { frames: [35, 36, 37, 38], fps: 2.5, loop: false, reducedMotionFrame: 37 },
  sleep_loop: { frames: [3, 4, 3, 4], fps: 0.2, loop: true, reducedMotionFrame: 4 },
};

/** 对话状态 → 动画（状态机驱动，四） */
const animationForState = (state: CompanionConversationState): string => {
  switch (state.kind) {
    case 'thinking':
      return 'examining'; // 歪头/翻页：认真查看
    case 'asking':
      return 'needs_input'; // 面向用户等待回应
    case 'replying':
      return 'look_at_girl'; // 点头、认真听
    case 'responded':
      return 'cheer'; // 开心、轻轻弹一下
    case 'resting':
      return 'sleep_loop';
    default:
      return 'idle';
  }
};

export function CompanionPanel() {
  const t = useT();
  const current = useCompanionStore((state) => state.current);
  const generating = useCompanionStore((state) => state.generating);
  const conversationState = useCompanionStore((state) => state.conversationState);
  const quickReplies = useCompanionStore((state) => state.quickReplies);
  const history = useCompanionStore((state) => state.history);
  const error = useCompanionStore((state) => state.error);
  const refresh = useCompanionStore((state) => state.refresh);
  const trigger = useCompanionStore((state) => state.trigger);
  const respond = useCompanionStore((state) => state.respond);
  const dismiss = useCompanionStore((state) => state.dismiss);
  const focusing = useFocusStore((state) => Boolean(state.active));

  const [silentHint, setSilentHint] = useState(false);
  const [reply, setReply] = useState('');

  // 状态驱动动画帧组（模型 emotion → animationName 已存 interaction；这里用状态机兜底映射）
  const animationName =
    current?.animationName ?? animationForState(conversationState);
  const frameGroup =
    FRAMES_BY_ANIMATION[animationName] ??
    FRAMES_BY_ANIMATION.examining!;
  const isThinking = generating || conversationState.kind === 'thinking';

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 回应草稿未提交时标记未完成
  useEffect(() => {
    usePanelDirty.getState().setDirty('companion', reply.trim().length > 0);
  }, [reply]);

  /**
   * 提交回应：主舞台常驻输入区。
   * 宠物正在问 → 直接回应；宠物没在说话（空闲）→ 先让它说一句，再把用户的话作为回应。
   * 这样输入区始终可用，不用先点「叫一下它」。
   */
  const submitReply = async (text?: string) => {
    const value = (text ?? reply).trim();
    if (!value) return;
    // 空闲态：先触发宠物说话（开启一轮），随后把用户输入作为回应
    if (!useCompanionStore.getState().current) {
      setSilentHint(false);
      await trigger('user_invoked');
      if (!useCompanionStore.getState().current) {
        // 策略静默：保留输入，提示稍后再试
        setSilentHint(true);
        return;
      }
    }
    await respond(value);
    setReply('');
  };

  // 记忆栏：只保留「宠物 ↔ 用户」的对话片段，按会话分组还原连续感
  const dialogueFragments = useMemo(() => {
    // history 是倒序（最新的在前），还原成时间正序
    const ordered = [...history].reverse();
    const fragments: { pet: string; user?: string; key: string }[] = [];
    for (const item of ordered) {
      if (item.content) {
        fragments.push({ pet: item.content, user: item.userResponse, key: item.id });
      }
    }
    return fragments.slice(-8); // 最近 8 段，弱化记忆
  }, [history]);

  return (
    <div className="cozy-companion-panel">
      {/* 主舞台：宠物状态 + 当前一句话 + 快捷回应 + 输入 */}
      <div className="cozy-companion-panel__stage-col">
        {/* 第八点：点击宠物本体开启互动（不再是「叫一下它」按钮） */}
        <button
          type="button"
          className="cozy-companion-panel__stage cozy-companion-panel__stage--clickable"
          aria-label={t('和宠物说一句')}
          disabled={focusing || isThinking || Boolean(current)}
          onClick={() => void trigger('user_invoked')}
        >
          <SpriteRenderer
            descriptor={{
              renderer: 'sprite',
              src: fulilianArt,
              frameWidth: 345.6,
              frameHeight: 288,
              columns: 5,
              rows: 8,
              frames: frameGroup.frames,
              fps: isThinking ? Math.max(frameGroup.fps, 0.5) : frameGroup.fps,
              loop: frameGroup.loop,
              reducedMotionFrame: frameGroup.reducedMotionFrame,
              scale: 0.6,
            }}
          />
          {isThinking ? (
            <span className="cozy-companion-panel__thinking" role="status">
              {t('在想怎么回你…')}
            </span>
          ) : null}
        </button>

        {/* 主舞台核心：一句话区域常驻（宠物的话 / 空闲状态句） */}
        <div className="cozy-companion-current">
          <p className="cozy-companion-current__text">
            {current
              ? current.content
              : focusing
                ? t('你在专注中，它不会来打扰。')
                : t('它安静地待在旁边。想聊一句，直接在下面写。')}
          </p>

          {/* 快捷回应：模型 quickReplies 优先（最多 3 个），无则本地兜底；常驻 */}
          <div className="cozy-companion-current__quick">
            {(quickReplies.length > 0 ? quickReplies : FALLBACK_QUICK_REPLIES)
              .slice(0, 3)
              .map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  className="cozy-companion-current__chip"
                  disabled={isThinking || focusing}
                  onClick={() => void submitReply(phrase)}
                >
                  {phrase}
                </button>
              ))}
          </div>

          {/* 自由输入框：常驻 */}
          <div className="cozy-companion-current__reply">
            <label className="sr-only" htmlFor="companion-reply">
              {t('回应宠物')}
            </label>
            <input
              id="companion-reply"
              type="text"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitReply();
              }}
              placeholder={current ? t('随便写一句就好') : t('写一句，它会接着聊')}
            />
            <button
              type="button"
              className="cozy-btn-primary"
              disabled={isThinking || focusing || !reply.trim()}
              onClick={() => void submitReply()}
            >
              {t('回应')}
            </button>
            {current ? (
              <button type="button" className="cozy-btn-ghost" onClick={dismiss}>
                {current.requiresResponse ? t('稍后') : t('让它先安静一会儿')}
              </button>
            ) : null}
          </div>

          {silentHint ? (
            <p className="cozy-companion-panel__hint">{t('它现在想安静一会儿，等下再来。')}</p>
          ) : null}
        </div>
        {error ? <p className="cozy-today-error">{error}</p> : null}
      </div>

      {/* 弱化记忆栏：最近对话片段 */}
      <div className="cozy-companion-panel__mem">
        <h3 className="panel-section-title">{t('最近聊过')}</h3>
        {dialogueFragments.length === 0 ? (
          <p className="cozy-today-empty">{t('还没有聊过。')}</p>
        ) : (
          <ul className="cozy-chat-log">
            {dialogueFragments.map((fragment) => (
              <li key={fragment.key} className="cozy-chat-log__entry" data-who="pet">
                <span className="cozy-chat-log__bubble">{fragment.pet}</span>
                {fragment.user ? (
                  <span className="cozy-chat-log__bubble cozy-chat-log__bubble--user">
                    {fragment.user}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

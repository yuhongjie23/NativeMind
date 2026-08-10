/**
 * 「陪伴」面板 —— 真实互动。
 *
 * 复用同一个 PetActor 展示当前陪伴动画；「叫一下它」走真实
 * useCompanionStore.trigger（策略可能保持静默，明确写出）；当前互动支持
 * 内联回应与「稍后」；右侧为真实互动历史。
 */
import { useEffect, useState } from 'react';
import { useT } from '../../../i18n';
import fulilianArt from '../../../pets/fulilian.png';
import { SpriteRenderer } from '../components/SpriteRenderer';
import { useCompanionStore } from '../../../stores/companion-store';
import { useFocusStore } from '../../../stores/focus-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { usePanelDirty } from '../panel-dirty';

export function CompanionPanel() {
  const t = useT();
  const config = useSettingsStore((state) => state.companion);
  const updateConfig = useSettingsStore((state) => state.updateCompanion);
  const current = useCompanionStore((state) => state.current);
  const history = useCompanionStore((state) => state.history);
  const error = useCompanionStore((state) => state.error);
  const refresh = useCompanionStore((state) => state.refresh);
  const trigger = useCompanionStore((state) => state.trigger);
  const respond = useCompanionStore((state) => state.respond);
  const dismiss = useCompanionStore((state) => state.dismiss);
  const focusing = useFocusStore((state) => Boolean(state.active));

  const [silentHint, setSilentHint] = useState(false);
  const [reply, setReply] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 回应草稿未提交时标记未完成
  useEffect(() => {
    usePanelDirty.getState().setDirty('companion', reply.trim().length > 0);
  }, [reply]);

  const call = async () => {
    setSilentHint(false);
    await trigger('user_invoked');
    if (!useCompanionStore.getState().current) setSilentHint(true);
  };

  const submitReply = async () => {
    const text = reply.trim();
    if (!text) return;
    await respond(text);
    setReply('');
  };

  const answered = history.filter((item) => item.userResponse).length;

  return (
    <div className="cozy-companion-panel">
      <div className="cozy-companion-panel__left">
        <div className="cozy-companion-panel__stage">
          {/* 第 8 组动作「认真查看问题」：5 帧，每 5 秒切一帧，循环 */}
          <SpriteRenderer
            descriptor={{
              renderer: 'sprite',
              src: fulilianArt,
              frameWidth: 345.6,
              frameHeight: 288,
              columns: 5,
              rows: 8,
              frames: [35, 36, 37, 38, 39],
              fps: 0.2, // 5 秒/帧
              loop: true,
              reducedMotionFrame: 35,
              scale: 0.6, // 相对原 companion 图缩到约 0.8 倍展示
            }}
          />
        </div>

        <div className="cozy-companion-panel__actions">
          <button
            type="button"
            className="cozy-btn-primary"
            disabled={Boolean(current)}
            onClick={() => void call()}
          >
            叫一下它
          </button>
          <button
            type="button"
            className="cozy-btn-secondary"
            onClick={() => void updateConfig({ enabled: !config.enabled })}
          >
            {config.enabled ? t('暂时关掉') : t('重新打开')}
          </button>
        </div>

        {focusing ? (
          <p className="cozy-companion-panel__hint">{t('你在专注中，它不会来打扰。')}</p>
        ) : null}
        {silentHint ? (
          <p className="cozy-companion-panel__hint">{t('它现在想安静一会儿，等下再来。')}</p>
        ) : null}
        {error ? <p className="cozy-today-error">{error}</p> : null}

        {current ? (
          <div className="cozy-companion-current">
            <p className="cozy-companion-current__text">{current.content}</p>
            {current.requiresResponse ? (
              <div className="cozy-companion-current__reply">
                <label className="sr-only" htmlFor="companion-reply">{t('回应宠物')}</label>
                <input
                  id="companion-reply"
                  type="text"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitReply();
                  }}
                  placeholder={t('随便写一句就好')}
                />
                <button type="button" className="cozy-btn-primary" onClick={() => void submitReply()}>
                  {t('回应')}
                </button>
                <button type="button" className="cozy-btn-ghost" onClick={dismiss}>
                  {t('稍后')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="cozy-companion-panel__divider" aria-hidden="true" />

      <div className="cozy-companion-panel__right">
        <h3 className="panel-section-title">{t('互动记录')}</h3>
        <p className="cozy-companion-panel__hint">
          {t('{0} 次互动 · 你回应了 {1} 次', history.length, answered)}
        </p>
        {history.length === 0 ? (
          <p className="cozy-today-empty">{t('还没有互动。')}</p>
        ) : (
          <ul className="cozy-chat-log">
            {history.slice(0, 8).map((item) => (
              <li key={item.id} className="cozy-chat-log__entry" data-who="pet">
                <span className="cozy-chat-log__bubble">{item.content}</span>
                {item.userResponse ? (
                  <span className="cozy-chat-log__bubble cozy-chat-log__bubble--user">
                    {t('你说：{0}', item.userResponse)}
                  </span>
                ) : null}
                <time className="cozy-chat-log__time">{item.sceneType}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

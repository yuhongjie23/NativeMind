import { useState } from 'react';
import { isAnna, pickAnnaVideo } from '@infrastructure/anna';
import { chooseDesktopVideo } from '@infrastructure/background-video';
import { useAnnaFileTransfer } from '../../../hooks/use-anna-file-transfer';
import { AnnaTransferStatus } from '../../../components/common/AnnaTransferStatus';
import { useSettingsStore } from '../../../stores/settings-store';
import { useT } from '../../../i18n';
import { backgroundSlot } from '../background-slot';
import type { SceneId, TimePhase, WeatherType } from '../types';

export function BackgroundVideoSettings({ scene, weather, phase }: { scene: SceneId; weather: WeatherType; phase: TimePhase }) {
  const t = useT();
  const slot = backgroundSlot(scene, weather, phase);
  const file = useSettingsStore(state => state.backgroundVideos[slot]);
  const playbackError = useSettingsStore(state => state.backgroundErrors[slot]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const transfer = useAnnaFileTransfer();
  const supported = isAnna() || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  const apply = async (remove = false) => {
    if (busy || transfer.busy) return;
    setBusy(true); setError(undefined);
    try {
      let path: string | undefined;
      if (!remove) {
        if (isAnna()) {
          const selected = await pickAnnaVideo();
          if (selected) path = await transfer.stage(selected, 'background');
        } else path = await chooseDesktopVideo();
        if (!path) return;
      }
      await useSettingsStore.getState().updateBackgroundVideo(slot, path);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const phases = { day: '白天', dusk: '黄昏', night: '夜晚' };
  const weathers = { clear: '晴', rain: '雨', snow: '雪', spring: '春', summer: '夏' };
  const filename = file?.split(/[\\/]/).pop()?.replace(/^[0-9a-f-]{36}_/i, '');
  return <section className="cozy-background-settings" aria-label={t('自定义背景视频')}>
    <h4>{t('自定义背景视频')}</h4>
    <p>{t(scene === 'library' ? '图书馆' : '房间')} · {scene !== 'library' && `${t(weathers[weather])} · `}{t(phases[phase])}</p>
    <p className="cozy-companion-panel__hint">{t('只替换当前场景、天气和时段。视频静音循环，音乐单独控制。')}</p>
    <p className="cozy-companion-panel__hint">{t('支持 MP4 / WebM，单个不超过 128 MB；推荐 H.264 MP4 短循环视频。')}</p>
    <p className="cozy-background-settings__file" title={filename}>{filename || t('使用内置背景')}</p>
    <div className="cozy-background-settings__actions"><button type="button" className="cozy-btn-secondary" disabled={!supported || busy || transfer.busy} onClick={() => { void apply(); }}>{t(busy ? '正在导入视频…' : '选择背景视频…')}</button>
    {file && <button type="button" className="cozy-btn-ghost" disabled={busy || transfer.busy} onClick={() => { void apply(true); }}>{t('恢复内置背景')}</button>}
    </div>
    <AnnaTransferStatus transfer={transfer} />
    {!supported && <p className="cozy-companion-panel__hint">{t('自定义视频需要桌面或 Anna 本地版。')}</p>}
    {(error || playbackError) && <p role="alert">{error || playbackError}</p>}
  </section>;
}

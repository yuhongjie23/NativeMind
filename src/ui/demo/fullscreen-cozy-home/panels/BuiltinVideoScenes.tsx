import { useT } from '../../../i18n';
import type { SceneControls } from '../components/DemoSheet';
import type { SceneId, TimePhase, WeatherType } from '../types';

const scenes: { label: string; scene: SceneId; weather: WeatherType; phase: TimePhase }[] = [
  { label: '日常白天', scene: 'study-room', weather: 'clear', phase: 'day' },
  { label: '春日白天', scene: 'study-room', weather: 'spring', phase: 'day' },
  { label: '图书馆黄昏', scene: 'library', weather: 'clear', phase: 'dusk' },
  { label: '夏日萤火虫夜晚', scene: 'study-room', weather: 'summer', phase: 'night' },
];

export function BuiltinVideoScenes({ controls, onSelect }: { controls: SceneControls; onSelect: () => void }) {
  const t = useT();
  return <section className="cozy-background-settings" aria-label={t('内置视频场景')}>
    <h4>{t('内置视频场景')}</h4>
    <p className="cozy-companion-panel__hint">{t('四个视频已内置，无需另行下载。点击切换到对应时段；其他组合仍使用静态背景。')}</p>
    <div className="cozy-background-settings__actions">
      {scenes.map(item => <button key={item.label} type="button" className="cozy-btn-secondary" onClick={() => {
        controls.setScene(item.scene);
        controls.setWeather(item.weather);
        controls.setTimeMode(item.phase);
        onSelect();
      }}>{t(item.label)}</button>)}
    </div>
    <p className="cozy-companion-panel__hint">{t('已有自定义视频会优先播放，可在下方恢复内置背景。减少动态效果开启时，视频会暂停。')}</p>
  </section>;
}

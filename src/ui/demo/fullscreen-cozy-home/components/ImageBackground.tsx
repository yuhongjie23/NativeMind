/**
 * 背景层：按 (weather, timePhase) 选图/视频全屏铺底。
 *
 * 场景/女孩已融入背景；晴/白天现在是视频（白天.mp4），其余为图。
 * 视频自带音效，三条规则：
 *  - 默认出声，音量跟随主音量键；
 *  - 用户播放任何音乐 → 自动静音（音频互斥）；
 *  - 进入专注模式（全屏专注层 / 专注会话）→ 静音。
 * key={src} 切换时换元素 + CSS crossfade。后续图片可逐步替换为视频。
 */
import { resolveBackground } from '../backgrounds';
import type { SceneId, TimePhase, WeatherType } from '../types';

interface ImageBackgroundProps {
  weather: WeatherType;
  timePhase: TimePhase;
  /** 场景：图书馆只分白天/夜晚且不受天气影响 */
  scene: SceneId;
}

/**
 * 背景层：按 (scene, weather, timePhase) 选图/视频全屏铺底。
 * 视频（日常_白天.mp4）只当画面：自带音频一律静音，背景音乐走独立音源。
 */
export function ImageBackground({ weather, timePhase, scene }: ImageBackgroundProps) {
  const asset = resolveBackground(weather, timePhase, scene);

  if (asset.kind === 'video') {
    return (
      <video
        className="layer-background__video"
        key={asset.src}
        src={asset.src}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
    );
  }
  return <img className="layer-background__img" key={asset.src} src={asset.src} alt="" aria-hidden="true" />;
}

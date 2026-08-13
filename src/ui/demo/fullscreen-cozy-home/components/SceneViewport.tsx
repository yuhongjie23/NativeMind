/**
 * 全屏场景画布（V4 §5 / §7，图片背景版）。
 *
 * 固定 z-index 语义：背景图1 / 时间光照2 / 宠物6 / 可读性压暗8。
 * 场景与女孩已融入背景图；天气粒子由图片自带。HUD 是场景外兄弟节点（z20+）。
 */
import { ImageBackground } from './ImageBackground';
import { TimeLightingLayer } from './TimeLightingLayer';
import { PetActor } from './PetActor';
import { getSceneManifest } from '../scene-manifest';
import type { PetAction, SceneState } from '../types';

interface SceneViewportProps {
  sceneState: SceneState;
  petAction: PetAction;
  showPet: boolean;
  onPetInteract: () => void;
  /** 宠物位置上报：气泡跟随宠物移动 */
  onPetPositionChange?: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** 调模型生成回应中 → 宠物右上角转圈 */
  petGenerating?: boolean;
}

export function SceneViewport({
  sceneState,
  petAction,
  showPet,
  onPetInteract,
  onPetPositionChange,
  petGenerating = false,
}: SceneViewportProps) {
  const manifest = getSceneManifest(sceneState.sceneId);
  const { pet } = manifest.anchors;
  const brightness = Math.max(0.55, Math.min(1, sceneState.sceneBrightness / 100));

  return (
    <div
      className="scene-viewport"
      data-scene={sceneState.sceneId}
      data-time={sceneState.timePhase}
      data-weather={sceneState.weather}
      data-focus={sceneState.focusState !== 'idle' ? 'on' : 'off'}
      style={
        {
          '--pet-x': `${pet.x * 100}%`,
          '--pet-y': `${(1 - pet.y) * 100}%`,
          '--pet-scale': pet.scale ?? 1,
          '--scene-brightness': brightness,
        } as React.CSSProperties
      }
    >
      <ImageBackground weather={sceneState.weather} timePhase={sceneState.timePhase} scene={sceneState.sceneId} />
      <TimeLightingLayer phase={sceneState.timePhase} />
      {showPet ? (
        <PetActor
          action={petAction}
          onInteract={onPetInteract}
          onPositionChange={onPetPositionChange}
          generating={petGenerating}
        />
      ) : null}
      <div className="layer-vignette" aria-hidden="true" />
    </div>
  );
}

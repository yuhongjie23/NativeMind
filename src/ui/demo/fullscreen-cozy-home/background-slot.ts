import type { SceneId, TimePhase, WeatherType } from './types';

export const backgroundSlot = (scene: SceneId, weather: WeatherType, phase: TimePhase): string =>
  scene === 'library' ? `library:${phase}` : `study-room:${weather}:${phase}`;

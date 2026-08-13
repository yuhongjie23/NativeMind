/**
 * 时间光照覆盖层（V4 §19）。
 *
 * 三层渐变按 data-time 交叉淡入淡出：白天保持透明，黄昏加暖光，
 * 夜晚加深蓝暗层；台灯光与场景亮度由根节点的 data-sky 联动。
 */
import type { TimePhase } from '../types';

export function TimeLightingLayer({ phase }: { phase: TimePhase }) {
  return (
    <div className="time-lighting" data-phase={phase} aria-hidden="true">
      <span className="time-layer time-layer--day" />
      <span className="time-layer time-layer--dusk" />
      <span className="time-layer time-layer--night" />
    </div>
  );
}

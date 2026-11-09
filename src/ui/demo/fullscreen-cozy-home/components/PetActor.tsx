/**
 * 宠物独立动画通道（V4 §25，芙莉莲 Sprite Sheet 版）。
 *
 * 支持鼠标拖拽到任意位置（参考 Codex Pets）：pointerdown 捕获指针，
 * pointermove 更新 left/top（px），松开释放；拖拽时禁用过渡，避免拖影。
 * 拖拽时播放 sprite 里的「被拎起」动作（drag_lift / drag_hold / drag_left /
 * drag_right / drag_release）；未拖拽时按场景动作或锚点（--pet-x / --pet-y）定位。
 * 未配置 Sprite Sheet 时回退 CSS 占位形象。
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { AnimationRenderer } from './AnimationRenderer';
import { resolveAnimation } from '../asset-resolver';
import type { PetAction } from '../types';

/** 松开后短暂播「落地弹一下」，再回到基准动作 */
const DRAG_RELEASE_MS = 380;

interface PetActorProps {
  action: PetAction;
  onInteract?: () => void;
  /** 面板预览用：非交互，只展示姿态 */
  preview?: boolean;
  /** 上报宠物当前位置（viewport 坐标），供气泡跟随宠物移动 */
  onPositionChange?: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** 正在调本地模型生成回应 → 宠物右上角显示等待转圈 */
  generating?: boolean;
  pendingQuestion?: boolean;
}

interface DragState {
  x: number;
  y: number;
}

export function PetActor({ action, onInteract, preview = false, onPositionChange, generating = false, pendingQuestion = false }: PetActorProps) {
  const t = useT();
  // 拖拽期间覆盖场景动作：拖起 / 悬空 / 左拖 / 右拖 / 松开落地
  const [dragAction, setDragAction] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const moved = useRef(false);
  const releaseTimerRef = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const positionCbRef = useRef(onPositionChange);
  positionCbRef.current = onPositionChange;

  // 上报当前位置：挂载时 + 每次拖动变化（含恢复到锚点），供上层把气泡钉在宠物上方
  useEffect(() => {
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      positionCbRef.current?.({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [drag]);

  useEffect(() => () => window.clearTimeout(releaseTimerRef.current), []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (preview) return;
    moved.current = false;
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: rect.left, baseY: rect.top };
    setDrag({ x: rect.left, y: rect.top });
    window.clearTimeout(releaseTimerRef.current);
    setDragAction('drag_lift');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = event.clientX - start.startX;
    if (Math.hypot(dx, event.clientY - start.startY) > 6) moved.current = true;
    setDrag({ x: start.baseX + dx, y: start.baseY + (event.clientY - start.startY) });
    // 帧含义：往左拖→身体轻微向右滞后（drag_left），往右拖→向左滞后（drag_right）
    if (Math.abs(dx) > 6) setDragAction(dx < 0 ? 'drag_left' : 'drag_right');
    else setDragAction('drag_hold');
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragAction('drag_release');
    window.clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = window.setTimeout(() => setDragAction(null), DRAG_RELEASE_MS);
  };

  const descriptor = resolveAnimation('pet', dragAction ?? action);
  const dragStyle = drag
    ? ({ left: drag.x, top: drag.y, transform: 'none', transition: 'none' } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={rootRef}
      role={preview ? undefined : 'button'}
      tabIndex={preview ? -1 : 0}
      aria-label={preview ? undefined : t(pendingQuestion ? '查看宠物的问题' : '和芙莉莲打招呼')}
      onClick={() => { if (!preview && !moved.current) onInteract?.(); }}
      onKeyDown={event => { if (!preview && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onInteract?.(); } }}
      className="actor-layer actor-layer--pet"
      data-action={action}
      data-preview={preview}
      data-dragging={Boolean(drag)}
      style={dragStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 调模型期间：右上角等待转圈，文字生成后消失 */}
      {generating && !preview ? <span className="pet-spinner" aria-hidden="true" /> : null}
      {pendingQuestion && !preview && <span className="pet-question-dot" aria-hidden="true" />}
      <AnimationRenderer descriptor={descriptor} label={preview ? `芙莉莲 ${action}` : undefined}>
        <div className="pet-art">
          <span className="pet-art__sprout" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="pet-art__body" aria-hidden="true">
            <span className="pet-art__eye pet-art__eye--left" />
            <span className="pet-art__eye pet-art__eye--right" />
            <span className="pet-art__mouth" />
            <span className="pet-art__blush pet-art__blush--left" />
            <span className="pet-art__blush pet-art__blush--right" />
          </span>
          <span className="pet-art__shadow" aria-hidden="true" />
          {action === 'sleep_loop' ? (
            <span className="pet-art__zzz" aria-hidden="true">
              z z
            </span>
          ) : null}
        </div>
      </AnimationRenderer>
    </div>
  );
}

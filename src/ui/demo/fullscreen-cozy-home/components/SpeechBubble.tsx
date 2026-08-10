/**
 * 宠物气泡独立 HUD 层（V4 §36）。
 *
 * 锚定场景 Manifest 的 speechBubble 位置。只展示一句陪伴内容，
 * 不再内联回复输入框（主页面保持低打扰，回复移入陪伴面板）。
 */
import type { NormalizedPoint } from '../types';

export interface BubbleLine {
  id: number;
  text: string;
  requiresResponse?: boolean;
}

interface SpeechBubbleProps {
  line: BubbleLine | null;
  anchor: NormalizedPoint;
  /** 保留：主页面不再内联输入框，回复移入陪伴面板；onDismiss 用于气泡消失 */
  onRespond?: (text: string) => void;
  onDismiss?: () => void;
}

export function SpeechBubble({ line, anchor }: SpeechBubbleProps) {
  if (!line) return null;

  return (
    <div
      className="speech-bubble"
      data-show={line !== null}
      role="status"
      style={
        {
          '--bubble-x': `${anchor.x * 100}%`,
          '--bubble-y': `${(1 - anchor.y) * 100}%`,
        } as React.CSSProperties
      }
    >
      <p className="speech-bubble__text">{line.text}</p>
    </div>
  );
}

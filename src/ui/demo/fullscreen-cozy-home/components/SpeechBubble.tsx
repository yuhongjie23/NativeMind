/**
 * 宠物气泡独立 HUD 层（V4 §36）。
 *
 * 锚定场景 Manifest 的 speechBubble 位置。只展示一句陪伴内容，
 * 不再内联回复输入框（主页面保持低打扰，回复移入陪伴面板）。
 */
import type { NormalizedPoint } from '../types';
import { useT } from '../../../i18n';

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
  onOpen?: () => void;
}

export function SpeechBubble({ line, anchor, onDismiss, onOpen }: SpeechBubbleProps) {
  const t = useT();
  if (!line) return null;

  return (
    <div
      className="speech-bubble"
      data-show={line !== null}
      role="status"
      style={
        {
          '--bubble-x': `${Math.max(12, Math.min(88, anchor.x * 100))}%`,
          '--bubble-y': `${(1 - anchor.y) * 100}%`,
        } as React.CSSProperties
      }
    >
      <p className="speech-bubble__text">{line.requiresResponse ? t('有个小问题，方便时再聊。') : line.text}</p>
      <div className="speech-bubble__actions">
        {line.requiresResponse && <button type="button" onClick={onOpen}>{t('查看')}</button>}
        <button type="button" aria-label={t('收起宠物提示')} onClick={onDismiss}>×</button>
      </div>
    </div>
  );
}

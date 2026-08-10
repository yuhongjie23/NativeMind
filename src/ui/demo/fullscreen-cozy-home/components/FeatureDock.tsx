/**
 * 底部功能入口 —— 单一收纳按钮版。
 *
 * 主界面只留一个圆形按钮（功能入口）；点击展开/收起全部功能项（今天/专注/
 * 知识/复盘/陪伴/写信/设置）。收起时几乎不挡场景，展开后点某项即打开面板并收回。
 */
import {
  ChartNoAxesColumnIncreasing,
  LayoutGrid,
  LibraryBig,
  ListTodo,
  Mail,
  Settings2,
  Sprout,
  Timer,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useT } from '../../../i18n';
import type { PanelKey } from '../types';

interface DockItem {
  key: PanelKey;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
}

const dockItems: DockItem[] = [
  { key: 'today', label: '今天', Icon: ListTodo },
  { key: 'focus', label: '专注', Icon: Timer },
  { key: 'knowledge', label: '知识/检索', Icon: LibraryBig },
  { key: 'review', label: '复盘', Icon: ChartNoAxesColumnIncreasing },
  { key: 'companion', label: '陪伴', Icon: Sprout },
  { key: 'letter', label: '对话', Icon: Mail },
  { key: 'settings', label: '设置', Icon: Settings2 },
];

interface FeatureDockProps {
  activePanel: PanelKey | null;
  onOpen: (panel: PanelKey) => void;
}

export function FeatureDock({ activePanel, onOpen }: FeatureDockProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLElement | null>(null);

  // 展开后：点外部任意处 / 按 Esc → 自动收回，不点按钮也能收起
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (dockRef.current && !dockRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => setOpen((value) => !value);
  const handleOpen = (key: PanelKey) => {
    onOpen(key);
    setOpen(false);
  };

  return (
    <nav ref={dockRef} className="feature-dock" data-open={open} aria-label={t('功能入口')}>
      <ul className="feature-dock__flyout" data-open={open}>
        {dockItems.map(({ key, label, Icon }) => {
          const active = activePanel === key;
          return (
            <li key={key} className="feature-dock__slot">
              <button
                type="button"
                className="feature-dock__item"
                data-active={active}
                aria-pressed={active}
                onClick={() => handleOpen(key)}
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden={true} />
                <span className="feature-dock__label">{t(label)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="feature-dock__toggle"
        aria-expanded={open}
        aria-label={open ? t('收起功能') : t('展开功能')}
        title={open ? t('收起功能') : t('功能')}
        onClick={toggle}
      >
        {open ? <X size={22} strokeWidth={1.75} aria-hidden={true} /> : <LayoutGrid size={22} strokeWidth={1.75} aria-hidden={true} />}
      </button>
    </nav>
  );
}

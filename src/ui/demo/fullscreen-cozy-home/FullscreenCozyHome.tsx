/**
 * NativeMind「心流小筑」全屏应用界面（V4 视觉 + 真实功能）。
 *
 * 视觉层沿用全屏场景/HUD 结构；功能层接入真实运行时：
 *   React UI -> Zustand store -> application use-case -> repository（Tauri SQLite 或浏览器内存）
 *
 * 场景导演由真实事件驱动：专注开始/完成/中断改变女孩动作；
 * 陪伴 store 的 animation/current 驱动宠物动作与气泡；设置/任务/笔记/
 * 复盘/音乐全部走真实 store。视觉场景偏好（房间/天气/时间预览/亮度）仍为本地状态。
 */
import { useEffect, useRef, useState } from 'react';
import { ConfirmationModal } from '../../components/features/ConfirmationModal';
import { SimpleConfirmModal } from '../../components/features/SimpleConfirmModal';
import { ToastHost } from '../../components/features/ToastHost';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { usePanelDirty } from './panel-dirty';
import { usePetQuestion } from './pet-question';
import { FullscreenFocus } from './FullscreenFocus';
import { DemoSheet } from './components/DemoSheet';
import type { SceneControls } from './components/DemoSheet';
import { FeatureDock } from './components/FeatureDock';
import { FocusHud } from './components/FocusHud';
import { LofiHud } from './components/LofiHud';
import { SceneViewport } from './components/SceneViewport';
import { SpeechBubble } from './components/SpeechBubble';
import { TopHud } from './components/TopHud';
import { useActorQueue } from './scene-director';
import { configurePetSprite } from './asset-resolver';
import { getSceneManifest } from './scene-manifest';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { ensureOllamaRunning, readImportedBytes } from '@infrastructure/paths/paths-api';
import { exitFullscreenIfActive, toggleFullscreen } from '@infrastructure/window-api';
import { mimeByExtension } from '../../stores/music-store';
import { useCompanionStore } from '../../stores/companion-store';
import { useFocusStore } from '../../stores/focus-store';
import { useFocusOverlayStore } from '../../stores/focus-overlay';
import { useFocusMusicStore } from '../../stores/focus-music';
import {
  clearActiveSource,
  registerAudioStopper,
  setMasterMuted,
  setMasterVolume,
  silenceOthers,
  unregisterAudioStopper,
} from '../../stores/audio-exclusive';
import { useBackgroundMusic } from '../../hooks/use-background-music';
import { useBgmStore } from '../../stores/bgm-store';
import { backgroundMusicFor } from './background-music';
import { useFocusMode } from '../../hooks/use-focus-mode';
import { useMusicStore } from '../../stores/music-store';
import { useNoteStore } from '../../stores/note-store';
import { useReviewStore } from '../../stores/review-store';
import { backfillMissingReviews } from '../../stores/review-auto';
import { useSettingsStore } from '../../stores/settings-store';
import { useToastStore } from '../../stores/toast-store';
import { useTodoStore } from '../../stores/todo-store';
import { audioPlayer, describeError, eventBus, infrastructure, policies, repositories, startRuntime } from '../../stores/runtime';
import type {
  AmbientMode,
  DemoSettings,
  PanelKey,
  PetAction,
  SceneId,
  TimeMode,
  TimePhase,
  WeatherType,
} from './types';
import { formatClock, formatDateLong, phaseForHour } from './utils';
import { formatLocalDate } from '@application/shared/utils';
import './fullscreen-cozy-home.css';

/**
 * 每日维护：数据库备份 + 数据清理。
 * 原来挂在死掉的 App.tsx 的 cleanup() 里，从未执行过 —— 意味着自动备份从未跑过，
 * 过期 actionProposal/陪伴记录/模型日志也从未清理。这里搬进真实启动流程，按本地日防重。
 */
const runMaintenance = async (): Promise<void> => {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const today = formatLocalDate(new Date());
    const last = await repositories.settings.get('maintenance.lastRun');
    const ranToday = last === today;

    // 备份不 gate：每次启动都备一份（Rust 侧按时间戳保留最近 7 份轮转）。
    // 之前只在「当天首次启动」备份一份并覆盖——应用连续多天不重启，备份就
    // 停留在最早那天，当天崩溃只能恢复到昨天早晨的快照，删除/损坏难找回。
    const backup = import('@tauri-apps/api/core').then(({ invoke }) => invoke('db_backup'));
    if (ranToday) {
      await backup.catch(() => undefined); // 今天已维护过：只补一次启动备份
      return;
    }

    const infra = infrastructure as unknown as {
      jobQueue: { purgeCompleted(days: number): Promise<number> };
      modelRunRecorder: { purgeOlderThan(days: number): Promise<number> };
    };
    const repo = repositories as unknown as {
      companionInteraction: { purgeOlderThan(days: number): Promise<number> };
      actionProposal: { expireOlderThan(hours: number): Promise<number> };
    };
    await Promise.allSettled([
      infra.jobQueue.purgeCompleted(7),
      repo.companionInteraction.purgeOlderThan(90),
      repo.actionProposal.expireOlderThan(24),
      infra.modelRunRecorder.purgeOlderThan(30),
      backup,
    ]);
    await repositories.settings.set('maintenance.lastRun', today);
  } catch {
    // 维护失败静默，不打断使用
  }
};

/** 单环境模式 → 音频库 ambient 轨道；none/custom 返回 null（custom 走单独播放器） */
const ambientIdFor = (mode: AmbientMode, weather: WeatherType): string | null => {
  if (mode === 'none' || mode === 'custom') return null;
  if (weather === 'rain') return 'focus_rain';
  if (weather === 'snow') return 'focus_snow';
  return 'focus_sunny';
};

/** 视觉偏好默认值（每个环境内置音效：雨→雨声、雪→雪声、晴→晴日） */
const defaultDemoSettings = (): DemoSettings => ({
  sceneId: 'study-room',
  timeMode: 'auto',
  weather: 'clear',
  brightness: 80,
  envAnimation: true,
  reducedMotion:
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  showPet: true,
  petAutoRest: true,
  petQuietInFocus: true,
  ambientByWeather: {
    clear: { mode: 'builtin' },
    rain: { mode: 'builtin' },
    snow: { mode: 'builtin' },
    spring: { mode: 'builtin' },
    summer: { mode: 'builtin' },
  },
});

const DEMO_SETTINGS_KEY = 'nativemind.demo-settings.v1';

/** 从 localStorage 读取视觉偏好，与默认值合并（兼容缺字段/旧版本） */
const loadDemoSettings = (): DemoSettings => {
  const defaults = defaultDemoSettings();
  try {
    const raw = window.localStorage.getItem(DEMO_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DemoSettings>;
    return {
      ...defaults,
      ...parsed,
      ambientByWeather: {
        ...defaults.ambientByWeather,
        ...(parsed.ambientByWeather ?? {}),
      },
    };
  } catch {
    return defaults;
  }
};

/** 气泡内容：来自真实陪伴互动或本地唤醒语 */
interface BubbleState {
  id: number;
  text: string;
  requiresResponse?: boolean;
}

export function FullscreenCozyHome() {
  const [now, setNow] = useState(() => new Date());
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [petInteractTick, setPetInteractTick] = useState(0);
  // 宠物当前位置（viewport px），气泡钉在宠物上方、跟随拖动移动
  const [petRect, setPetRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // 主音量与全部静音（作用到 ambient / 音乐 / 自定义背景音频）
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  // 当前正在播放的背景音乐轨道（观测用，data-bgm）
  const [playingAmbient, setPlayingAmbient] = useState<string | null>(null);
  // 场景背景音乐（useBackgroundMusic 那一路）是否在播
  const bgmPlaying = useBgmStore((state) => state.playing);
  // 正在播放的自定义背景音频文件名（LofiHud 显示用）
  const [customTrackName, setCustomTrackName] = useState('');
  // 全屏极简专注模式是否打开（共享开关，Today 面板也能触发）
  const focusOverlay = useFocusOverlayStore((state) => state.open);
  // 首次用户交互后重试背景音乐（浏览器自动播放策略）
  const [gestureTick, setGestureTick] = useState(0);
  // 背景音乐开关「开启」时自增：强制 useBackgroundMusic 重新加载当前场景音乐
  const [bgmReloadKey, setBgmReloadKey] = useState(0);
  // 关闭面板前的未完成确认
  const [confirmPanel, setConfirmPanel] = useState<PanelKey | null>(null);
  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;

  const requestClose = () => {
    const current = activePanelRef.current;
    if (current && usePanelDirty.getState().dirty[current]) {
      setConfirmPanel(current);
    } else {
      setActivePanel(null);
    }
  };
  const customAudioRef = useRef<HTMLAudioElement | null>(null);
  const customUrlRef = useRef<string | null>(null);
  // 自定义音频播放代数：切天气/切模式时让在途的旧 playCustom 结果作废，防止两个循环音叠加
  const customPlayTokenRef = useRef(0);

  const ambientFilesByWeather = useSettingsStore((state) => state.ambientFilesByWeather);
  const focusMusicFile = useSettingsStore((state) => state.focusMusicFile);
  const quietDuringFocus = useSettingsStore((state) => state.focus.quietDuringFocus);
  const companionEnabled = useSettingsStore((state) => state.companion.enabled);
  const companionAssetBase = useSettingsStore((state) => state.companion.assetBase);
  const musicPlaying = useMusicStore((state) => state.playing);
  const petQuestion = usePetQuestion((state) => state.question);

  // 视觉场景偏好：localStorage 持久化，重启后保留
  const [settings, setSettings] = useState<DemoSettings>(loadDemoSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage 不可用时静默，仅本次会话有效
    }
  }, [settings]);

  const petQueue = useActorQueue<PetAction>('pet', 'idle');
  const petActionRef = useRef(petQueue.action);
  petActionRef.current = petQueue.action;

  // 真实专注会话
  const activeSession = useFocusStore((state) => state.active);

  /* ---------- 专注倒计时归零：系统通知（挂在常驻根组件，切页/关全屏也能收到） ---------- */
  useFocusMode(() => {
    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === 'granted';
        if (granted) {
          sendNotification({ title: 'NativeMind · 专注结束', body: '这一段的计时到了，收个尾吧。' });
        }
      } catch {
        // 通知失败不影响专注
      }
    })();
  });
  // 真实陪伴动画与当前互动
  const companionAnimation = useCompanionStore((state) => state.animation);
  const currentInteraction = useCompanionStore((state) => state.current);
  const petGenerating = useCompanionStore((state) => state.generating);

  const bubbleTimer = useRef<number | undefined>(undefined);

  /* ---------- 运行时启动 ---------- */
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    startRuntime()
      .then(async (stopFn) => {
        if (cancelled) {
          stopFn();
          return;
        }
        stop = stopFn;
        document.title = 'NativeMind';
        // 设置必须在建表后读；恢复中断专注进 FocusModePolicy
        await useSettingsStore.getState().load();

        // 自愈：存储地址迁移后，旧的自定义背景音频路径可能指向已不存在的目录，
        // 按文件名在新 data_dir/imports 下找回并重写；改过就重新读一遍设置
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('file_repair_custom_audio_paths');
            await useSettingsStore.getState().load();
          } catch {
            // 自愈失败不影响启动
          }
        }

        // 把持久化的背景音乐模式回灌进场景状态（与文件同库，重启不丢）
        const ambientModes = useSettingsStore.getState().ambientModeByWeather;
        setSettings((s) => {
          const ambientByWeather = { ...s.ambientByWeather };
          for (const weather of Object.keys(ambientByWeather) as WeatherType[]) {
            const mode = ambientModes[weather];
            if (mode) {
              ambientByWeather[weather] = {
                ...ambientByWeather[weather],
                mode: mode as AmbientMode,
              };
            }
          }
          return { ...s, ambientByWeather };
        });

        // 先回收崩溃遗留的超时 active 幽灵会话（>24h），再恢复真正进行中的专注：
        // 否则每次重启都会把它当 active，弹「专注结束」、静音、锁专注视觉态
        await repositories.focus
          .abortStaleActive(24)
          .then(() => repositories.focus.findActive())
          .then((active) => {
            if (active) policies.focus.activate(active.id);
          })
          .catch(() => undefined);

        await Promise.allSettled([
          useTodoStore.getState().refresh(),
          useFocusStore.getState().refresh(),
          useNoteStore.getState().refresh(),
          useReviewStore.getState().refresh(),
          useCompanionStore.getState().refresh(),
          useMusicStore.getState().refresh(),
        ]);

        if (cancelled) return;
        setReady(true);
        // 崩溃恢复复盘草稿已由桌面 runtime（tauri-runtime.start）处理，
        // 这里不再重复弹窗；web 演示模式无持久化草稿，无需恢复。
        // 每日维护（备份+清理）：原来挂在死掉的 App.tsx 里从未执行，搬进真实启动流程
        void runMaintenance();
        // 复盘自动补生成：昨天/上周/上月缺失且当日有学习数据时触发（确认框决定是否写入）。
        // 放启动流程末尾：等各 store refresh 完成、确认门可用后再跑，避免和引导弹窗抢。
        void backfillMissingReviews().catch(() => undefined);
        // 确保本机 Ollama 在运行：未运行则后台拉起，保证模型可用（不阻塞启动）
        void ensureOllamaRunning().then((status) => {
          if (status === 'started') {
            useToastStore.getState().show('Ollama 服务已自动启动', 'info');
          } else if (status === 'failed') {
            useToastStore.getState().show('Ollama 未运行且自动启动失败，请运行 setup_ollama.bat', 'error');
          }
        });
        void eventBus.publish({
          type: 'AppEntered',
          isFirstLaunch: false,
          timestamp: new Date().toISOString(),
        });
        void useCompanionStore.getState().trigger('enter', 'AppEntered');
      })
      .catch((error) => {
        if (!cancelled) setBootError(describeError(error));
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  /* ---------- 本地时间与 reduced-motion ---------- */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 订阅 CompanionInteractionCreated：任意互动创建后送到主场景（P0-2 统一事件通道）
  useEffect(() => useCompanionStore.getState().init(), []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) =>
      setSettings((s) => ({ ...s, reducedMotion: event.matches }));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // 首次点击/触摸后重跑背景音乐效果，绕过浏览器自动播放拦截
  useEffect(() => {
    const onGesture = () => setGestureTick((value) => value + 1);
    window.addEventListener('pointerdown', onGesture, { once: true });
    return () => window.removeEventListener('pointerdown', onGesture);
  }, []);

  // 当前是否处于 OS 全屏（F11 / 专注联动进入）。Esc 优先退出全屏恢复边框。
  const [osFullscreen, setOsFullscreen] = useState(false);
  // 初始化 + 监听窗口事件同步全屏状态：进入/退出全屏都在别处发 setDecorations，
  // 这里只负责读取状态供 Esc 裁决，避免状态漂移。
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        if (disposed) return;
        setOsFullscreen(await win.isFullscreen());
      } catch {
        // 初始化失败保持默认 false
      }
    })();
    const onResized = (() => {
      if (!('__TAURI_INTERNALS__' in window)) return undefined;
      let off: (() => void) | undefined;
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const win = getCurrentWindow();
          off = await win.onResized(() => {
            void win.isFullscreen().then(setOsFullscreen).catch(() => undefined);
          });
        } catch {
          // 事件注册失败：仅按键时读取即可
        }
      })();
      return () => off?.();
    })();
    return () => {
      disposed = true;
      onResized?.();
    };
  }, []);

  // Esc：优先级 ① 专注全屏层（其自身处理，这里不拦）② OS 全屏（退出全屏恢复边框）
  // ③ 副面板（关闭面板）。专注层挂载时用自身 ESC，主组件这里用 osFullscreen 兜底。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (focusOverlay) return; // 专注全屏层自己处理 Esc
      if (osFullscreen) {
        event.preventDefault();
        void exitFullscreenIfActive()
          .then(() => setOsFullscreen(false))
          .catch(() => undefined);
        return;
      }
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // F11 沉浸式全屏切换（仅桌面端；web 演示忽略）。聚焦在输入框时不劫持。
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F11') return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select')) return;
      event.preventDefault();
      void toggleFullscreen()
        .then(setOsFullscreen)
        .catch(() => undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 进入「专注全屏覆盖层」→ 同步切换 OS 沉浸式全屏（隐藏系统标题栏）；
  // 退出覆盖层 → 恢复窗口。这样专注模式是无边框真全屏，而不是带标题栏的窗口。
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        if (focusOverlay) {
          await win.setDecorations(false);
          await win.setFullscreen(true);
          setOsFullscreen(true);
        } else {
          await win.setFullscreen(false);
          await win.setDecorations(true);
          setOsFullscreen(false);
        }
      } catch {
        // 全屏联动失败不应打断专注流程
      }
    })();
  }, [focusOverlay]);

  /* ---------- 场景导演：陪伴动画驱动宠物 ---------- */
  const prevPetAnimRef = useRef(companionAnimation);
  useEffect(() => {
    const prev = prevPetAnimRef.current;
    prevPetAnimRef.current = companionAnimation;
    if (prev === companionAnimation) return;
    const sleeping =
      petActionRef.current === 'sleep_loop' || petActionRef.current === 'sleep_enter';
    switch (companionAnimation) {
      case 'greet':
        petQueue.cue(sleeping ? 'wake' : 'greet', {
          priority: 80,
          ...(sleeping ? { chain: ['greet'] } : {}),
        });
        break;
      case 'cheer':
        petQueue.cue(sleeping ? 'wake' : 'cheer', {
          priority: 90,
          ...(sleeping ? { chain: ['cheer'] } : {}),
        });
        break;
      case 'concerned':
        petQueue.cue('concerned', { priority: 70 });
        break;
      case 'sleep':
        petQueue.cue('sleep_enter', { priority: 30, chain: ['sleep_loop'] });
        break;
      default:
        break; // idle 交给队列自然回落，不强制打断睡眠
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionAnimation]);

  /* ---------- 场景导演：真实领域事件驱动宠物（V4 §31） ---------- */
  useEffect(() => {
    const offComplete = eventBus.subscribe('FocusSessionCompleted', () => {
      // 结束时提示音（设置开关）。事件回调里读 store 当前值，不能用挂载时的闭包旧值
      if (useSettingsStore.getState().focus.completionCue) {
        void audioPlayer.play('focus_complete');
      }
      const sleeping =
        petActionRef.current === 'sleep_loop' || petActionRef.current === 'sleep_enter';
      petQueue.cue(sleeping ? 'wake' : 'cheer', {
        priority: 90,
        ...(sleeping ? { chain: ['cheer'] } : {}),
      });
      if (!useFocusStore.getState().active) showLine('这段做完再歇一会儿。');
    });
    const offAbort = eventBus.subscribe('FocusSessionAborted', () => {
      petQueue.cue('concerned', { priority: 70 });
      showLine('先停下来也没关系。');
    });
    return () => {
      offComplete();
      offAbort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 气泡：真实互动内容 ---------- */
  useEffect(() => {
    if (currentInteraction) {
      setBubble({
        id: 1,
        text: currentInteraction.content ?? '',
        requiresResponse: currentInteraction.requiresResponse,
      });
    } else {
      setBubble(null);
    }
  }, [currentInteraction]);

  /* ---------- 陪伴提问：宠物做「认真查看问题」小动作（sprite 第 8 行） ---------- */
  const wasQuestionRef = useRef(false);
  useEffect(() => {
    const isQuestion = currentInteraction?.interactionType === 'question';
    if (isQuestion && !wasQuestionRef.current) {
      const sleeping =
        petActionRef.current === 'sleep_loop' || petActionRef.current === 'sleep_enter';
      petQueue.cue(sleeping ? 'wake' : 'examining', {
        priority: 85,
        ...(sleeping ? { chain: ['examining'] } : {}),
      });
    } else if (!isQuestion && wasQuestionRef.current) {
      // 问题回答/关闭后回到待机
      petQueue.cue('idle', { priority: 10 });
    }
    wasQuestionRef.current = isQuestion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInteraction]);

  /* ---------- 宠物苏格拉底提问：冒一个简单问题气泡 ---------- */
  useEffect(() => {
    if (!petQuestion) return;
    window.clearTimeout(bubbleTimer.current);
    setBubble({ id: Date.now(), text: petQuestion });
    bubbleTimer.current = window.setTimeout(() => {
      setBubble(null);
      usePetQuestion.getState().clear();
    }, 4200);
    return () => window.clearTimeout(bubbleTimer.current);
  }, [petQuestion]);

  /* ---------- 陪伴主动一拍：每 10 分钟由陪伴 agent 决定是否说一句（策略会拦专注/节流） ---------- */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void useCompanionStore.getState().proactiveTick();
    }, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /* ---------- 本地气泡（唤醒语）与自动休息 ---------- */
  const showLine = (text: string) => {
    window.clearTimeout(bubbleTimer.current);
    setBubble({ id: Date.now(), text });
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2200);
  };

  useEffect(() => {
    if (!settings.petAutoRest) return undefined;
    const timer = window.setTimeout(() => {
      const action = petActionRef.current;
      if (action === 'sleep_loop' || action === 'sleep_enter') return;
      petQueue.cue('sleep_enter', { priority: 30, chain: ['sleep_loop'] });
    }, 75_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.petAutoRest, petInteractTick]);

  const handlePetInteract = () => {
    setPetInteractTick((t) => t + 1);
    const action = petActionRef.current;
    if (action === 'sleep_loop' || action === 'sleep_enter') {
      petQueue.cue('wake', { priority: 100, chain: ['greet'] });
      showLine('醒了。要继续吗？');
      // 醒来后也紧跟一段随机模型互动，保证点击一定有回应
      void useCompanionStore.getState().trigger('user_invoked');
      return;
    }
    void useCompanionStore.getState().trigger('user_invoked');
  };

  const handleRespond = async (text: string) => {
    await useCompanionStore.getState().respond(text);
  };

  const handleDismiss = () => {
    useCompanionStore.getState().dismiss();
  };

  /* ---------- 自定义背景音频：读字节 → Blob → 循环播放 ---------- */
  const stopCustom = () => {
    customPlayTokenRef.current += 1; // 让在途的 playCustom 结果作废
    customAudioRef.current?.pause();
    customAudioRef.current = null;
    if (customUrlRef.current) {
      URL.revokeObjectURL(customUrlRef.current);
      customUrlRef.current = null;
    }
    setCustomTrackName('');
    clearActiveSource('custom');
  };

  const playCustom = async (path: string) => {
    stopCustom();
    // 同一时刻只响一个：停掉音乐库 / 专注音乐 / 内置环境音
    silenceOthers('custom');
    const token = customPlayTokenRef.current;
    if (!path) {
      setPlayingAmbient(null);
      return;
    }
    setCustomTrackName(path.split(/[\\/]/).pop() ?? '');
    let bytes: ArrayBuffer;
    try {
      bytes = await readImportedBytes(path);
    } catch (error) {
      // 文件不可读（如迁移后路径失效）：不能崩溃，给出可感知状态并提示重新选择
      setPlayingAmbient('unreadable');
      setCustomTrackName('');
      useToastStore.getState().show(`背景音乐不可读，请到设置重新选择：${describeError(error)}`, 'error');
      return;
    }
    // 读取期间又切了天气/模式：丢弃这次结果，否则两个循环音叠加
    if (token !== customPlayTokenRef.current) {
      setCustomTrackName('');
      return;
    }
    if (!bytes || bytes.byteLength === 0) {
      setPlayingAmbient('unreadable');
      setCustomTrackName('');
      return;
    }
    const blob = new Blob([bytes], { type: mimeByExtension(path) });
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.loop = true;
    el.volume = volume * (muted ? 0 : 1);
    el.muted = muted;
    customUrlRef.current = url;
    customAudioRef.current = el;
    try {
      await el.play();
      setPlayingAmbient('custom');
    } catch {
      // 自动播放被 WebView/浏览器拦：等用户交互后由 applyAmbientRef 重试
    }
  };

  /* ---------- 派生场景状态：时段（applyAmbient / useBackgroundMusic 都依赖，须先声明） ---------- */
  const timePhase: TimePhase =
    settings.timeMode === 'auto' ? phaseForHour(now.getHours()) : settings.timeMode;

  /* ---------- 背景音乐：按当前环境配置播放（「专注时保持安静」可开关） ---------- */
  const applyAmbient = () => {
    try {
      // 专注音乐在放：不叠加环境音（专注音乐是独立音源，音量键同样可控）
      if (useFocusMusicStore.getState().playing) {
        stopCustom();
        audioPlayer.stopAll();
        setPlayingAmbient(null);
        return;
      }
      // 「专注时保持安静」开启（默认）：专注中停掉环境音/音乐，只留专注音乐。
      // 关掉后环境音继续放，全屏音量键即可控制全局声音。
      if (quietDuringFocus && (activeSession || focusOverlay)) {
        stopCustom();
        audioPlayer.stopAll();
        useMusicStore.getState().pause();
        setPlayingAmbient(null);
        return;
      }
      // 音乐库在放：不叠加背景音乐，但继续让它放
      if (musicPlaying) {
        stopCustom();
        audioPlayer.stopAll();
        setPlayingAmbient(null);
        return;
      }
      const setting = settings.ambientByWeather[settings.weather];
      if (setting.mode === 'custom') {
        stopCustom();
        const file = ambientFilesByWeather[settings.weather];
        if (file) void playCustom(file);
        else {
          audioPlayer.stopAll();
          setPlayingAmbient(null);
        }
        return;
      }
      stopCustom();
      const id = ambientIdFor(setting.mode, settings.weather);
      // 有背景音乐（useBackgroundMusic 会从资源目录播）→ 内置环境音让位，别把它顶掉
      const bgMusic = backgroundMusicFor(settings.sceneId, settings.weather, timePhase);
      if (bgMusic) {
        audioPlayer.stopAll();
        setPlayingAmbient(null);
        return;
      }
      if (id) {
        // 同一时刻只响一个：停掉音乐库 / 专注音乐 / 自定义天气歌
        silenceOthers('ambient');
        void audioPlayer.play(id);
        setPlayingAmbient(id);
      } else {
        audioPlayer.stopAll();
        setPlayingAmbient(null);
      }
    } catch {
      // 任何音频异常都不能拖垮主界面
      stopCustom();
      audioPlayer.stopAll();
      setPlayingAmbient(null);
    }
  };

  useEffect(() => {
    applyAmbient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.ambientByWeather,
    settings.weather,
    // 切场景/时段也要重算环境音：否则从有 bgm 的场景切到无 bgm 的夏日会全静音
    settings.sceneId,
    timePhase,
    ambientFilesByWeather,
    activeSession,
    musicPlaying,
    focusOverlay,
    quietDuringFocus,
    gestureTick,
  ]);

  // 音频互斥：注册环境音 / 自定义天气歌的停止函数，供其它音源播放时停掉自己
  const stopCustomRef = useRef(stopCustom);
  stopCustomRef.current = stopCustom;
  useEffect(() => {
    registerAudioStopper('ambient', () => {
      audioPlayer.stopAll();
      clearActiveSource('ambient');
    });
    registerAudioStopper('custom', () => stopCustomRef.current());
    return () => {
      unregisterAudioStopper('ambient');
      unregisterAudioStopper('custom');
    };
  }, []);

  // 宠物 Sprite Sheet：配置资源目录并加载 Manifest（失败静默回退 CSS PetActor）
  useEffect(() => {
    void configurePetSprite(companionAssetBase);
  }, [companionAssetBase]);

  // 用户交互后若背景音乐没在播，重试一次（绕过自动播放拦截，桌面端选完音频后点一下即响）。
  // 只依赖首交手势的 gestureTick 重试；不再监听每次 pointerdown，否则用户刚点的「暂停」
  // 会被下一次点击悄悄恢复。
  const applyAmbientRef = useRef(applyAmbient);
  applyAmbientRef.current = applyAmbient;

  /* ---------- LofiHud 背景音乐开关：统一切换场景背景音乐/音乐库 ---------- */
  const toggleBgm = () => {
    // 场景背景音乐在播 → 暂停/恢复它
    if (useBgmStore.getState().playing) {
      useBgmStore.getState().toggle();
      return;
    }
    // 内置/自定义环境音在播 → 关闭
    if (playingAmbient !== null) {
      stopCustom();
      audioPlayer.stopAll();
      setPlayingAmbient(null);
      return;
    }
    const library = useMusicStore.getState();
    // 音乐库有选中曲目 → 播放/暂停它（统一走 toggle：暂停保留进度，恢复从暂停处续播，
    // 而不是走 play() 重建 src 从头播放）
    if (library.current) {
      void library.toggle();
      return;
    }
    // 什么都没播 → 恢复场景背景音乐（若该场景有音乐），否则按环境配置恢复
    useBgmStore.getState().toggle();
    // 强制重新加载：覆盖 autoplay 被拦 / src 已被停掉的情况
    setBgmReloadKey((key) => key + 1);
    applyAmbientRef.current();
  };

  /* ---------- 背景音乐专用开关（顶栏 ♪ 键）：只控制场景背景音乐 + 天气自定义歌，不碰音乐库 ---------- */
  const toggleBackgroundMusic = () => {
    // 场景背景音乐在播 → 暂停/恢复它
    if (useBgmStore.getState().playing) {
      useBgmStore.getState().toggle();
      return;
    }
    // 内置/自定义环境音在播 → 关闭
    if (playingAmbient !== null) {
      stopCustom();
      audioPlayer.stopAll();
      setPlayingAmbient(null);
      return;
    }
    // 什么都没播 → 恢复场景背景音乐（若该场景有音乐），否则按环境配置恢复
    useBgmStore.getState().toggle();
    // 强制重新加载：覆盖 autoplay 被拦 / src 已被停掉的情况
    setBgmReloadKey((key) => key + 1);
    applyAmbientRef.current();
  };

  /* ---------- 专注音乐 ----------
   * 会话开始自动播、结束自动停；全屏层里手动选歌/开关不被打断。
   * 之前的实现把「非会话」直接当「停止」，导致在全屏里选歌会秒停；
   * 且不监听 focusOverlay，关掉全屏后音乐会继续与环境音叠加。分三个 effect 修掉。
   */
  // 1) 配置变化只更新文件，不重启播放
  useEffect(() => {
    useFocusMusicStore.getState().setFile(focusMusicFile);
  }, [focusMusicFile]);

  // 2) 会话边界自动播/停（只在 activeSession 翻转时触发）
  const prevFocusActiveRef = useRef(activeSession);
  useEffect(() => {
    const prev = prevFocusActiveRef.current;
    prevFocusActiveRef.current = activeSession;
    if (!prev && activeSession && focusMusicFile) {
      void useFocusMusicStore.getState().play();
    } else if (prev && !activeSession) {
      useFocusMusicStore.getState().stop();
    }
  }, [activeSession, focusMusicFile]);

  // 3) 关闭专注全屏且没有进行中的会话 → 停掉专注音乐，避免回到主界面还响
  useEffect(() => {
    if (!focusOverlay && !activeSession) {
      useFocusMusicStore.getState().stop();
    }
  }, [focusOverlay, activeSession]);

  /* ---------- 主音量 / 全部静音 ---------- */
  useEffect(() => {
    audioPlayer.setMasterVolume(volume);
    useMusicStore.getState().setVolume(volume);
    useFocusMusicStore.getState().setVolume(volume);
    if (customAudioRef.current) customAudioRef.current.volume = volume * (muted ? 0 : 1);
    // 背景视频音效也跟随主音量
    setMasterVolume(volume);
  }, [volume, muted]);

  useEffect(() => {
    audioPlayer.setMuted(muted);
    useMusicStore.getState().setMuted(muted);
    useFocusMusicStore.getState().setMuted(muted);
    if (customAudioRef.current) customAudioRef.current.muted = muted;
    // 背景视频音效也跟随全局静音（双击静音）
    setMasterMuted(muted);
  }, [muted]);

  useEffect(
    () => () => {
      stopCustom();
      audioPlayer.stopAmbient();
    },
    [],
  );

  /* ---------- 派生场景状态 ---------- */
  const manifest = getSceneManifest(settings.sceneId);
  const hudTheme = timePhase === 'day' ? 'light' : 'dark';
  const focusing = Boolean(activeSession);

  // 18 张背景对应的内置背景音乐：切背景自动换（文件为空时静默）
  useBackgroundMusic(settings.sceneId, settings.weather, timePhase, bgmReloadKey);

  // 气泡跟随宠物：用宠物当前位置（viewport px）换算锚点，拖动时气泡跟着走；未拿到位置时退回场景预设锚点
  const bubbleAnchor = petRect
    ? {
        x: (petRect.x + petRect.width / 2) / window.innerWidth,
        y: Math.max(0, (petRect.y - 3) / window.innerHeight),
      }
    : manifest.anchors.speechBubble;

  const sceneControls: SceneControls = {
    settings,
    timePhase,
    setScene: (scene: SceneId) => setSettings((s) => ({ ...s, sceneId: scene })),
    setTimeMode: (mode: TimeMode) => setSettings((s) => ({ ...s, timeMode: mode })),
    setWeather: (weather: WeatherType) => setSettings((s) => ({ ...s, weather })),
    setBrightness: (value: number) => setSettings((s) => ({ ...s, brightness: value })),
    setEnvAnimation: (value: boolean) => setSettings((s) => ({ ...s, envAnimation: value })),
    setReducedMotion: (value: boolean) => setSettings((s) => ({ ...s, reducedMotion: value })),
    setShowPet: (value: boolean) => setSettings((s) => ({ ...s, showPet: value })),
    setPetAutoRest: (value: boolean) => setSettings((s) => ({ ...s, petAutoRest: value })),
    setPetQuietInFocus: (value: boolean) =>
      setSettings((s) => ({ ...s, petQuietInFocus: value })),
    setAmbientMode: (weather: WeatherType, mode: AmbientMode) => {
      setSettings((s) => ({
        ...s,
        ambientByWeather: {
          ...s.ambientByWeather,
          [weather]: { ...s.ambientByWeather[weather], mode },
        },
      }));
      // 模式与文件同库持久化，重启不丢、与自定义文件一致
      void useSettingsStore.getState().updateAmbientMode(weather, mode);
    },
    setAmbientFile: (weather: WeatherType, file?: string) =>
      useSettingsStore.getState().updateAmbientFile(weather, file),
  };

  const openPanel = (panel: PanelKey) => {
    // 「专注」进入全屏极简专注模式，不走底部副面板
    if (panel === 'focus') {
      useFocusOverlayStore.getState().openOverlay();
      return;
    }
    if (activePanelRef.current === panel) requestClose();
    else setActivePanel(panel);
  };

  /* ---------- 启动失败 / 加载中 ---------- */
  if (bootError) {
    return (
      <main role="alert" className="fs-boot-error">
        <h1>启动失败</h1>
        <p>{bootError}</p>
        <p>数据库初始化没有完成，为避免写入错乱，应用暂停在这里。</p>
      </main>
    );
  }

  if (!ready) {
    return (
      <main aria-busy="true" className="fs-boot-loading">
        正在准备本地数据…
      </main>
    );
  }

  return (
    <main
      className="fullscreen-cozy-home"
      data-hud={hudTheme}
      data-focus={focusing ? 'on' : 'off'}
      data-panel={activePanel ? 'on' : 'off'}
      data-env={settings.envAnimation}
      data-bgm={playingAmbient ?? 'off'}
      aria-label="心流小筑 全屏学习空间"
    >
      <SceneViewport
        sceneState={{
          sceneId: settings.sceneId,
          timePhase,
          weather: settings.weather,
          focusState: focusing ? 'active' : 'idle',
          sceneBrightness: settings.brightness,
          reducedMotion: settings.reducedMotion,
        }}
        petAction={petQueue.action}
        showPet={settings.showPet && companionEnabled}
        onPetInteract={handlePetInteract}
        onPetPositionChange={setPetRect}
        petGenerating={petGenerating}
      />

      <TopHud
        sceneName={manifest.name}
        sceneId={settings.sceneId}
        weather={settings.weather}
        timePhase={timePhase}
        timeMode={settings.timeMode}
        timeText={formatClock(now)}
        dateText={formatDateLong(now)}
        muted={muted}
        volume={volume}
        bgmOn={playingAmbient !== null || bgmPlaying}
        onVolumeChange={setVolume}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleBgm={toggleBackgroundMusic}
        onSceneChange={sceneControls.setScene}
        onWeatherChange={sceneControls.setWeather}
        onToggleDayNight={() => {
          // 白天 → 黄昏 → 夜晚 → 白天，循环切换
          const cycle: TimePhase[] = ['day', 'dusk', 'night'];
          const current = settings.timeMode === 'auto' ? timePhase : settings.timeMode;
          const next = cycle[(cycle.indexOf(current) + 1) % 3];
          sceneControls.setTimeMode(next);
        }}
      />

      <FocusHud onOpenFocus={() => openPanel('focus')} />

      <FeatureDock activePanel={activePanel} onOpen={openPanel} />

      <LofiHud
        sceneId={settings.sceneId}
        weather={settings.weather}
        customPlaying={playingAmbient === 'custom'}
        customTrackName={customTrackName || undefined}
        bgmPlaying={playingAmbient !== null || bgmPlaying}
        onToggleBgm={toggleBgm}
      />

      <SpeechBubble
        line={bubble}
        anchor={bubbleAnchor}
        onRespond={(text) => void handleRespond(text)}
        onDismiss={handleDismiss}
      />

      {/* 常驻挂载：面板关闭后本地状态保留 */}
      <DemoSheet panel={activePanel} onClose={requestClose} sceneControls={sceneControls} />

      {confirmPanel ? (
        <Modal
          dismissible={false}
          title="有未完成的内容"
          footer={
            <>
              <Button onClick={() => setConfirmPanel(null)} variant="ghost">
                取消
              </Button>
              <Button
                onClick={() => {
                  setActivePanel(null);
                  setConfirmPanel(null);
                }}
                variant="primary"
              >
                关闭
              </Button>
            </>
          }
          open
        >
          <p className="confirm-summary">
            当前面板还有未完成的内容。关闭后这些内容会保留，稍后可随时打开继续。确定关闭吗？
          </p>
        </Modal>
      ) : null}

      <ConfirmationModal />
      <SimpleConfirmModal />
      <ToastHost />

      {/* 全屏极简专注模式：覆盖全页 */}
      {focusOverlay ? (
        <FullscreenFocus
          onClose={() => useFocusOverlayStore.getState().closeOverlay()}
          volume={volume}
          muted={muted}
          onVolumeChange={setVolume}
          onToggleMute={() => setMuted((value) => !value)}
        />
      ) : null}
    </main>
  );
}

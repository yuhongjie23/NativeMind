/**
 * 窗口 API 封装（全屏切换）
 *
 * 桌面端沉浸式全屏：进入全屏时隐藏系统装饰（Windows 标题栏/边框），
 * 退出时恢复。web 演示环境无窗口概念，全部返回降级值。
 *
 * 优先走 Tauri 官方 JS API（getCurrentWindow），不依赖自定义 Rust 命令：
 * 这样即使后端命令未注册（如 tauri dev 未重启），前端也能完成切换，
 * 且失败会抛错而不是被静默吞掉。
 */
const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 当前窗口是否全屏（web 环境恒为 false） */
export const isWindowFullscreen = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return await getCurrentWindow().isFullscreen();
  } catch {
    return false;
  }
};

/** 切换全屏，返回切换后的状态（web 环境恒为 false） */
export const toggleFullscreen = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const isFs = await win.isFullscreen();
  const target = !isFs;
  // 先切装饰再切全屏：Windows 下若先全屏后去装饰会闪一下标题栏
  await win.setDecorations(!target);
  await win.setFullscreen(target);
  return target;
};

/**
 * 若当前处于 OS 全屏，则退出全屏并恢复窗口边框（沉浸式无边框的退出路径）。
 * Esc 退出全屏用：非全屏时是 no-op。返回是否执行了退出。
 */
export const exitFullscreenIfActive = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const isFs = await win.isFullscreen();
  if (!isFs) return false;
  await win.setFullscreen(false);
  await win.setDecorations(true);
  return true;
};

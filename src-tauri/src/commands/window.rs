//! 窗口命令
//!
//! 全屏切换：进入全屏时隐藏系统装饰（Windows 标题栏/边框），实现沉浸式
//! 无边框全屏；退出时恢复装饰。前端经 invoke 调用，配合 F11 快捷键与
//! 顶栏按钮使用。装饰切换只在本命令内做，普通窗口（非全屏）保持系统默认。

use tauri::WebviewWindow;

/// 返回当前是否处于给定状态（用于前端按钮态）
#[tauri::command]
pub async fn window_is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

/// 切换全屏。进入全屏 → 隐藏系统装饰（沉浸式无边框）；退出 → 恢复。
/// 返回切换后的全屏状态。
#[tauri::command]
pub async fn window_toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let is_fs = window.is_fullscreen().map_err(|e| e.to_string())?;
    let target = !is_fs;
    // 先切装饰再切全屏：Windows 下若先全屏后去装饰会闪一下标题栏
    window
        .set_decorations(!target)
        .map_err(|e| e.to_string())?;
    window.set_fullscreen(target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// 让窗口装饰始终跟随全屏状态（沉浸式无边框）：
/// 无论用户从哪个入口进入全屏（按钮 / F11 / 系统快捷键 / 未来其它入口），
/// 只要窗口处于全屏就隐藏标题栏，退出全屏恢复。作为 setup 里的兜底同步，
/// 不依赖前端调用顺序。用窗口事件驱动，仅在全屏状态与装饰不一致时才写。
pub fn sync_decorations_with_fullscreen(window: &WebviewWindow) {
    let w = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(_) = event {
            let w = w.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(is_fs) = w.is_fullscreen() {
                    // 幂等：tao 仅在 flag 真正变化时重排窗口样式，重复写同值无副作用
                    let _ = w.set_decorations(!is_fs);
                }
            });
        }
    });
}
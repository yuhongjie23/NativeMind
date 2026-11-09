use super::AppPaths;
use crate::learning_notifications::ScheduledReminder;
use crate::utils::CommandResult;
#[tauri::command]
pub async fn learning_notifications_sync(paths: tauri::State<'_, AppPaths>, reminders: Vec<ScheduledReminder>) -> CommandResult<serde_json::Value> {
    let root = paths.data_dir();
    tauri::async_runtime::spawn_blocking(move || crate::learning_notifications::sync(&root, &reminders)).await
        .map_err(|_| crate::utils::CommandError::new("系统提醒任务中断"))?
}

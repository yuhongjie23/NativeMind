use super::AppPaths;
#[tauri::command]
pub fn storage_check(paths: tauri::State<'_, AppPaths>) -> serde_json::Value {
    crate::startup_check::storage(&paths.data_dir())
}

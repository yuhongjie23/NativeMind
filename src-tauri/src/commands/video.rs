use super::AppPaths;
use crate::utils::{CommandError, CommandResult};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn video_import(paths: State<'_, AppPaths>, path: String) -> CommandResult<String> {
    let root = paths.data_dir();
    tauri::async_runtime::spawn_blocking(move || crate::local_media::import_video(&root, std::path::Path::new(&path)))
        .await.map_err(|error| CommandError::new(error.to_string()))?
}

#[tauri::command]
pub async fn video_read_chunk(paths: State<'_, AppPaths>, path: String, offset: u64) -> CommandResult<Value> {
    crate::local_media::read_chunk(&paths.data_dir(), &path, offset)
}

//! Desktop IPC wrapper; Anna uses the same HTTP implementation.
use crate::utils::CommandResult;
#[tauri::command]
pub async fn search_fetch(url: String) -> CommandResult<crate::search_http::SearchFetchResponse> {
    crate::search_http::search_fetch(url).await
}
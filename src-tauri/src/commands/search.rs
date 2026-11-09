//! Desktop IPC wrapper; Anna uses the same HTTP implementation.
use crate::utils::CommandResult;
#[tauri::command]
pub async fn search_fetch(url: String) -> CommandResult<crate::search_http::SearchFetchResponse> {
    if cfg!(feature = "anna-local") {
        return Err(crate::utils::CommandError::new("External search is disabled in the local-only edition"));
    }
    crate::search_http::search_fetch(url).await
}

#[cfg(all(test, feature = "anna-local"))]
mod tests {
    #[test]
    fn local_edition_refuses_external_search_before_http() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let error = runtime.block_on(super::search_fetch("https://example.invalid/private-query".into())).unwrap_err();
        assert!(error.to_string().contains("disabled"));
    }
}

//! Development-only Anna transport for the actual desktop Rust modules.
//! No second database/model/parser implementation and no access to the desktop user's DB.
#![allow(dead_code, unused_imports)]
mod archive;
#[path = "archive-paths.rs"]
mod archive_paths;
#[path = "restore-recovery.rs"]
mod restore_recovery;
mod audio;
#[path = "../../../src-tauri/src/local_media.rs"]
mod local_media;
#[path = "../../../src-tauri/src/startup_check.rs"]
mod startup_check;
#[path = "../../../src-tauri/src/learning_notifications.rs"]
mod learning_notifications;
mod commands;
#[path = "window-session.rs"]
mod window_session;
#[path = "file-jobs.rs"]
mod file_jobs;
#[path = "parser-worker.rs"]
mod parser_worker;
#[path = "file-transfer.rs"]
mod file_transfer;
#[path = "import-cleanup.rs"]
mod import_cleanup;
#[path = "runtime-lock.rs"]
mod runtime_lock;
#[path = "../../../src-tauri/src/db/mod.rs"]
mod db;
#[path = "../../../src-tauri/src/file_parser/mod.rs"]
mod file_parser;
#[path = "../../../src-tauri/src/model_client/mod.rs"]
mod model_client;
#[path = "model-jobs.rs"]
mod model_jobs;
mod protocol;
#[path = "runtime-paths.rs"]
mod runtime_paths;
#[path = "../../../src-tauri/src/search_http.rs"]
mod search_http;
#[path = "sql-policy.rs"]
mod sql_policy;
#[path = "../../../src-tauri/src/utils/mod.rs"]
mod utils;
#[path = "../../../src-tauri/src/vector/mod.rs"]
mod vector;

use std::io::{self, BufRead, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    // Do not accidentally distribute a raw native-command bridge to cloud/agent callers.
    if !args.iter().any(|arg| arg == "--local-dev") {
        return Err("This bridge is local-development only; production app authentication is not implemented".into());
    }
    let root = runtime_paths::data_root(std::env::var_os("NATIVEMIND_ANNA_DATA_DIR"))?;
    if args.iter().any(|arg| arg == "--file-worker") {
        if args.len() != 5 || args[1] != "--local-dev" || args[2] != "--file-worker" {
            return Err("Invalid parser worker arguments".into());
        }
        return parser_worker::run(&root, &args[3].to_string_lossy(), std::path::Path::new(&args[4]))
            .map_err(Into::into);
    }
    let mut backend = commands::Backend::new(root)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let (sender, mut receiver) = tokio::sync::mpsc::channel::<String>(64);
    std::thread::spawn(move || {
        for frame in io::stdin().lock().lines() {
            match frame {
                Ok(frame) => {
                    if sender.blocking_send(frame).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    runtime.block_on(async {
        let mut output = io::stdout().lock();
        loop {
            backend.reap_jobs();
            let frame = match tokio::time::timeout(
                std::time::Duration::from_secs(1),
                receiver.recv(),
            )
            .await
            {
                Ok(Some(frame)) => frame,
                Ok(None) => break,
                Err(_) => continue,
            };
            if frame.trim().is_empty() {
                continue;
            }
            if let Some(response) = protocol::respond(&mut backend, &frame).await {
                serde_json::to_writer(&mut output, &response)?;
                writeln!(output)?;
                output.flush()?;
            }
        }
        Ok(())
    })
}

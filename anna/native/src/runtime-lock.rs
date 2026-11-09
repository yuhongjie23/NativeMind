//! OS-backed SQLite locking: released even if a local process crashes.
use crate::utils::{CommandError, CommandResult};
use std::path::Path;

pub fn acquire(root: &Path) -> CommandResult<rusqlite::Connection> {
    std::fs::create_dir_all(root)?;
    let path = root.join(".anna-runtime-lock.sqlite");
    if std::fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err(CommandError::new(
            "Anna runtime lock must be a regular file",
        ));
    }
    let connection = rusqlite::Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::ZERO)?;
    connection
        .execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
        .map_err(|error| {
            CommandError::new(format!(
                "无法独占 Anna 数据目录；请先关闭使用此目录的其他本地进程：{error}"
            ))
        })?;
    Ok(connection)
}

//! Durable restore outcome and commit receipt. The receipt travels with the replaced DB.
use crate::utils::{CommandError, CommandResult};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

pub fn token() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M%S-%f").to_string()
}

pub fn read(path: &Path) -> CommandResult<Value> {
    crate::archive_paths::regular(path, false)?;
    if fs::metadata(path)?.len() > 65536 {
        return Err(CommandError::new("恢复记录过大"));
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub fn write(root: &Path, name: &str, value: &Value) -> CommandResult<()> {
    let destination = root.join(name);
    if destination.try_exists()? {
        crate::archive_paths::regular(&destination, false)?;
    }
    let temporary = root.join(format!("{name}-{}.tmp", token()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, destination)?;
    Ok(())
}

pub fn stamp(db: &Path, token: &str) -> CommandResult<()> {
    let mut connection = Connection::open(db)?;
    let tx = connection.transaction()?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS anna_restore_receipt (token TEXT NOT NULL); DELETE FROM anna_restore_receipt;")?;
    tx.execute(
        "INSERT INTO anna_restore_receipt(token) VALUES (?)",
        [token],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn committed(root: &Path, token: &str) -> CommandResult<bool> {
    let path = root.join("nativemind.db");
    if !path.try_exists()? {
        return Ok(false);
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let table: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='anna_restore_receipt')", [], |r| r.get(0))?;
    if !table {
        return Ok(false);
    }
    Ok(connection
        .query_row("SELECT token FROM anna_restore_receipt LIMIT 1", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()?
        .as_deref()
        == Some(token))
}

/// Close/checkpoint the old database instead of deleting potentially committed WAL data.
pub fn checkpoint(root: &Path) -> CommandResult<()> {
    let path = root.join("nativemind.db");
    if !path.try_exists()? {
        return Ok(());
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.busy_timeout(std::time::Duration::ZERO)?;
    let busy: i64 = connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
    if busy != 0 {
        return Err(CommandError::new("数据库仍被其他进程使用，未执行恢复"));
    }
    connection
        .close()
        .map_err(|(_, error)| CommandError::from(error))?;
    // An external connection may retain sidecars. Fail closed; never unlink its WAL.
    for name in [
        "nativemind.db-wal",
        "nativemind.db-shm",
        "nativemind.db-journal",
    ] {
        if root.join(name).try_exists()? {
            return Err(CommandError::new("数据库日志仍在使用，未执行恢复"));
        }
    }
    Ok(())
}

pub fn finish(
    root: &Path,
    request: &Value,
    state: &str,
    error: Option<String>,
) -> CommandResult<()> {
    let report = json!({"state":state,"token":request["token"],"backupId":request["id"],
        "safety":request["safety"],"finishedAt":chrono::Utc::now().to_rfc3339(),"error":error});
    write(root, "restore-result.json", &report)?;
    // Keep the original request for diagnosis, but remove it from the blocking location.
    fs::rename(
        root.join("restore-request.json"),
        root.join(format!("restore-resolved-{}.json", token())),
    )?;
    Ok(())
}

pub fn status(root: &Path) -> CommandResult<Value> {
    if root.join("restore-request.json").try_exists()? {
        let request = read(&root.join("restore-request.json"))?;
        return Ok(json!({"state":"pending","backupId":request["id"],"safety":request["safety"]}));
    }
    let path = root.join("restore-result.json");
    if path.try_exists()? {
        read(&path)
    } else {
        Ok(json!({"state":"idle"}))
    }
}

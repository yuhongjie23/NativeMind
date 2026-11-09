//! Local development backups. Only app-owned, complete snapshots can be restored.
use crate::archive_paths::{regular, Paths};
use crate::utils::{CommandError, CommandResult};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn snapshot(root: &Path, id: &str) -> CommandResult<PathBuf> {
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit() || c == b'-') {
        return Err(CommandError::new("Invalid backup identifier"));
    }
    crate::utils::ensure_within(&root.join("exports"), &root.join("exports").join(id))
}

fn copy_files(source: &Path, target: &Path) -> CommandResult<()> {
    std::fs::create_dir_all(target)?;
    if !source.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        // No symlinks, recursive directories or incomplete .pending transfers.
        if entry.file_type()?.is_file() {
            std::fs::copy(entry.path(), target.join(entry.file_name()))?;
        }
    }
    Ok(())
}

pub async fn export(root: &Path, db: &Path) -> CommandResult<Value> {
    let id = chrono::Utc::now().format("%Y%m%d-%H%M%S-%f").to_string();
    let out = root.join("exports").join(&id);
    std::fs::create_dir_all(&out)?;
    let backup = crate::db::backup::create_snapshot(db.to_path_buf(), out.join("snapshot")).await?;
    std::fs::rename(backup, out.join("nativemind.db"))?;
    copy_files(&root.join("imports"), &out.join("imports"))?;
    copy_files(&root.join("music"), &out.join("music"))?;
    // Written last: incomplete exports are never offered for restore.
    std::fs::write(
        out.join("complete.json"),
        serde_json::to_vec(
            &json!({"schema":2,"id":id,"sourceRoot":crate::utils::display_path(root)}),
        )?,
    )?;
    Ok(json!({"id":id,"path":crate::utils::display_path(&out)}))
}

pub fn list(root: &Path) -> CommandResult<Value> {
    let mut items = Vec::new();
    let exports = root.join("exports");
    if !exports.exists() {
        return Ok(json!(items));
    }
    for entry in std::fs::read_dir(exports)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if snapshot(root, &id).is_ok() && entry.path().join("complete.json").is_file() {
            items.push(json!({"id":id,"path":crate::utils::display_path(&entry.path())}));
        }
    }
    items.sort_by(|a, b| b["id"].as_str().cmp(&a["id"].as_str()));
    Ok(json!(items))
}

fn validate(root: &Path, id: &str) -> CommandResult<PathBuf> {
    let source = snapshot(root, id)?;
    let marker = validate_directory(&source, Some(id))?;
    let fallback = crate::utils::display_path(root);
    Paths::validate_references(&source, marker["sourceRoot"].as_str().unwrap_or(&fallback))?;
    Ok(source)
}

fn validate_directory(source: &Path, id: Option<&str>) -> CommandResult<Value> {
    regular(source, true)?;
    regular(&source.join("complete.json"), false)?;
    if std::fs::metadata(source.join("complete.json"))?.len() > 65536 {
        return Err(CommandError::new("备份清单过大"));
    }
    let marker: Value = serde_json::from_slice(&std::fs::read(source.join("complete.json"))?)?;
    if !matches!(marker["schema"].as_u64(), Some(1 | 2))
        || !marker["id"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit() || c == b'-'))
        || id.is_some_and(|id| marker["id"] != id)
        || (marker["schema"] == 2
            && !marker["sourceRoot"]
                .as_str()
                .is_some_and(|s| Path::new(s).is_absolute()))
    {
        return Err(CommandError::new("Invalid backup manifest"));
    }
    for kind in ["imports", "music"] {
        regular(&source.join(kind), true)?;
        for entry in std::fs::read_dir(source.join(kind))? {
            regular(&entry?.path(), false)?;
        }
    }
    regular(&source.join("nativemind.db"), false)?;
    // A complete export is a closed snapshot, never a live WAL database.
    for name in [
        "nativemind.db-wal",
        "nativemind.db-shm",
        "nativemind.db-journal",
    ] {
        if source.join(name).try_exists()? {
            return Err(CommandError::new(
                "请选择完整导出的备份目录，而非运行中的数据库目录",
            ));
        }
    }
    let conn = rusqlite::Connection::open_with_flags(
        source.join("nativemind.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if check != "ok" {
        return Err(CommandError::new("备份数据库校验失败"));
    }
    let _: i64 = conn.query_row("SELECT count(*) FROM schema_migrations", [], |row| {
        row.get(0)
    })?;
    Ok(marker)
}

/// Local filesystem copy only. Import does not replace the current database.
pub fn import(root: &Path, path: &str) -> CommandResult<Value> {
    let source = Path::new(path);
    if !source.is_absolute() {
        return Err(CommandError::new("请输入本地备份目录的完整路径"));
    }
    let mut marker = validate_directory(source, None)?;
    if marker["schema"] != 2 {
        return Err(CommandError::new(
            "旧版备份仅支持原目录恢复，请用新版重新生成完整备份后搬迁",
        ));
    }
    Paths::validate_references(source, marker["sourceRoot"].as_str().unwrap())?;
    let id = chrono::Utc::now().format("%Y%m%d-%H%M%S-%f").to_string();
    let out = root.join("exports").join(&id);
    std::fs::create_dir_all(out.parent().unwrap())?;
    std::fs::create_dir(&out)?;
    std::fs::copy(source.join("nativemind.db"), out.join("nativemind.db"))?;
    copy_files(&source.join("imports"), &out.join("imports"))?;
    copy_files(&source.join("music"), &out.join("music"))?;
    marker["id"] = json!(id);
    std::fs::write(out.join("complete.json"), serde_json::to_vec(&marker)?)?;
    if let Err(error) = validate(root, &id) {
        let _ = std::fs::remove_file(out.join("complete.json"));
        return Err(error);
    }
    Ok(json!({"id":id,"path":crate::utils::display_path(&out)}))
}

pub async fn schedule_restore(root: &Path, db: &Path, id: &str) -> CommandResult<Value> {
    validate(root, id)?;
    let safety = export(root, db).await?;
    crate::restore_recovery::write(
        root,
        "restore-request.json",
        &json!({"id":id,"safety":safety,"token":crate::restore_recovery::token()}),
    )?;
    Ok(json!({"restartRequired":true,"safety":safety}))
}

/// Run before opening the live DB. A pending request blocks UI writes until restart.
pub fn apply_pending(root: &Path) -> CommandResult<()> {
    use crate::restore_recovery as recovery;
    let request = root.join("restore-request.json");
    if !request.exists() {
        return Ok(());
    }
    let mut value = match recovery::read(&request) {
        Ok(value) => value,
        Err(error) => return recovery::finish(root, &json!({}), "failed", Some(error.to_string())),
    };
    // Upgrade requests from earlier builds before touching any assets or database.
    if !value["token"]
        .as_str()
        .is_some_and(|token| !token.is_empty())
    {
        if !value.is_object() {
            return recovery::finish(root, &json!({}), "failed", Some("恢复请求无效".into()));
        }
        value["token"] = json!(recovery::token());
        recovery::write(root, "restore-request.json", &value)?;
    }
    let token = value["token"].as_str().unwrap();
    if recovery::committed(root, token)? {
        return recovery::finish(root, &value, "restored", None);
    }
    // A crash after saving a failure report must not silently retry the failed restore.
    if let Ok(report) = recovery::read(&root.join("restore-result.json")) {
        if report["token"] == token && report["state"] == "failed" {
            return recovery::finish(
                root,
                &value,
                "failed",
                report["error"].as_str().map(str::to_owned),
            );
        }
    }
    match replace_database(root, &value, token) {
        Ok(()) => recovery::finish(root, &value, "restored", None),
        Err(error) => recovery::finish(root, &value, "failed", Some(error.to_string())),
    }
}

/// No fallible operation follows the rename: success means the new DB is committed.
fn replace_database(root: &Path, value: &Value, token: &str) -> CommandResult<()> {
    let id = value["id"]
        .as_str()
        .ok_or_else(|| CommandError::new("Invalid restore request"))?;
    let source = validate(root, id)?;
    let marker = validate_directory(&source, Some(id))?;
    let fallback = crate::utils::display_path(root);
    let paths = Paths::prepare(
        &source,
        marker["sourceRoot"].as_str().unwrap_or(&fallback),
        root,
    )?;
    // A crashed rewrite may leave a rollback journal. Never reuse its DB filename.
    let staged = root.join(format!(
        "nativemind-{}.restore",
        chrono::Utc::now().format("%Y%m%d-%H%M%S-%f")
    ));
    std::fs::copy(source.join("nativemind.db"), &staged)?;
    paths.rewrite(&staged)?;
    crate::restore_recovery::stamp(&staged, token)?;
    std::fs::OpenOptions::new()
        .write(true)
        .open(&staged)?
        .sync_all()?;
    crate::restore_recovery::checkpoint(root)?;
    std::fs::rename(staged, root.join("nativemind.db"))?;
    Ok(())
}

#[cfg(test)]
#[path = "archive-tests.rs"]
mod tests;

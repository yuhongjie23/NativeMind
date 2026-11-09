use crate::utils::{CommandError, CommandResult};
use serde_json::{json, Value};
use std::path::Path;

fn string<'a>(args: &'a Value, key: &str) -> CommandResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new(format!("Missing {key}")))
}

pub(crate) fn identity(payload: &Value) -> CommandResult<(&str, &str, &str)> {
    let name = string(payload, "name")?;
    if name.is_empty()
        || name.len() > 180
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(' ')
    {
        return Err(CommandError::new("Invalid import name"));
    }
    let extension = name.rsplit('.').next().unwrap_or("");
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("document");
    let directory = match kind {
        "document" | "background" => "imports",
        "audio" => "music",
        _ => return Err(CommandError::new("Invalid import kind")),
    };
    let supported = if kind == "audio" {
        crate::audio::is_audio(std::path::Path::new(name))
    } else if kind == "background" {
        crate::local_media::is_video(Path::new(name))
    } else {
        [
            "txt", "text", "md", "markdown", "pdf", "epub", "mobi", "azw3",
        ]
        .contains(&extension)
    };
    if !supported {
        return Err(CommandError::new("Unsupported file format"));
    }
    Ok((name, kind, directory))
}

pub fn stage(root: &Path, payload: &Value) -> CommandResult<Value> {
    use std::io::Write;
    let (name, kind, directory) = identity(payload)?;
    let bytes: Vec<u8> = serde_json::from_value(
        payload
            .get("bytes")
            .cloned()
            .ok_or_else(|| CommandError::new("Missing bytes"))?,
    )?;
    let offset = payload
        .get("offset")
        .and_then(Value::as_u64)
        .ok_or_else(|| CommandError::new("Missing offset"))?;
    let max_size = if kind == "background" { crate::local_media::MAX_VIDEO_BYTES } else { 32 * 1024 * 1024 };
    if bytes.len() > 64 * 1024
        || offset > max_size
        || offset + bytes.len() as u64 > max_size
    {
        return Err(CommandError::new(
            "Import exceeds size limit or chunk exceeds 64 KiB",
        ));
    }
    let base = root.join(directory);
    let pending = base.join(".pending");
    ensure_directory(&base)?;
    ensure_directory(&pending)?;
    let path = base.join(name);
    if path.exists() {
        return Err(CommandError::new("Import already exists"));
    }
    let partial = pending.join(name);
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    if offset == 0 {
        options.create_new(true);
    } else {
        options.append(true);
    }
    if offset > 0 {
        ensure_file(&partial)?;
    }
    let mut file = options.open(&partial)?;
    if file.metadata()?.len() != offset {
        return Err(CommandError::new("Import offset mismatch"));
    }
    file.write_all(&bytes)?;
    if payload
        .get("complete")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        if (kind == "audio" || kind == "background") && file.metadata()?.len() == 0 {
            return Err(CommandError::new("音频文件为空"));
        }
        drop(file);
        if kind == "document" {
            crate::import_cleanup::record(root, name, &partial)?;
        }
        std::fs::rename(partial, &path)?;
    }
    Ok(json!(crate::utils::display_path(&path)))
}

fn ensure_directory(path: &Path) -> CommandResult<()> {
    std::fs::create_dir_all(path)?;
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CommandError::new(
            "Import directory must be a real directory",
        ));
    }
    Ok(())
}

fn ensure_file(path: &Path) -> CommandResult<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CommandError::new("Import must be a regular file"));
    }
    Ok(())
}

pub fn commit(root: &Path, payload: &Value) -> CommandResult<Value> {
    let (name, kind, directory) = identity(payload)?;
    let base = root.join(directory);
    ensure_directory(&base)?;
    let pending = base.join(".pending");
    ensure_directory(&pending)?;
    let partial = pending.join(name);
    ensure_file(&partial)?;
    let size = payload
        .get("size")
        .and_then(Value::as_u64)
        .ok_or_else(|| CommandError::new("Missing size"))?;
    let max_size = if kind == "background" { crate::local_media::MAX_VIDEO_BYTES } else { 32 * 1024 * 1024 };
    if size > max_size
        || ((kind == "audio" || kind == "background") && size == 0)
        || std::fs::metadata(&partial)?.len() != size
    {
        return Err(CommandError::new("Import size mismatch"));
    }
    let path = base.join(name);
    if path.exists() {
        return Err(CommandError::new("Import already exists"));
    }
    if kind == "document" {
        crate::import_cleanup::record(root, name, &partial)?;
    }
    std::fs::rename(partial, &path)?;
    Ok(json!(crate::utils::display_path(&path)))
}

/// Idempotent: cancellation can only remove an incomplete transfer, never a saved file.
pub fn abort(root: &Path, payload: &Value) -> CommandResult<Value> {
    let (name, _, directory) = identity(payload)?;
    let base = root.join(directory);
    ensure_directory(&base)?;
    let pending = base.join(".pending");
    ensure_directory(&pending)?;
    let partial = pending.join(name);
    match std::fs::symlink_metadata(&partial) {
        Ok(_) => {
            ensure_file(&partial)?;
            std::fs::remove_file(partial)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(Value::Null)
}

/// Reclaim abandoned transfers after a day; never follow directories or symlinks.
pub fn cleanup_stale(root: &Path) -> CommandResult<()> {
    for directory in ["imports", "music"] {
        let base = root.join(directory);
        ensure_directory(&base)?;
        let pending = base.join(".pending");
        ensure_directory(&pending)?;
        for entry in std::fs::read_dir(pending)? {
            let entry = entry?;
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                continue;
            }
            if metadata
                .modified()
                .ok()
                .and_then(|time| time.elapsed().ok())
                .is_some_and(|age| age.as_secs() >= 86400)
            {
                // A locked abandoned file must not prevent opening the user's database.
                if let Err(error) = std::fs::remove_file(entry.path()) {
                    eprintln!("Could not clean an expired import transfer: {error}");
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod video_tests {
    use super::*;
    #[test]
    fn background_transfer_has_its_own_limit_and_cannot_abort_a_committed_file() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("nativemind-video-stage-{stamp}"));
        let args = json!({"name":"clip.webm", "kind":"background", "offset":0,"bytes":[1],"complete":false});
        stage(&root, &args).unwrap();
        let partial = root.join("imports/.pending/clip.webm");
        let size = 33 * 1024 * 1024;
        std::fs::OpenOptions::new().write(true).open(&partial).unwrap().set_len(size).unwrap();
        commit(&root, &json!({"name":"clip.webm","kind":"background","size":size})).unwrap();
        abort(&root, &args).unwrap();
        assert!(root.join("imports/clip.webm").exists());
        assert!(identity(&json!({"name":"clip.webm","kind":"document"})).is_err());
        assert!(identity(&json!({"name":"../clip.webm","kind":"background"})).is_err());
        assert!(stage(&root, &json!({"name":"big.mp4","kind":"background","offset":crate::local_media::MAX_VIDEO_BYTES,"bytes":[1]})).is_err());
        assert!(stage(&root, &json!({"name":"empty.mp4","kind":"background","offset":0,"bytes":[]})).is_err());
        abort(&root, &json!({"name":"empty.mp4","kind":"background"})).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

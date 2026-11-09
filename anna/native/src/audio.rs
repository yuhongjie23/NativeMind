use crate::utils::{display_path, ensure_within, CommandError, CommandResult};
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| {
            ["mp3", "flac", "wav", "ogg", "m4a"].contains(&ext.to_lowercase().as_str())
        })
}

pub fn list(root: &Path) -> CommandResult<Value> {
    let mut tracks = Vec::new();
    for entry in std::fs::read_dir(root.join("music"))? {
        let entry = entry?;
        let path = entry.path();
        if !entry.file_type()?.is_file() || !is_audio(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let label = name
            .split_once('_')
            .map(|(_, label)| label)
            .unwrap_or(&name);
        tracks.push(
            json!({"path":display_path(&path), "name":label, "sizeBytes":entry.metadata()?.len()}),
        );
    }
    tracks.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(json!(tracks))
}

pub fn read_chunk(root: &Path, payload: &Value) -> CommandResult<Value> {
    let path = payload["path"]
        .as_str()
        .ok_or_else(|| CommandError::new("Missing path"))?;
    let safe = ensure_within(&root.join("music"), Path::new(path))?;
    // Incomplete transfers live in .pending and must never be playable.
    if safe.parent() != Some(root.join("music").canonicalize()?.as_path()) || !is_audio(&safe) {
        return Err(CommandError::new("只允许读取已导入的音频文件"));
    }
    let offset = payload["offset"]
        .as_u64()
        .ok_or_else(|| CommandError::new("Missing offset"))?;
    let mut file = std::fs::File::open(safe)?;
    let size = file.metadata()?.len();
    if size == 0 || size > 32 * 1024 * 1024 || offset >= size {
        return Err(CommandError::new("音频为空、超过 32 MB 或读取位置无效"));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = vec![0; (size - offset).min(128 * 1024) as usize];
    file.read_exact(&mut bytes)?;
    Ok(json!({"bytes":bytes, "size":size}))
}

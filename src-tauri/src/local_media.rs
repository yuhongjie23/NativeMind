//! Bounded local background videos. Both desktop and Anna use this reader.
use crate::utils::{ensure_within, display_path, CommandError, CommandResult};
use serde_json::{json, Value};
use std::{io::{Read, Seek, SeekFrom, Write}, path::Path};

pub const MAX_VIDEO_BYTES: u64 = 128 * 1024 * 1024;

pub fn is_video(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str())
        .is_some_and(|ext| ["mp4", "webm"].contains(&ext.to_lowercase().as_str()))
}

pub fn read_chunk(root: &Path, path: &str, offset: u64) -> CommandResult<Value> {
    let base = root.join("imports").canonicalize()?;
    let safe = ensure_within(&base, Path::new(path))?;
    if safe.parent() != Some(base.as_path()) || !is_video(&safe) {
        return Err(CommandError::new("只允许读取已导入的 MP4/WebM 背景"));
    }
    let mut file = std::fs::File::open(&safe)?;
    let size = file.metadata()?.len();
    if size == 0 || size > MAX_VIDEO_BYTES || offset >= size {
        return Err(CommandError::new("视频为空、超过 128 MB 或读取位置无效"));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = vec![0; (size - offset).min(128 * 1024) as usize];
    file.read_exact(&mut bytes)?;
    Ok(json!({"bytes": bytes, "size": size}))
}

pub fn import_video(root: &Path, source: &Path) -> CommandResult<String> {
    let metadata = std::fs::metadata(source)?;
    if !metadata.is_file() || !is_video(source) || metadata.len() == 0 || metadata.len() > MAX_VIDEO_BYTES {
        return Err(CommandError::new("请选择 128 MB 以内的 MP4/WebM 视频"));
    }
    let base = root.join("imports");
    let pending = base.join(".pending");
    for dir in [&base, &pending] {
        std::fs::create_dir_all(dir)?;
        if std::fs::symlink_metadata(dir)?.file_type().is_symlink() {
            return Err(CommandError::new("视频导入目录不能是链接"));
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let name = format!("{}-{stamp}_background.{}", std::process::id(), source.extension().unwrap().to_string_lossy().to_lowercase());
    let temporary = pending.join(&name);
    let target = base.join(&name);
    let result = (|| -> CommandResult<String> {
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        let size = std::io::copy(&mut std::fs::File::open(source)?.take(MAX_VIDEO_BYTES + 1), &mut output)?;
        if size != metadata.len() || size > MAX_VIDEO_BYTES { return Err(CommandError::new("视频在复制期间发生变化")); }
        output.flush()?;
        drop(output);
        std::fs::rename(&temporary, &target)?;
        Ok(display_path(&target))
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_unique_files_and_bounds_reads_to_committed_videos() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("nativemind-video-test-{stamp}"));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("test.MP4");
        std::fs::write(&source, vec![7u8; 128 * 1024 + 1]).unwrap();
        let first = import_video(&root, &source).unwrap();
        let second = import_video(&root, &source).unwrap();
        assert_ne!(first, second);
        assert_eq!(read_chunk(&root, &first, 0).unwrap()["bytes"].as_array().unwrap().len(), 128 * 1024);
        assert_eq!(read_chunk(&root, &first, 128 * 1024).unwrap()["bytes"], json!([7]));
        assert!(read_chunk(&root, &first, 128 * 1024 + 1).is_err());
        assert!(read_chunk(&root, &display_path(&source), 0).is_err());
        let partial = root.join("imports/.pending/test.mp4");
        std::fs::write(&partial, [1]).unwrap();
        assert!(read_chunk(&root, &display_path(&partial), 0).is_err());
        std::fs::write(&source, []).unwrap();
        assert!(import_video(&root, &source).is_err());
        std::fs::File::create(&source).unwrap().set_len(MAX_VIDEO_BYTES + 1).unwrap();
        assert!(import_video(&root, &source).is_err());
        assert_eq!(std::fs::read_dir(root.join("imports")).unwrap().count(), 3);
        std::fs::remove_dir_all(root).unwrap();
    }
}

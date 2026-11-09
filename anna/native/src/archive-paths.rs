//! Restore only known path fields; never rewrite note text or user content.
use crate::utils::{display_path, CommandError, CommandResult};
use rusqlite::Connection;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub fn regular(path: &Path, directory: bool) -> CommandResult<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink()
        || (if directory {
            !meta.is_dir()
        } else {
            !meta.is_file()
        })
    {
        return Err(CommandError::new("备份中包含链接或不支持的文件类型"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_background_video_settings_and_rejects_missing_videos() {
        let stamp = chrono::Utc::now().timestamp_nanos_opt().unwrap();
        let root = std::env::temp_dir().join(format!("nativemind-video-restore-{stamp}"));
        let source = root.join("backup");
        let destination = root.join("restored");
        for kind in ["imports", "music"] { std::fs::create_dir_all(source.join(kind)).unwrap(); }
        std::fs::write(source.join("imports/clip.mp4"), [1, 2]).unwrap();
        let db = source.join("nativemind.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE notes(id TEXT, source_uri TEXT); CREATE TABLE settings(key TEXT, value TEXT);").unwrap();
        conn.execute("INSERT INTO settings VALUES ('background.videos', ?)", [r#"{"library:night":"C:/old/imports/clip.mp4"}"#]).unwrap();
        drop(conn);
        Paths::validate_references(&source, "C:/old").unwrap();
        let paths = Paths::prepare(&source, "C:/old", &destination).unwrap();
        paths.rewrite(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let value: String = conn.query_row("SELECT value FROM settings WHERE key='background.videos'", [], |row| row.get(0)).unwrap();
        let mapping: HashMap<String, String> = serde_json::from_str(&value).unwrap();
        assert_eq!(mapping["library:night"], display_path(&destination.join("imports").join("clip.mp4")));
        conn.execute("UPDATE settings SET value=?", [r#"{"library:night":"C:/old/imports/missing.mp4"}"#]).unwrap();
        drop(conn);
        assert!(Paths::validate_references(&source, "C:/old").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn windows_slashes_case_and_extended_prefix_are_equivalent() {
        assert_eq!(
            normalized(r"\\?\C:\Data\Music\Track.wav"),
            normalized("c:/data/music/track.wav")
        );
        assert_ne!(normalized("/Data/Track.wav"), normalized("/data/track.wav"));
    }
}

fn normalized(value: &str) -> String {
    let value = value
        .strip_prefix(r"\\?\")
        .unwrap_or(value)
        .replace('\\', "/");
    let value = value.trim_end_matches('/');
    if value.as_bytes().get(1) == Some(&b':') || value.starts_with("//") {
        value.to_lowercase()
    } else {
        value.to_owned()
    }
}

fn equal_files(a: &Path, b: &Path) -> CommandResult<bool> {
    regular(b, false)?;
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let mut a = std::fs::File::open(a)?;
    let mut b = std::fs::File::open(b)?;
    let mut left = [0; 65536];
    let mut right = [0; 65536];
    loop {
        let count = a.read(&mut left)?;
        if count == 0 {
            return Ok(true);
        }
        b.read_exact(&mut right[..count])?;
        if left[..count] != right[..count] {
            return Ok(false);
        }
    }
}

pub struct Paths {
    files: HashMap<String, String>,
    prefixes: Vec<String>,
}

impl Paths {
    pub fn validate_references(source: &Path, old_root: &str) -> CommandResult<()> {
        let mut paths = Self {
            files: HashMap::new(),
            prefixes: Vec::new(),
        };
        for kind in ["imports", "music"] {
            let prefix = format!("{}/{kind}/", normalized(old_root));
            for entry in std::fs::read_dir(source.join(kind))? {
                let entry = entry?;
                let path = format!("{prefix}{}", entry.file_name().to_string_lossy());
                if paths.files.insert(normalized(&path), path).is_some() {
                    return Err(CommandError::new("备份中存在重复文件路径"));
                }
            }
            paths.prefixes.push(prefix);
        }
        let conn = Connection::open_with_flags(
            source.join("nativemind.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let notes = conn
            .prepare("SELECT source_uri FROM notes WHERE source_uri IS NOT NULL")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for path in notes {
            paths.remap(&path)?;
        }
        let settings = conn.prepare("SELECT key, value FROM settings WHERE key IN ('focus.musicFile', 'ambient.filesByWeather', 'background.videos')")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (key, value) in settings {
            if key == "focus.musicFile" {
                paths.remap(&value)?;
            } else {
                let files: HashMap<String, String> = serde_json::from_str(&value)?;
                for path in files.values() {
                    paths.remap(path)?;
                }
            }
        }
        Ok(())
    }

    pub fn prepare(source: &Path, old_root: &str, root: &Path) -> CommandResult<Self> {
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%f").to_string();
        let mut paths = Self {
            files: HashMap::new(),
            prefixes: Vec::new(),
        };
        for kind in ["imports", "music"] {
            let old_dir = format!("{}/{kind}", normalized(old_root));
            paths.prefixes.push(format!("{old_dir}/"));
            let target_dir = root.join(kind);
            std::fs::create_dir_all(&target_dir)?;
            regular(&target_dir, true)?;
            for (index, entry) in std::fs::read_dir(source.join(kind))?.enumerate() {
                let entry = entry?;
                regular(&entry.path(), false)?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| CommandError::new("备份文件名无效"))?;
                let mut target = target_dir.join(&name);
                if target.try_exists()? && !equal_files(&entry.path(), &target)? {
                    // Retain existing bytes until the replacement DB is committed.
                    let label = name
                        .split_once('_')
                        .map(|(_, label)| label)
                        .unwrap_or(&name);
                    target = target_dir.join(format!("{stamp}-{index}_{label}"));
                }
                if !target.try_exists()? {
                    let mut output = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&target)?;
                    std::io::copy(&mut std::fs::File::open(entry.path())?, &mut output)?;
                    output.flush()?;
                    output.sync_all()?;
                } else if !equal_files(&entry.path(), &target)? {
                    return Err(CommandError::new("恢复文件名冲突，请重新启动后重试"));
                }
                let key = normalized(&format!("{old_dir}/{name}"));
                if paths.files.insert(key, display_path(&target)).is_some() {
                    return Err(CommandError::new("备份中存在重复文件路径"));
                }
            }
        }
        Ok(paths)
    }

    fn remap(&self, value: &str) -> CommandResult<String> {
        let key = normalized(value);
        if let Some(target) = self.files.get(&key) {
            return Ok(target.clone());
        }
        if self.prefixes.iter().any(|prefix| key.starts_with(prefix)) {
            return Err(CommandError::new(format!("备份缺少引用文件：{value}")));
        }
        // Web sources and pasted notes are not local asset paths.
        Ok(value.to_owned())
    }

    pub fn rewrite(&self, db: &Path) -> CommandResult<()> {
        let mut conn = Connection::open(db)?;
        let tx = conn.transaction()?;
        let notes = tx
            .prepare("SELECT id, source_uri FROM notes WHERE source_uri IS NOT NULL")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, path) in notes {
            let mapped = self.remap(&path)?;
            if mapped != path {
                tx.execute(
                    "UPDATE notes SET source_uri = ? WHERE id = ?",
                    [&mapped, &id],
                )?;
            }
        }
        let settings = tx.prepare("SELECT key, value FROM settings WHERE key IN ('focus.musicFile', 'ambient.filesByWeather', 'background.videos')")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (key, value) in settings {
            let mapped = if key == "focus.musicFile" {
                self.remap(&value)?
            } else {
                let mut files: HashMap<String, String> = serde_json::from_str(&value)?;
                for path in files.values_mut() {
                    *path = self.remap(path)?;
                }
                serde_json::to_string(&files)?
            };
            tx.execute(
                "UPDATE settings SET value = ? WHERE key = ?",
                [&mapped, &key],
            )?;
        }
        // The runtime supplies these directories; old machine permissions must not migrate.
        tx.execute("DELETE FROM settings WHERE key IN ('paths.dataDir','paths.resourceDir','paths.musicDir','paths.readDirs')", [])?;
        tx.commit()?;
        Ok(())
    }
}

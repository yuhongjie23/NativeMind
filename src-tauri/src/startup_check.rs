//! Check the active data directory without touching user files or the database.
use serde_json::{json, Value};
use std::{io::Write, path::Path, sync::atomic::{AtomicU64, Ordering}};

static NEXT: AtomicU64 = AtomicU64::new(0);

pub fn storage(root: &Path) -> Value {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let probe = root.join(format!(".nativemind-check-{}-{stamp}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)?;
        let written = file.write_all(b"NativeMind storage check").and_then(|_| file.sync_all());
        drop(file);
        let removed = std::fs::remove_file(&probe);
        written.and(removed)
    })();
    match result {
        Ok(()) => json!({"path":crate::utils::display_path(root),"writable":true}),
        Err(error) => json!({"path":crate::utils::display_path(root),"writable":false,"reason":error.to_string()}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checks_writes_without_changing_existing_files_and_reports_invalid_directory() {
        let root = std::env::temp_dir().join(format!("nm-startup-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        let existing = root.join("keep.txt");
        std::fs::write(&existing, "untouched").unwrap();
        assert_eq!(storage(&root)["writable"], true);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "untouched");
        assert_eq!(storage(&existing)["writable"], false);
        assert_eq!(storage(&root.join("missing"))["writable"], false);
        std::fs::remove_dir_all(root).unwrap();
    }
}

//! Reclaim only tracked, unreferenced document copies on a later process startup.
use crate::{
    db::DbConnection,
    utils::{CommandError, CommandResult},
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path, time::UNIX_EPOCH};

#[derive(Serialize, Deserialize, PartialEq)]
struct Fingerprint {
    bytes: u64,
    modified: String,
}

fn fingerprint(path: &Path) -> CommandResult<Fingerprint> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CommandError::new("Import cleanup requires a regular file"));
    }
    Ok(Fingerprint {
        bytes: metadata.len(),
        modified: metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CommandError::new("Invalid import modification time"))?
            .as_nanos()
            .to_string(),
    })
}

fn real_directory(path: &Path) -> CommandResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CommandError::new(
            "Import cleanup requires a real directory",
        ));
    }
    Ok(())
}

/// Write before rename. A crash may leave a ticket without a file, never an
/// untracked deletion candidate. No tickets are synthesized for pre-existing files.
pub fn record(root: &Path, name: &str, partial: &Path) -> CommandResult<()> {
    let base = root.join("imports");
    real_directory(&base)?;
    let tickets = base.join(".unclaimed");
    fs::create_dir_all(&tickets)?;
    real_directory(&tickets)?;
    let mut ticket = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tickets.join(format!("{name}.json")))?;
    ticket.write_all(&serde_json::to_vec(&fingerprint(partial)?)?)?;
    ticket.sync_all()?;
    Ok(())
}

/// Called only before this process accepts commands or starts parsing. Any DB
/// schema/read/lock failure preserves all files; individual file failures are skipped.
pub fn cleanup(root: &Path, db: &DbConnection) -> CommandResult<()> {
    let base = root.join("imports");
    real_directory(&base)?;
    let tickets = base.join(".unclaimed");
    if !tickets.exists() {
        return Ok(());
    }
    real_directory(&tickets)?;
    db.with(|connection| {
        // Hold the write reservation through the reference checks and file removals.
        let transaction = rusqlite::Transaction::new_unchecked(
            connection,
            rusqlite::TransactionBehavior::Immediate,
        )?;
        let mut references = HashSet::new();
        {
            let mut statement = transaction.prepare(
                "SELECT source_uri FROM notes WHERE source_uri IS NOT NULL AND source_uri <> ''",
            )?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            for row in rows {
                let uri = row?;
                let path = Path::new(&uri);
                // Unknown or relative legacy references make deletion unsafe.
                if !path.is_absolute() {
                    return Err(CommandError::new(
                        "Unresolved document reference; cleanup skipped",
                    ));
                }
                match path.canonicalize() {
                    Ok(path) => {
                        references.insert(path);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        for entry in fs::read_dir(&tickets)? {
            let Ok(entry) = entry else {
                continue;
            };
            if let Err(error) = cleanup_ticket(&base, &entry.path(), &references) {
                eprintln!("Unused import retained: {error}");
            }
        }
        transaction.commit()?;
        Ok(())
    })
}

fn cleanup_ticket(
    base: &Path,
    ticket: &Path,
    references: &HashSet<std::path::PathBuf>,
) -> CommandResult<()> {
    let metadata = fs::symlink_metadata(ticket)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 {
        return Ok(());
    }
    let Some(name) = ticket
        .file_name()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_suffix(".json"))
    else {
        return Ok(());
    };
    crate::file_transfer::identity(&serde_json::json!({"name":name, "kind":"document"}))?;
    let path = base.join(name);
    let canonical = match path.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if references.contains(&canonical) {
        // Once observed as adopted, stop tracking this copy for automatic reclamation.
        fs::remove_file(ticket)?;
        return Ok(());
    }
    if !metadata
        .modified()?
        .elapsed()
        .is_ok_and(|age| age.as_secs() >= 86400)
    {
        return Ok(());
    }
    let expected: Fingerprint = serde_json::from_slice(&fs::read(ticket)?)?;
    if fingerprint(&path)? != expected {
        return Ok(());
    }
    if canonical.parent() != Some(base.canonicalize()?.as_path()) {
        return Ok(());
    }
    fs::remove_file(&path)?;
    fs::remove_file(ticket)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "nativemind-import-cleanup-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&root).unwrap();
            fs::create_dir(root.join("imports")).unwrap();
            fs::write(root.join("imports/unused.txt"), "copy").unwrap();
            record(&root, "unused.txt", &root.join("imports/unused.txt")).unwrap();
            fs::File::options()
                .write(true)
                .open(root.join("imports/.unclaimed/unused.txt.json"))
                .unwrap()
                .set_times(
                    fs::FileTimes::new()
                        .set_modified(SystemTime::now() - Duration::from_secs(90000)),
                )
                .unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // This unique test directory was created above; never remove its parent.
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_schema_or_unresolved_references_preserve_all_copies() {
        let fixture = Fixture::new();
        let db = DbConnection::open(fixture.0.join("test.db")).unwrap();
        assert!(cleanup(&fixture.0, &db).is_err());
        assert!(fixture.0.join("imports/unused.txt").exists());
        db.with(|connection| {
            connection.execute_batch("CREATE TABLE notes(source_uri TEXT); INSERT INTO notes VALUES ('relative/path.txt');")?;
            Ok(())
        }).unwrap();
        assert!(cleanup(&fixture.0, &db).is_err());
        assert!(fixture.0.join("imports/unused.txt").exists());
        db.with(|connection| {
            connection.execute("DELETE FROM notes", [])?;
            Ok(())
        })
        .unwrap();
        cleanup(&fixture.0, &db).unwrap();
        assert!(!fixture.0.join("imports/unused.txt").exists());
    }

    #[test]
    fn replaced_directory_and_duplicate_ticket_are_never_overwritten_or_removed() {
        let fixture = Fixture::new();
        let path = fixture.0.join("imports/unused.txt");
        assert!(record(&fixture.0, "unused.txt", &path).is_err());
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep.txt"), "keep").unwrap();
        let db = DbConnection::open(fixture.0.join("test.db")).unwrap();
        db.with(|connection| {
            connection.execute_batch("CREATE TABLE notes(source_uri TEXT)")?;
            Ok(())
        })
        .unwrap();
        cleanup(&fixture.0, &db).unwrap();
        assert_eq!(fs::read_to_string(path.join("keep.txt")).unwrap(), "keep");
    }
}

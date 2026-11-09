use super::*;
use rusqlite::Connection;
use std::fs;

struct Fixture {
    root: PathBuf,
    db: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "anna-backup-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(root.join("imports")).unwrap();
        fs::create_dir(root.join("music")).unwrap();
        let db = root.join("nativemind.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations(version INTEGER); CREATE TABLE notes(id TEXT,source_uri TEXT,content TEXT); CREATE TABLE settings(key TEXT,value TEXT);").unwrap();
        fs::write(root.join("imports/原文.txt"), "original").unwrap();
        conn.execute(
            "INSERT INTO notes VALUES ('note',?,?)",
            [
                crate::utils::display_path(&root.join("imports/原文.txt")),
                crate::utils::display_path(&root),
            ],
        )
        .unwrap();
        Self { root, db }
    }
    fn run<T>(&self, future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }
    fn export(&self) -> Value {
        self.run(export(&self.root, &self.db)).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn legacy_local_restore_preserves_colliding_files_and_note_content() {
    let f = Fixture::new();
    let backup = f.export();
    let id = backup["id"].as_str().unwrap();
    fs::write(
        Path::new(backup["path"].as_str().unwrap()).join("complete.json"),
        serde_json::to_vec(&json!({"schema":1,"id":id})).unwrap(),
    )
    .unwrap();
    assert!(import(&f.root, backup["path"].as_str().unwrap())
        .unwrap_err()
        .to_string()
        .contains("旧版"));
    fs::write(f.root.join("imports/原文.txt"), "modified").unwrap();
    f.run(schedule_restore(&f.root, &f.db, id)).unwrap();
    apply_pending(&f.root).unwrap();
    let status = crate::restore_recovery::status(&f.root).unwrap();
    assert_eq!(status["state"], "restored", "{status}");
    let conn = Connection::open(&f.db).unwrap();
    let (path, content): (String, String) = conn
        .query_row("SELECT source_uri,content FROM notes", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), "original");
    assert_eq!(
        fs::read_to_string(f.root.join("imports/原文.txt")).unwrap(),
        "modified"
    );
    assert_eq!(content, crate::utils::display_path(&f.root));
    assert!(!f.root.join("restore-request.json").exists());
}

#[test]
fn missing_references_are_rejected_before_restore_is_scheduled() {
    let f = Fixture::new();
    let backup = f.export();
    fs::remove_file(Path::new(backup["path"].as_str().unwrap()).join("imports/原文.txt")).unwrap();
    assert!(f
        .run(schedule_restore(
            &f.root,
            &f.db,
            backup["id"].as_str().unwrap()
        ))
        .unwrap_err()
        .to_string()
        .contains("缺少引用文件"));
    assert!(!f.root.join("restore-request.json").exists());
    assert_eq!(
        fs::read_to_string(f.root.join("imports/原文.txt")).unwrap(),
        "original"
    );
}

#[test]
fn changed_backup_after_scheduling_does_not_replace_the_live_database() {
    let f = Fixture::new();
    let backup = f.export();
    f.run(schedule_restore(
        &f.root,
        &f.db,
        backup["id"].as_str().unwrap(),
    ))
    .unwrap();
    fs::write(
        Path::new(backup["path"].as_str().unwrap()).join("nativemind.db"),
        b"corrupt",
    )
    .unwrap();
    apply_pending(&f.root).unwrap();
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["state"],
        "failed"
    );
    assert!(!f.root.join("restore-request.json").exists());
    let conn = Connection::open(&f.db).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        fs::read_to_string(f.root.join("imports/原文.txt")).unwrap(),
        "original"
    );
}

#[test]
fn nested_assets_and_live_database_sidecars_are_rejected() {
    let f = Fixture::new();
    let backup = f.export();
    let source = Path::new(backup["path"].as_str().unwrap());
    fs::create_dir(source.join("imports/nested")).unwrap();
    assert!(import(&f.root, source.to_str().unwrap()).is_err());
    fs::remove_dir(source.join("imports/nested")).unwrap();
    fs::write(source.join("nativemind.db-wal"), b"not a closed snapshot").unwrap();
    assert!(import(&f.root, source.to_str().unwrap()).is_err());
}

#[test]
fn committed_restore_is_not_replayed_after_result_write_failure() {
    let f = Fixture::new();
    let backup = f.export();
    f.run(schedule_restore(
        &f.root,
        &f.db,
        backup["id"].as_str().unwrap(),
    ))
    .unwrap();
    // Force an error strictly after DB replacement, before outcome persistence.
    fs::create_dir(f.root.join("restore-result.json")).unwrap();
    assert!(apply_pending(&f.root).is_err());
    assert!(f.root.join("restore-request.json").exists());
    let conn = Connection::open(&f.db).unwrap();
    conn.execute("UPDATE notes SET content = 'after commit'", [])
        .unwrap();
    drop(conn);
    fs::remove_dir(f.root.join("restore-result.json")).unwrap();
    // Even a now-corrupt source must not be read again after a committed restore.
    fs::write(
        Path::new(backup["path"].as_str().unwrap()).join("nativemind.db"),
        b"corrupt",
    )
    .unwrap();
    apply_pending(&f.root).unwrap();
    let conn = Connection::open(&f.db).unwrap();
    assert_eq!(
        conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "after commit"
    );
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["state"],
        "restored"
    );
    apply_pending(&f.root).unwrap();
}

#[test]
fn failed_result_is_not_retried_if_request_cleanup_was_interrupted() {
    let f = Fixture::new();
    let backup = f.export();
    f.run(schedule_restore(
        &f.root,
        &f.db,
        backup["id"].as_str().unwrap(),
    ))
    .unwrap();
    let request = crate::restore_recovery::read(&f.root.join("restore-request.json")).unwrap();
    crate::restore_recovery::write(
        &f.root,
        "restore-result.json",
        &json!({"state":"failed","token":request["token"],"error":"previous failure"}),
    )
    .unwrap();
    let conn = Connection::open(&f.db).unwrap();
    conn.execute("UPDATE notes SET content='keep current'", [])
        .unwrap();
    drop(conn);
    apply_pending(&f.root).unwrap();
    let conn = Connection::open(&f.db).unwrap();
    assert_eq!(
        conn.query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "keep current"
    );
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["error"],
        "previous failure"
    );
}

#[test]
fn invalid_request_is_quarantined_and_legacy_request_can_still_restore() {
    let f = Fixture::new();
    fs::write(f.root.join("restore-request.json"), b"partial json {").unwrap();
    apply_pending(&f.root).unwrap();
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["state"],
        "failed"
    );
    let backup = f.export();
    // Old builds did not put a token in the pending request.
    crate::restore_recovery::write(
        &f.root,
        "restore-request.json",
        &json!({"id":backup["id"],"safety":backup}),
    )
    .unwrap();
    apply_pending(&f.root).unwrap();
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["state"],
        "restored"
    );
}

#[test]
fn busy_wal_is_not_deleted_or_replaced() {
    let f = Fixture::new();
    let backup = f.export();
    f.run(schedule_restore(
        &f.root,
        &f.db,
        backup["id"].as_str().unwrap(),
    ))
    .unwrap();
    let writer = Connection::open(&f.db).unwrap();
    writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE notes SET content='committed in WAL';").unwrap();
    let reader = Connection::open(&f.db).unwrap();
    reader.execute_batch("BEGIN; SELECT * FROM notes;").unwrap();
    apply_pending(&f.root).unwrap();
    assert_eq!(
        crate::restore_recovery::status(&f.root).unwrap()["state"],
        "failed"
    );
    assert!(f.root.join("nativemind.db-wal").exists());
    assert_eq!(
        writer
            .query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "committed in WAL"
    );
}

//! 数据库命令
//!
//! 命令名和参数名必须与前端 `TauriSqlDriver` 对齐：
//! 它默认调 `db_select` / `db_execute`，参数是 `{ sql, params }`。
//! 改这里的签名会直接让前端所有 Repository 失效。
//!
//! 关于「前端发原始 SQL」这件事：SQL 语句全部是 TS 侧写死的字面量，
//! 用户输入一律走 `?` 占位参数，不做字符串拼接。真正的注入风险在
//! Repository 里，而那边已经统一用参数化查询。

use tauri::State;

use crate::db::{DbConnection, SqlParam, SqlRow};
use crate::utils::CommandResult;

#[tauri::command]
pub fn db_select(
    db: State<'_, DbConnection>,
    sql: String,
    params: Option<Vec<SqlParam>>,
) -> CommandResult<Vec<SqlRow>> {
    db.select(&sql, &params.unwrap_or_default())
}

#[tauri::command]
pub fn db_execute(
    db: State<'_, DbConnection>,
    sql: String,
    params: Option<Vec<SqlParam>>,
) -> CommandResult<usize> {
    db.execute(&sql, &params.unwrap_or_default())
}

/// schema 状态，给启动自检和设置页用
#[tauri::command]
pub fn db_schema_status(
    db: State<'_, DbConnection>,
) -> CommandResult<crate::db::migrations::SchemaStatus> {
    crate::db::migrations::schema_status(&db)
}

/// 完整性检查。全表扫描，只在用户手动触发时调用
#[tauri::command]
pub fn db_integrity_check(db: State<'_, DbConnection>) -> CommandResult<String> {
    crate::db::migrations::integrity_check(&db)
}

/// 数据库文件路径，设置页展示「数据存在哪」
#[tauri::command]
pub fn db_path(db: State<'_, DbConnection>) -> String {
    crate::utils::display_path(&db.path())
}

/// 备份数据库到数据目录 backups/ 下（VACUUM INTO 出一致性快照，WAL 模式下也安全）。
/// 覆盖上一次备份，保留一份最近快照。
#[tauri::command]
pub async fn db_backup(
    db: State<'_, DbConnection>,
    paths: State<'_, crate::commands::file::AppPaths>,
) -> CommandResult<String> {
    let db_file = db.path();
    let backups = paths.data_dir().join("backups");
    std::fs::create_dir_all(&backups)?;
    let destination = backups.join("nativemind.db.bak");
    let destination_display = destination.clone();
    let temp = backups.join("nativemind.db.bak.tmp");

    // VACUUM INTO 是整库拷贝，放 spawn_blocking：大库不冻住异步运行时
    // （模型调用 / 托盘轮询都跑在它上面）。用独立连接做一致快照
    // （WAL 下 VACUUM INTO 允许并发连接），不占主连接互斥锁。
    tokio::task::spawn_blocking(move || -> CommandResult<()> {
        // 先 VACUUM INTO 临时文件，成功后再原子 rename 覆盖正式备份：
        // 中途失败（磁盘满/中断）不会把最后一份好备份毁掉
        let _ = std::fs::remove_file(&temp);
        let escaped = temp.to_string_lossy().replace('\'', "''");
        let conn = rusqlite::Connection::open(&db_file)?;
        conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
            .map_err(crate::utils::CommandError::from)?;
        std::fs::rename(&temp, &destination)?;
        Ok(())
    })
    .await
    .map_err(|join_error| {
        crate::utils::CommandError::new(format!("备份线程失败：{join_error}"))
    })??;

    Ok(crate::utils::display_path(&destination_display))
}

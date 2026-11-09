use crate::utils::CommandResult;

/// 备份数据库到数据目录 backups/ 下（VACUUM INTO 出一致性快照，WAL 模式下也安全）。
/// 按时间戳命名保留最近 KEEP_BACKUPS 份（默认 7），超出自动清理最旧的——
/// 只留一份的话，当天崩溃就只能恢复到昨天早晨的快照，删除/损坏的数据找不回来。
const KEEP_BACKUPS: usize = 7;

pub async fn create_snapshot(
    db_file: std::path::PathBuf,
    backups: std::path::PathBuf,
) -> CommandResult<String> {
    std::fs::create_dir_all(&backups)?;
    // 时间戳命名：同一天多次备份也不互相覆盖
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%f");
    let destination = backups.join(format!("nativemind-{stamp}.db.bak"));
    let destination_display = destination.clone();
    let temp = backups.join(format!("nativemind-{stamp}.db.bak.tmp"));

    // VACUUM INTO 是整库拷贝，放 spawn_blocking：大库不冻住异步运行时
    // （模型调用 / 托盘轮询都跑在它上面）。用独立连接做一致快照
    // （WAL 下 VACUUM INTO 允许并发连接），不占主连接互斥锁。
    tokio::task::spawn_blocking(move || -> CommandResult<()> {
        // 先 VACUUM INTO 临时文件，成功后再原子 rename 成正式备份：
        // 中途失败（磁盘满/中断）不会留下半个备份文件
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

    // 清理超出保留份数的旧备份（按文件名时间戳排序，留最新的 KEEP_BACKUPS 份）
    prune_backups(&backups, KEEP_BACKUPS);

    Ok(crate::utils::display_path(&destination_display))
}

/// 删除 backups 目录里超过 keep 份的 .bak 文件（按文件名排序留最新的）。
/// 抽出为独立函数便于单测：轮转策略改动不影响命令本体。
fn prune_backups(backups: &std::path::Path, keep: usize) {
    let mut existing: Vec<_> = std::fs::read_dir(backups)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "bak").unwrap_or(false))
        .collect();
    existing.sort();
    while existing.len() > keep {
        let oldest = existing.remove(0);
        let _ = std::fs::remove_file(&oldest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_most_recent_bak_files() {
        let dir = std::env::temp_dir().join("nativemind_backup_prune_test");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();

        // 造 10 个时间戳命名的备份
        for day in 1..=10 {
            let name = format!("nativemind-202601{day:02}-000000.db.bak");
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        // 一个非 .bak 文件不应被清理
        std::fs::write(dir.join("keep-me.txt"), b"x").unwrap();

        prune_backups(&dir, 7);
        let mut remaining = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        remaining.sort();

        assert_eq!(remaining.len(), 8, "7 份备份 + 1 个非 bak 文件");
        // 最旧的 3 份（01/02/03）应被清掉，最新的 7 份（04-10）保留
        for day in 1..=3 {
            let name = format!("nativemind-202601{day:02}-000000.db.bak");
            assert!(
                !remaining.iter().any(|n| n == &name),
                "最旧的 {name} 应被清理"
            );
        }
        for day in 4..=10 {
            let name = format!("nativemind-202601{day:02}-000000.db.bak");
            assert!(remaining.iter().any(|n| n == &name), "最新的 {name} 应保留");
        }
        assert!(remaining.iter().any(|name| name == "keep-me.txt"));

        std::fs::remove_dir_all(&dir).ok();
    }
}

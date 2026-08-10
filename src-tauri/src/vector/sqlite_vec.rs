//! sqlite-vec 扩展加载
//!
//! 向量和业务数据同库是首选方案（不用额外起服务），但 vec0 是**可选**扩展：
//! 通过加载 `vec0.dll`（随应用打包，启动时复制到数据目录 extensions/）提供。
//! 加载失败不上抛成致命错误，只是让 available 变 false，前端据此把 RAG
//! 降级到关键词检索（C3：缺组件时功能仍可用）。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::db::DbConnection;
use crate::utils::CommandResult;

/// 各平台的动态库文件名（Windows 是 vec0.dll；macOS vec0.dylib；Linux vec0.so）
#[cfg(target_os = "windows")]
const LIB_NAMES: &[&str] = &["vec0.dll"];
#[cfg(target_os = "macos")]
const LIB_NAMES: &[&str] = &["vec0.dylib"];
#[cfg(all(unix, not(target_os = "macos")))]
const LIB_NAMES: &[&str] = &["vec0.so"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorStatus {
    pub available: bool,
    /// 实际加载到的文件路径，排查问题时有用
    pub loaded_from: Option<String>,
    /// 不可用的原因，直接显示在设置页
    pub reason: Option<String>,
}

fn candidate_paths(extension_dir: &Path) -> Vec<PathBuf> {
    LIB_NAMES
        .iter()
        .map(|name| extension_dir.join(name))
        .collect()
}

/// 尝试加载扩展并确认 vec0 真的能用
///
/// 光加载成功不够：得实际调用 vec_version() 才知道 vec0 模块注册上了。
pub fn load(db: &DbConnection, extension_dir: &Path) -> VectorStatus {
    let candidates = candidate_paths(extension_dir);
    let existing = candidates.iter().find(|path| path.exists());

    let Some(path) = existing else {
        return VectorStatus {
            available: false,
            loaded_from: None,
            reason: Some(format!(
                "未找到 sqlite-vec 扩展，可放置于 {}",
                extension_dir.display()
            )),
        };
    };

    let outcome = db.with(|connection| {
        // load_extension 是 unsafe：它会执行任意动态库代码。
        // 这里只加载我们自己拼出来的固定路径（应用数据目录下的固定文件名），
        // 路径不来自前端输入，所以风险可控。
        unsafe {
            connection
                .load_extension_enable()
                .map_err(crate::utils::CommandError::from)?;
            let result = connection.load_extension(path, None);
            // 无论成败都要关掉，否则后续任意 SQL 都能加载动态库
            let _ = connection.load_extension_disable();
            result.map_err(crate::utils::CommandError::from)?;
        }

        connection
            .query_row("SELECT vec_version()", [], |row| row.get::<_, String>(0))
            .map_err(crate::utils::CommandError::from)?;

        Ok(())
    });

    match outcome {
        Ok(()) => VectorStatus {
            available: true,
            loaded_from: Some(path.display().to_string()),
            reason: None,
        },
        Err(error) => VectorStatus {
            available: false,
            loaded_from: Some(path.display().to_string()),
            reason: Some(error.to_string()),
        },
    }
}

/// 供启动流程调用：加载失败只记日志，不阻断启动
pub fn load_quietly(db: &DbConnection, extension_dir: &Path) -> CommandResult<VectorStatus> {
    let status = load(db, extension_dir);
    if !status.available {
        if let Some(reason) = &status.reason {
            eprintln!("[vector] sqlite-vec 不可用，RAG 将降级到关键词检索：{reason}");
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证随包分发的 vec0.dll 真的能被加载并调用 vec_version()。
    /// 这决定了 RAG 向量检索是否可用，值得单独一条测试盯着。
    #[test]
    fn bundled_vec0_loads() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let db = crate::db::DbConnection::open(":memory:").expect("内存库应能打开");
        let status = load(&db, &dir);
        assert!(
            status.available,
            "打包的 vec0 动态库应能加载，原因：{:?}",
            status.reason
        );
        assert!(status.loaded_from.is_some());
    }
}

//! 通用工具
//!
//! 只放两样东西：跨命令共用的错误类型，和路径安全校验。
//! 前者让所有 command 的 Result 能直接被 Tauri 序列化成前端可读的字符串，
//! 后者是所有文件命令的入口检查。

use std::fmt;
use std::path::{Path, PathBuf};

/// 命令层统一错误
///
/// Tauri 要求错误类型实现 Serialize。这里不透传底层错误的 Debug 输出，
/// 而是转成一句人话 —— 前端的 describeError 会把它直接显示给用户。
#[derive(Debug)]
pub struct CommandError(String);

impl CommandError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl std::error::Error for CommandError {}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<rusqlite::Error> for CommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self(format!("数据库错误：{error}"))
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self(format!("文件错误：{error}"))
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        Self(format!("JSON 错误：{error}"))
    }
}

impl From<reqwest::Error> for CommandError {
    fn from(error: reqwest::Error) -> Self {
        // 本地模型没起来是最常见的情况，单独给一句可操作的提示
        if error.is_connect() {
            return Self("连不上本地模型服务，请确认 Ollama 已启动".to_string());
        }
        if error.is_timeout() {
            return Self("模型响应超时".to_string());
        }
        Self(format!("模型请求失败：{error}"))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

/// 展示用路径：去掉 Windows 的 `\\?\` 扩展前缀。
///
/// Windows 上 `canonicalize()` / 部分路径解析会返回带 `\\?\` 前缀的路径，
/// 直接 `display().to_string()` 会把这串字符原样带给前端，显示成「路径前面的乱码」。
/// 所有返回给前端的路径统一走这里归一化。
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => rest.to_string(),
        None => s.into_owned(),
    }
}

/// 把用户传来的路径限制在允许的根目录内
///
/// 前端传的 uri 最终会落到 fs 读写上。不做校验的话，`../../` 这种相对路径
/// 能读到应用数据目录外的任意文件。这里先 canonicalize 解掉所有 `..` 和符号链接，
/// 再确认结果仍在 root 之下 —— 只做前缀字符串比较是拦不住符号链接的。
pub fn ensure_within(root: &Path, candidate: &Path) -> CommandResult<PathBuf> {
    // root 自身也要 canonicalize，否则两边表示形式不同（如 Windows 的 8.3 短名）会误判
    let canonical_root = root
        .canonicalize()
        .map_err(|error| CommandError::new(format!("根目录不可用：{error}")))?;

    let canonical = candidate
        .canonicalize()
        .map_err(|error| CommandError::new(format!("路径不可用：{error}")))?;

    if !canonical.starts_with(&canonical_root) {
        return Err(CommandError::new("路径超出允许范围"));
    }

    Ok(canonical)
}

/// 写入前的路径校验
///
/// 目标文件还不存在时 canonicalize 会失败，所以改为校验父目录，
/// 再把文件名拼回去。文件名里不允许出现分隔符，否则又能借它跳出目录。
pub fn ensure_writable_within(root: &Path, candidate: &Path) -> CommandResult<PathBuf> {
    let parent = candidate
        .parent()
        .ok_or_else(|| CommandError::new("路径缺少父目录"))?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| CommandError::new("路径缺少文件名"))?;

    let canonical_parent = ensure_within(root, parent)?;
    let safe = canonical_parent.join(file_name);

    // 目标若已存在且是符号链接/junction：写入会跟着它逃出 data_dir。
    // 用 symlink_metadata 不跟随链接本身，junction 在 Windows 上同样命中。
    if let Ok(metadata) = std::fs::symlink_metadata(&safe) {
        if metadata.file_type().is_symlink() {
            return Err(CommandError::new("目标路径是符号链接，拒绝写入"));
        }
    }

    Ok(safe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_strips_extended_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\foo\bar")), r"C:\foo\bar");
        assert_eq!(display_path(Path::new(r"C:\foo\bar")), r"C:\foo\bar");
        assert_eq!(display_path(Path::new(r"E:\agent_workspace")), r"E:\agent_workspace");
    }

    #[test]
    fn ensure_within_rejects_escape() {
        let root = std::env::temp_dir().join("nativemind_utils_test");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("ok.txt"), b"x").unwrap();
        assert!(ensure_within(&root, &root.join("ok.txt")).is_ok());
        assert!(ensure_within(&root, &Path::new("C:/Windows/win.ini")).is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}

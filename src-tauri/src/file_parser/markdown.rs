//! Markdown 读取
//!
//! **不在这里做解析。** 前端 `markdown-parser.ts` 已经实现了标题推断、
//! 正文清洗、frontmatter 处理，而且能脱离 Tauri 运行时做单元测试。
//! Rust 侧只负责把文件内容原样交出去，解析仍归 TS。
//!
//! 这样做的代价是多一次 IPC 传输，换来的是解析逻辑只有一份。

use std::path::Path;

use crate::utils::{CommandError, CommandResult};

/// 单个文件大小上限
///
/// 一次性读进内存再过 IPC，几百 MB 的文件会直接把 WebView 撑爆。
/// 笔记类文本远到不了这个量级，超了基本说明选错了文件。
const MAX_TEXT_BYTES: u64 = 32 * 1024 * 1024;

/// 读取文本文件
///
/// 用 from_utf8_lossy 而不是严格解码：用户导入的老笔记可能有零星坏字节，
/// 为几个乱码字符拒绝整个文件不合理，坏字符会变成 U+FFFD。
pub async fn read_text(path: &Path) -> CommandResult<String> {
    let metadata = tokio::fs::metadata(path).await?;

    if !metadata.is_file() {
        return Err(CommandError::new("目标不是文件"));
    }

    if metadata.len() > MAX_TEXT_BYTES {
        return Err(CommandError::new(format!(
            "文件过大（{:.1} MB），上限 {} MB",
            metadata.len() as f64 / 1_048_576.0,
            MAX_TEXT_BYTES / 1_048_576
        )));
    }

    let bytes = tokio::fs::read(path).await?;
    Ok(strip_bom(&String::from_utf8_lossy(&bytes)).to_string())
}

/// 去掉 UTF-8 BOM
///
/// Windows 记事本存的文件常带 BOM。留着它会让第一个标题的 `#` 匹配失败，
/// 标题推断就会拿到一个看不见的坏字符。
fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

#[cfg(test)]
mod tests {
    use super::strip_bom;

    #[test]
    fn removes_bom() {
        assert_eq!(strip_bom("\u{feff}# 标题"), "# 标题");
        assert_eq!(strip_bom("# 标题"), "# 标题");
    }
}

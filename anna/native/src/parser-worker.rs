//! One-shot, read-only extraction in a disposable process. No database is opened.
use crate::utils::{CommandError, CommandResult};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;

pub fn validate(root: &Path, command: &str, uri: &Path) -> CommandResult<PathBuf> {
    if !matches!(
        command,
        "file_read_text" | "file_extract_pdf" | "file_extract_ebook"
    ) {
        return Err(CommandError::new("Unsupported file job"));
    }
    let base = root.join("imports").canonicalize()?;
    let path = crate::utils::ensure_within(&base, uri)?;
    if path.parent() != Some(base.as_path()) || !path.is_file() {
        return Err(CommandError::new(
            "Only completed imported files can be parsed",
        ));
    }
    if std::fs::metadata(&path)?.len() > 32 * 1024 * 1024 {
        return Err(CommandError::new("Import exceeds 32 MiB"));
    }
    Ok(path)
}

/// The parent's pipe is a lifetime lease, not a command input. EOF also covers
/// abrupt parent termination, which cannot run Rust Drop handlers.
pub fn watch_parent() -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("parser-parent-lease".into())
        .spawn(|| {
            let _ = std::io::stdin().read(&mut [0u8; 1]);
            std::process::exit(0);
        })?;
    Ok(())
}

pub fn run(root: &Path, command: &str, uri: &Path) -> CommandResult<()> {
    watch_parent()?;
    let result: CommandResult<Value> = (|| {
        let path = validate(root, command, uri)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            match command {
                "file_read_text" => Ok(json!(tokio::fs::read_to_string(path).await?)),
                "file_extract_pdf" => Ok(serde_json::to_value(
                    crate::file_parser::pdf::extract(&path).await?,
                )?),
                _ => Ok(serde_json::to_value(
                    crate::file_parser::ebook::extract(&path).await?,
                )?),
            }
        })
    })();
    let mut bytes = serde_json::to_vec(&result.map_err(|error| error.to_string()))?;
    if bytes.len() as u64 > MAX_OUTPUT_BYTES {
        bytes = serde_json::to_vec(&Result::<Value, String>::Err(
            "解析结果超过 32 MiB，请拆分文档后导入".into(),
        ))?;
    }
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(())
}

pub fn read_result(reader: impl Read) -> Result<Value, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_OUTPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_OUTPUT_BYTES {
        return Err("解析结果超过 32 MiB，请拆分文档后导入".into());
    }
    serde_json::from_slice::<Result<Value, String>>(&bytes)
        .map_err(|_| "文件解析进程返回无效结果".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_success_failure_and_bounded_protocol_output() {
        assert_eq!(
            read_result(br#"{"Ok":"text"}"#.as_slice()).unwrap(),
            json!("text")
        );
        assert_eq!(
            read_result(br#"{"Err":"bad PDF"}"#.as_slice()).unwrap_err(),
            "bad PDF"
        );
        assert!(read_result(b"partial JSON".as_slice()).is_err());
        assert!(
            read_result(std::io::repeat(b'x').take(MAX_OUTPUT_BYTES + 100))
                .unwrap_err()
                .contains("32 MiB")
        );
    }
}

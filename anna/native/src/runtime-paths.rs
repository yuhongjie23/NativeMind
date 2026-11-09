use crate::utils::{CommandError, CommandResult};
use std::path::{Path, PathBuf};

pub fn data_root(value: Option<std::ffi::OsString>) -> CommandResult<PathBuf> {
    let root = value.map(PathBuf::from).ok_or_else(|| CommandError::new(
        "Set NATIVEMIND_ANNA_DATA_DIR to an absolute local data directory; no source-tree fallback is allowed",
    ))?;
    if !root.is_absolute() {
        return Err(CommandError::new(
            "NATIVEMIND_ANNA_DATA_DIR must be an absolute path",
        ));
    }
    Ok(root)
}

pub fn resource_dir(executable: &Path) -> CommandResult<PathBuf> {
    Ok(executable
        .parent()
        .ok_or_else(|| CommandError::new("Cannot locate native executable directory"))?
        .join("resources"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_or_relative_data_directories_fail_closed() {
        assert!(data_root(None).is_err());
        assert!(data_root(Some("".into())).is_err());
        assert!(data_root(Some("relative/data".into())).is_err());
        let directory = std::env::temp_dir().join("anna-data");
        assert_eq!(
            data_root(Some(directory.clone().into_os_string())).unwrap(),
            directory
        );
    }
}

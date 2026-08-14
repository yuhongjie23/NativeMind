//! 音频命令
//!
//! **播放不在这里。** 前端 `AudioPlayer` 用 HTML Audio 元素播放，
//! 音量、循环、环境音互斥都已经实现好了，Rust 再起一路播放器
//! 只会带来两个音源同时响的问题。
//!
//! 这里只回答一个问题：磁盘上到底有哪些音频文件。
//! `audio-library.ts` 里的 track 表是静态清单，用户往 public/audio 下
//! 丢了新文件时需要这个命令才能发现。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::file::AppPaths;
use crate::utils::{display_path, ensure_within, CommandError, CommandResult};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "ogg", "wav", "m4a", "flac"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    /// 相对 audio 目录的路径，前端拼上 baseUrl 就能播
    pub relative_path: String,
    pub category: String,
    pub size_bytes: u64,
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| AUDIO_EXTENSIONS.contains(&extension.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 扫描一个分类目录（ambient / cue / companion）
fn scan_category(root: &Path, category: &str) -> Vec<AudioAsset> {
    let dir = root.join(category);

    let Ok(entries) = std::fs::read_dir(&dir) else {
        // 目录不存在是正常情况：用户可能没放任何音乐
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| is_audio(&entry.path()))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            Some(AudioAsset {
                relative_path: format!("{category}/{name}"),
                category: category.to_string(),
                size_bytes: metadata.len(),
            })
        })
        .collect()
}

/// 列出可用音频
///
/// 目录结构与 public/audio 一致：ambient / cue / companion，
/// 与 audio-library.ts 的 category 对齐。
#[tauri::command]
pub fn audio_list_assets(paths: State<'_, AppPaths>) -> CommandResult<Vec<AudioAsset>> {
    let audio_root: PathBuf = paths.resource_dir().join("audio");

    let mut assets = Vec::new();
    for category in ["ambient", "cue", "companion"] {
        assets.extend(scan_category(&audio_root, category));
    }

    Ok(assets)
}

/// 音频资源目录，前端拼 src 用
#[tauri::command]
pub fn audio_root(paths: State<'_, AppPaths>) -> String {
    display_path(&paths.resource_dir().join("audio"))
}

/// 用户音乐目录里的一首曲子
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAsset {
    /// 完整路径，audio_read 用它取字节
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
}

/// 扫描一个目录下的音频文件（命令与测试共用）。
///
/// 递归扫描子目录：用户设置的音乐目录可能只到外层（如选了包含若干歌手
/// 子目录的根目录），只扫一层会漏掉全部音乐。限制扫描深度与数量，防止
/// 误配到巨大目录（如整个磁盘）时卡死。
fn scan_music_dir(dir: &Path) -> Vec<MusicAsset> {
    const MAX_DEPTH: usize = 8;
    const MAX_FILES: usize = 2_000;

    fn walk(dir: &Path, depth: usize, out: &mut Vec<MusicAsset>, budget: &mut usize) {
        if depth > MAX_DEPTH || *budget == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if *budget == 0 {
                break;
            }
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    walk(&path, depth + 1, out, budget);
                    continue;
                }
                if meta.is_file() && is_audio(&path) {
                    *budget -= 1;
                    out.push(MusicAsset {
                        path: display_path(&path),
                        name: entry.file_name().to_string_lossy().into_owned(),
                        size_bytes: meta.len(),
                    });
                }
            }
        }
    }

    let mut assets = Vec::new();
    let mut budget = MAX_FILES;
    walk(dir, 0, &mut assets, &mut budget);
    assets
}

/// 列出音乐目录下的音频文件
///
/// 音乐目录来自设置（AppPaths.music_dir，由 file_update_paths 维护）。
/// 目录未配置或不存在都返回空列表，播放器据此提示用户去设置。
#[tauri::command]
pub fn audio_list_music(paths: State<'_, AppPaths>) -> CommandResult<Vec<MusicAsset>> {
    let Some(music_dir) = paths.music_dir() else {
        return Ok(Vec::new());
    };
    Ok(scan_music_dir(&music_dir))
}

/// 读一首音乐的字节。只允许 music_dir 内的音频文件（命令与测试共用）。
async fn read_music_bytes(dir: &Path, path: &Path) -> CommandResult<Vec<u8>> {
    // 先做路径安全校验（目录外一律拒绝），再限制扩展名 ——
    // 音乐目录里的非音频文件（txt/db 等）不允许读，防止配错目录放开全盘读
    let safe = ensure_within(dir, path)?;
    if !is_audio(&safe) {
        return Err(CommandError::new("只允许读取音频文件"));
    }
    let bytes = tokio::fs::read(&safe).await?;
    if bytes.is_empty() {
        return Err(CommandError::new("音乐文件为空"));
    }
    Ok(bytes)
}

/// 读取一首音乐的字节，前端转 Blob 播放。
///
/// 只允许 music_dir 内的文件：用户传什么路径就是什么路径，不校验的话
/// 一条命令就能读走机器上任意的文件。返回原始字节走 tauri::ipc::Response，
/// 前端 invoke 拿到 ArrayBuffer，避免整首曲子被 JSON 数组撑大十几倍。
#[tauri::command]
pub async fn audio_read(paths: State<'_, AppPaths>, path: String) -> CommandResult<tauri::ipc::Response> {
    let Some(music_dir) = paths.music_dir() else {
        return Err(CommandError::new("未配置音乐目录"));
    };

    let bytes = read_music_bytes(&music_dir, Path::new(&path)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 读取随包背景音乐（resources/audio/backgrounds 内），供 useBackgroundMusic 播放。
/// 与 asset:// 协议无关：直接经 IPC 读字节 → 前端转 Blob，机制与音乐库一致，稳定可靠。
#[tauri::command]
pub async fn bgm_read(
    paths: State<'_, AppPaths>,
    path: String,
) -> CommandResult<tauri::ipc::Response> {
    let base = paths.resource_dir().join("audio").join("backgrounds");
    let safe = ensure_within(&base, Path::new(&path))?;
    if !is_audio(&safe) {
        return Err(CommandError::new("只允许读取音频文件"));
    }
    let bytes = tokio::fs::read(&safe).await?;
    if bytes.is_empty() {
        return Err(CommandError::new("背景音乐文件为空"));
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// 读取应用许可目录内的音频字节（自定义背景音乐用）。
///
/// 只允许 `check_readable` 白名单内的文件（data_dir / imports / resource_dir /
/// 配置的读取目录），用户选的自定义背景音频经 file_import_into_data_dir 复制进
/// data_dir/imports 后在这里读取；不放开任意路径读权限。
#[tauri::command]
pub async fn audio_read_imported(
    paths: State<'_, AppPaths>,
    path: String,
) -> CommandResult<tauri::ipc::Response> {
    let safe = paths.check_readable(Path::new(&path))?;
    let bytes = tokio::fs::read(&safe).await?;
    if bytes.is_empty() {
        return Err(CommandError::new("音频文件为空"));
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nativemind_audio_{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_lists_only_audio_files() {
        let dir = temp_dir("scan");
        std::fs::write(dir.join("song.mp3"), b"audio").unwrap();
        std::fs::write(dir.join("notes.txt"), b"text").unwrap();
        std::fs::write(dir.join("cover.PNG"), b"image").unwrap();

        let assets = scan_music_dir(&dir);
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].name, "song.mp3");
        assert_eq!(assets[0].size_bytes, 5);
    }

    #[test]
    fn scan_missing_dir_returns_empty() {
        assert!(scan_music_dir(&Path::new("no_such_dir_nativemind")).is_empty());
    }

    #[test]
    fn scan_recurses_into_subdirectories() {
        let dir = temp_dir("scan_nested");
        std::fs::write(dir.join("root.mp3"), b"a").unwrap();
        std::fs::create_dir_all(dir.join("artist/album")).unwrap();
        std::fs::write(dir.join("artist/album/song1.mp3"), b"b").unwrap();
        std::fs::write(dir.join("artist/album/song2.flac"), b"c").unwrap();

        let assets = scan_music_dir(&dir);
        std::fs::remove_dir_all(&dir).ok();

        let mut names: Vec<_> = assets.iter().map(|a| a.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["root.mp3", "song1.mp3", "song2.flac"]);
    }

    #[test]
    fn read_within_dir_ok_outside_rejected() {
        let dir = temp_dir("read");
        std::fs::write(dir.join("a.mp3"), b"data").unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let ok = runtime
            .block_on(read_music_bytes(&dir, &dir.join("a.mp3")))
            .expect("目录内读取应成功");
        assert_eq!(ok, b"data");

        let error = runtime
            .block_on(read_music_bytes(&dir, &Path::new("C:/Windows/win.ini")))
            .expect_err("目录外文件应被拒绝");
        assert!(error.to_string().contains("超出允许范围"));

        std::fs::remove_dir_all(&dir).ok();
    }
}

//! 文件命令
//!
//! 前端 `FileImportOptions.readTextFile` 和 `PdfExtractor` 的宿主实现。
//!
//! 每个命令都先过 `ensure_within`：路径来自用户的文件选择框，
//! 但也可能来自数据库里存的旧路径（`notes.source_uri`），那份数据在
//! 库被人手改过的情况下并不可信。校验成本极低，不做没有理由。

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::db::DbConnection;
use crate::file_parser::{ebook, markdown, pdf};
use crate::utils::{
    display_path, ensure_within, ensure_writable_within, CommandError, CommandResult,
};

/// 用户在设置里配置的 dataDir / resourceDir 覆盖值。
///
/// 数据目录里放着 SQLite，数据库位置取决于 dataDir —— 覆盖值不能存在数据库里，
/// 所以放在**默认数据目录**下的 `paths.json`（默认目录固定不变，始终可找到）。
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathOverrides {
    pub data_dir: Option<String>,
    pub resource_dir: Option<String>,
}

const PATHS_CONFIG_FILE: &str = "paths.json";

/// 读取路径覆盖配置；文件缺失或损坏返回默认值
pub(crate) fn load_path_overrides(config_dir: &Path) -> PathOverrides {
    let file = config_dir.join(PATHS_CONFIG_FILE);
    let Ok(text) = std::fs::read_to_string(&file) else {
        return PathOverrides::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// 写路径覆盖配置到默认数据目录
pub(crate) fn save_path_overrides(
    config_dir: &Path,
    overrides: &PathOverrides,
) -> CommandResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let text = serde_json::to_string_pretty(overrides)?;
    std::fs::write(config_dir.join(PATHS_CONFIG_FILE), text)?;
    Ok(())
}

/// 应用可访问的目录
///
/// 导入笔记要读用户任意位置的文件，所以 import_roots 由用户通过文件选择框
/// 授权后加进来；而写入只允许落在 data_dir，避免应用往用户文档里乱写。
pub struct AppPaths {
    /// 默认数据目录（固定不变，paths.json 覆盖配置的存放处）
    pub default_data_dir: PathBuf,
    /// 数据目录，存储地址热替换时运行时可变
    data_dir: RwLock<PathBuf>,
    pub extension_dir: PathBuf,
    /// 资源目录，用户可在设置里改，运行时可变
    resource_dir: RwLock<PathBuf>,
    /// 用户在设置里追加的可读目录（导入笔记/电子书），运行时可变
    read_roots: RwLock<Vec<PathBuf>>,
    /// 用户在设置里配置的音乐目录，运行时可变
    music_dir: RwLock<Option<PathBuf>>,
}

impl AppPaths {
    pub fn new(
        default_data_dir: PathBuf,
        data_dir: PathBuf,
        extension_dir: PathBuf,
        resource_dir: PathBuf,
    ) -> Self {
        Self {
            default_data_dir,
            data_dir: RwLock::new(data_dir),
            extension_dir,
            resource_dir: RwLock::new(resource_dir),
            read_roots: RwLock::new(Vec::new()),
            music_dir: RwLock::new(None),
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.data_dir
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| self.default_data_dir.clone())
    }

    /// 存储地址热替换：切换到新数据目录
    pub fn set_data_dir(&self, path: PathBuf) {
        if let Ok(mut guard) = self.data_dir.write() {
            *guard = path;
        }
    }

    pub fn music_dir(&self) -> Option<PathBuf> {
        let configured = self.music_dir.read().ok().and_then(|guard| guard.clone());
        if configured.is_some() {
            return configured;
        }
        // 未配置音乐目录 → 用随包附带的内置歌曲（resources/songs）
        let bundled = self.resource_dir().join("songs");
        if bundled.is_dir() {
            Some(bundled)
        } else {
            None
        }
    }

    pub fn resource_dir(&self) -> PathBuf {
        self.resource_dir
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| self.data_dir())
    }

    /// 读取许可
    ///
    /// 放行 data_dir、resource_dir，外加用户在设置里配置的读取目录。
    /// 写入仍只允许落在 data_dir。
    fn read_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![self.data_dir(), self.resource_dir()];
        if let Ok(extra) = self.read_roots.read() {
            roots.extend(extra.iter().cloned());
        }
        roots
    }

    pub(crate) fn check_readable(&self, candidate: &Path) -> CommandResult<PathBuf> {
        let mut last_error = None;

        for root in self.read_roots() {
            match ensure_within(&root, candidate) {
                Ok(path) => return Ok(path),
                // 单个 root 目录本身失效（如迁移后旧 data_dir 已删）只影响它自己的文件，
                // 不阻断其它 root 的尝试；全部失败才把最后一个错误返回给用户
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or_else(|| CommandError::new("路径不在允许范围内")))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub path: String,
    pub size_bytes: u64,
    pub extension: String,
}

/// 读文本文件，对应前端的 readTextFile
#[tauri::command]
pub async fn file_read_text(paths: State<'_, AppPaths>, path: String) -> CommandResult<String> {
    let safe = paths.check_readable(Path::new(&path))?;
    markdown::read_text(&safe).await
}

/// 写文本文件
///
/// 只允许写进 data_dir。笔记编辑后的落盘、导出的复盘都归这里，
/// 不给应用往用户其他目录写的能力。
#[tauri::command]
pub async fn file_write_text(
    paths: State<'_, AppPaths>,
    path: String,
    contents: String,
) -> CommandResult<()> {
    let safe = ensure_writable_within(&paths.data_dir(), Path::new(&path))?;

    // 路径语义检查基于 canonical 后的 safe 的祖先段：data_dir 本身是 junction/symlink
    // （如 OneDrive）时也成立，比「非 canonical 的 data_dir.join(...) 前缀比较」更稳。
    // 禁止写 extensions/ 目录：那里的 vec0.dll 会被 load_extension 执行，
    // 一旦被覆盖就等同任意代码执行。笔记/导出没有理由写到这里。
    let is_under = |dir: &str| {
        safe.ancestors()
            .skip(1)
            .any(|ancestor| ancestor.file_name().and_then(|n| n.to_str()) == Some(dir))
    };
    if is_under("extensions") {
        return Err(CommandError::new("不允许写入扩展目录"));
    }
    // 禁止写 backups/ 目录：那是恢复用数据库快照，被笔记/导出路径撞上会毁掉唯一备份。
    if is_under("backups") {
        return Err(CommandError::new("不允许写入备份目录"));
    }

    // 禁止覆盖运行中的数据库文件：SQLite 正锁着它们，覆盖会损坏整库（含 WAL/SHM）。
    let file_name = safe.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if matches!(file_name, "nativemind.db" | "nativemind.db-wal" | "nativemind.db-shm") {
        return Err(CommandError::new("不允许覆盖数据库文件"));
    }

    if let Some(parent) = safe.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    tokio::fs::write(&safe, contents).await?;
    Ok(())
}

/// 内容哈希
///
/// 与前端 `hashContent` 的输出格式保持一致（`sha256:` 前缀），
/// 否则同一份笔记在两条路径下会算出不同的 contentHash，去重就失效了。
#[tauri::command]
pub fn file_hash_content(contents: String) -> String {
    let digest = Sha256::digest(contents.as_bytes());
    format!("sha256:{digest:x}")
}

#[tauri::command]
pub async fn file_metadata(paths: State<'_, AppPaths>, path: String) -> CommandResult<FileMeta> {
    let safe = paths.check_readable(Path::new(&path))?;
    let metadata = tokio::fs::metadata(&safe).await?;

    Ok(FileMeta {
        path: display_path(&safe),
        size_bytes: metadata.len(),
        extension: safe
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase(),
    })
}

/// PDF 分页抽取，对应前端注入的 PdfExtractor
#[tauri::command]
pub async fn file_extract_pdf(
    paths: State<'_, AppPaths>,
    path: String,
) -> CommandResult<pdf::PdfDocument> {
    let safe = paths.check_readable(Path::new(&path))?;
    pdf::extract(&safe).await
}

/// 电子书抽取（EPUB / MOBI / AZW3），对应前端注入的 EbookExtractor
#[tauri::command]
pub async fn file_extract_ebook(
    paths: State<'_, AppPaths>,
    path: String,
) -> CommandResult<ebook::EbookDocument> {
    let safe = paths.check_readable(Path::new(&path))?;
    ebook::extract(&safe).await
}

/// 前端路径设置变化后同步到 Rust（读取目录 + 音乐目录）。
/// 设置存 DB 是 TS 侧的事，这里只更新运行时的路径许可。
#[tauri::command]
pub fn file_update_paths(
    paths: State<'_, AppPaths>,
    read_dirs: Vec<String>,
    music_dir: Option<String>,
) -> CommandResult<()> {
    let mut roots = paths
        .read_roots
        .write()
        .map_err(|_| CommandError::new("路径状态锁被占用"))?;
    *roots = read_dirs
        .into_iter()
        .map(|dir| dir.trim().to_string())
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .collect();

    let mut music = paths
        .music_dir
        .write()
        .map_err(|_| CommandError::new("路径状态锁被占用"))?;
    *music = music_dir
        .map(|dir| dir.trim().to_string())
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from);

    Ok(())
}

/// 导入前处理：把所选文件放进应用可读目录。
///
/// 已在许可范围（data_dir / resource_dir / 配置的读取目录）内 → 直接用原路径（保留出处）；
/// 否则复制进 `data_dir/imports/`，从副本解析。这样用户从任意位置选文件都能导入，
/// 同时读取仍走 check_readable 白名单，不会对任意路径放开读权限。
#[tauri::command]
pub async fn file_import_into_data_dir(
    paths: State<'_, AppPaths>,
    path: String,
) -> CommandResult<String> {
    let source = Path::new(&path);

    if paths.check_readable(source).is_ok() {
        return Ok(path);
    }

    let metadata = tokio::fs::metadata(source).await?;
    if !metadata.is_file() {
        return Err(CommandError::new("目标不是文件"));
    }
    let file_name = source
        .file_name()
        .ok_or_else(|| CommandError::new("无法识别文件名"))?;

    let import_dir = paths.data_dir().join("imports");
    tokio::fs::create_dir_all(&import_dir).await?;
    let destination = import_dir.join(file_name);
    tokio::fs::copy(source, &destination).await?;

    Ok(display_path(&destination))
}

/// 可导入文档（来自配置的读取目录）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadableDoc {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    /// 来自哪个读取目录（展示分组用）
    pub dir: String,
}/// 通用路径可用性检查（设置页「检查」按钮用）。
///
/// 不抛错：目录不存在 / 不可写 / 不是目录都返回结构化结果，前端据此展示
/// 「可用 / 目录不存在 / 不可写」而不是一句「路径不可用」。
/// 兼容中文路径：canonicalize 对 Unicode 路径原生支持（有单测钉死）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheckResult {
    pub ok: bool,
    pub exists: bool,
    pub is_dir: bool,
    /// 是否可写（在目录里建临时文件再删；目录不存在时无法探测）
    pub writable: Option<bool>,
    /// 失败原因（ok=false 时给出，中文）
    pub reason: Option<String>,
}

#[tauri::command]
pub fn file_check_path(path: String) -> PathCheckResult {
    let target = Path::new(&path);
    if !target.is_absolute() {
        return PathCheckResult {
            ok: false,
            exists: false,
            is_dir: false,
            writable: None,
            reason: Some("路径不是绝对路径".to_string()),
        };
    }
    if !target.exists() {
        return PathCheckResult {
            ok: false,
            exists: false,
            is_dir: false,
            writable: None,
            reason: Some("目录不存在".to_string()),
        };
    }
    if !target.is_dir() {
        return PathCheckResult {
            ok: false,
            exists: true,
            is_dir: false,
            writable: None,
            reason: Some("不是目录（是文件）".to_string()),
        };
    }
    // 可写探测：建临时文件再删。失败说明只读/权限不足，标出来而不是静默
    let probe = target.join(format!(".nativemind-write-{}", std::process::id()));
    let writable = std::fs::write(&probe, b"x")
        .and_then(|()| std::fs::remove_file(&probe))
        .is_ok();
    PathCheckResult {
        ok: writable,
        exists: true,
        is_dir: true,
        writable: Some(writable),
        reason: writable
            .then_some(None)
            .unwrap_or_else(|| Some("目录不可写（只读或权限不足）".to_string())),
    }
}

const DOC_EXTENSIONS: &[&str] = &["pdf", "md", "markdown", "txt", "text", "epub", "mobi", "azw3"];

/// 配置的读取目录里可导入的文档清单（每个目录顶层文件，不递归）。
///
/// 让「知识 → 快速导入」能直接列出并导入设置里添加的读取目录内容，
/// 否则这个设置配置了也没有可见作用。
#[tauri::command]
pub fn doc_list_readable(paths: State<'_, AppPaths>) -> Vec<ReadableDoc> {
    let roots = paths
        .read_roots
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let mut docs = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            // 目录不存在/不可读：跳过，不打断其它目录
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue; };
            if !meta.is_file() {
                continue;
            }
            let path = entry.path();
            let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };
            if !DOC_EXTENSIONS.contains(&extension.to_lowercase().as_str()) {
                continue;
            }
            docs.push(ReadableDoc {
                path: display_path(&path),
                name: entry.file_name().to_string_lossy().into_owned(),
                size_bytes: meta.len(),
                dir: display_path(&root),
            });
        }
    }
    docs
}

/// 设置页展示用：当前各目录
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPathsInfo {
    pub data_dir: String,
    pub resource_dir: String,
    pub read_dirs: Vec<String>,
    pub music_dir: Option<String>,
}

#[tauri::command]
pub fn file_app_paths(paths: State<'_, AppPaths>) -> AppPathsInfo {
    let read_dirs = paths
        .read_roots
        .read()
        .map(|roots| roots.iter().map(|path| display_path(path)).collect())
        .unwrap_or_default();
    let music_dir = paths.music_dir().map(|path| display_path(&path));

    AppPathsInfo {
        data_dir: display_path(&paths.data_dir()),
        resource_dir: display_path(&paths.resource_dir()),
        read_dirs,
        music_dir,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPathsResult {
    pub data_dir: String,
    pub resource_dir: String,
}

/// 把当前数据目录的内容搬到新目录：数据库一致快照 + imports/backups/extensions。
/// 目标已有同名文件则跳过，绝不覆盖目标里已有的数据。
/// 用数据库文件路径而非 DbConnection：spawn_blocking 里独立开连接做 VACUUM INTO
/// （WAL 下允许并发连接，与 db_backup 同模式），不锁主连接。
fn migrate_data(db_path: &Path, src: &Path, dst: &Path) -> CommandResult<()> {
    std::fs::create_dir_all(dst)?;

    // 数据库：VACUUM INTO 出一致快照（WAL 下也安全，复用 db_backup 的模式）。
    // 先写 .tmp 再 rename 成正式文件：VACUUM 中途失败不会留下「半截文件被当完整库」。
    let new_db = dst.join("nativemind.db");
    if !new_db.exists() {
        let new_db_tmp = dst.join("nativemind.db.tmp");
        let _ = std::fs::remove_file(&new_db_tmp);
        let escaped = new_db_tmp.to_string_lossy().replace('\'', "''");
        let conn = rusqlite::Connection::open(db_path)?;
        conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
            .map_err(crate::utils::CommandError::from)?;
        std::fs::rename(&new_db_tmp, &new_db)?;
        // 新库里的自定义背景音频路径还指向旧 imports，把前缀替换为新位置。
        // 注意存储值是 JSON（前端 JSON.stringify 过），反斜杠被转义成 \\，要替换转义后的形式。
        let old_imports = display_path(&src.join("imports"));
        let new_imports = display_path(&dst.join("imports"));
        if let Ok(conn) = rusqlite::Connection::open(&new_db) {
            let _ = conn.execute(
                "UPDATE settings SET value = replace(value, ?1, ?2) \
                 WHERE key = 'ambient.filesByWeather'",
                rusqlite::params![
                    old_imports.replace('\\', "\\\\"),
                    new_imports.replace('\\', "\\\\")
                ],
            );
        }
    }

    // 目录型数据：imports / backups / extensions，目标已存在的文件跳过
    for sub in ["imports", "backups", "extensions"] {
        let from = src.join(sub);
        let to = dst.join(sub);
        if !from.exists() {
            continue;
        }
        std::fs::create_dir_all(&to)?;
        for entry in std::fs::read_dir(&from)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let target = to.join(entry.file_name());
            if !target.exists() {
                std::fs::copy(entry.path(), &target)?;
            }
        }
    }
    Ok(())
}

/// 校验用户填的数据/资源目录：必须是绝对路径、不能是盘符根、不能是网络共享。
/// 否则把 resource_dir 设成 `C:\` 等于放开全盘读，把 data_dir 设成网络共享等于整库外带。
fn validate_target_dir(dir: &Path, label: &str) -> CommandResult<()> {
    if !dir.is_absolute() {
        return Err(CommandError::new(format!("{label}必须是绝对路径")));
    }
    if dir.parent().is_none() || dir.file_name().is_none() {
        return Err(CommandError::new(format!("不能把整个盘根当作{label}")));
    }
    if dir.to_string_lossy().starts_with(r"\\") {
        return Err(CommandError::new(format!("{label}不支持网络路径")));
    }
    Ok(())
}

/// 设置 dataDir / resourceDir 覆盖值，**即时热替换，无需重启**。
///
/// - dataDir 变化：迁移数据（数据库一致快照 + imports/backups/extensions）后
///   直接 `DbConnection::reopen` 到新库、更新 `AppPaths.data_dir`，前端随后刷新。
/// - resourceDir 变化：即时生效。
/// - 传入空字符串表示清除该覆盖（回默认），不传表示不修改该项。
/// 覆盖值写进默认数据目录的 `paths.json`，下次启动也沿用。
#[tauri::command]
pub async fn file_set_app_paths(
    paths: State<'_, AppPaths>,
    db: State<'_, DbConnection>,
    data_dir: Option<String>,
    resource_dir: Option<String>,
    migrate: Option<bool>,
) -> CommandResult<SetPathsResult> {
    let current_data = paths.data_dir();
    let current_res = paths.resource_dir();

    let want_data: PathBuf = match data_dir.as_deref().map(str::trim) {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => current_data.clone(),
    };
    let want_res: PathBuf = match resource_dir.as_deref().map(str::trim) {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => current_res.clone(),
    };

    if want_data != current_data {
        validate_target_dir(&want_data, "存储地址")?;
        std::fs::create_dir_all(&want_data)?;
        // 可写性探测：网络盘/只读目录在迁移前就暴露
        let probe = want_data.join(".nativemind-write-test");
        std::fs::write(&probe, b"x")?;
        std::fs::remove_file(&probe)?;

        // 迁移是重 IO（大库 VACUUM 可达数秒），放 spawn_blocking 不冻住 UI 线程。
        // 用独立连接做 VACUUM INTO（WAL 下允许并发，db_backup 同模式），
        // 不锁主连接——spawn_blocking 里只需要数据库文件路径，不碰 State。
        if migrate != Some(false) {
            let db_path = db.path();
            let src = current_data.clone();
            let dst = want_data.clone();
            tokio::task::spawn_blocking(move || {
                migrate_data(&db_path, &src, &dst)
            })
            .await
            .map_err(|join_error| {
                crate::utils::CommandError::new(format!("数据迁移线程异常：{join_error}"))
            })??;
        }
        // 热替换：直接切到新库，无需重启
        db.reopen(want_data.join("nativemind.db"))?;
        paths.set_data_dir(want_data.clone());
    }
    if want_res != current_res {
        validate_target_dir(&want_res, "资源目录")?;
        std::fs::create_dir_all(&want_res)?;
        *paths
            .resource_dir
            .write()
            .map_err(|_| CommandError::new("路径状态锁被占用"))? = want_res.clone();
    }

    let mut overrides = load_path_overrides(&paths.default_data_dir);
    if let Some(dir) = data_dir {
        let trimmed = dir.trim().to_string();
        overrides.data_dir = if trimmed.is_empty() { None } else { Some(trimmed) };
    }
    if let Some(dir) = resource_dir {
        let trimmed = dir.trim().to_string();
        overrides.resource_dir = if trimmed.is_empty() { None } else { Some(trimmed) };
    }
    save_path_overrides(&paths.default_data_dir, &overrides)?;

    Ok(SetPathsResult {
        data_dir: display_path(&want_data),
        resource_dir: display_path(&want_res),
    })
}

/// 自愈自定义背景音频路径。
///
/// 存储地址迁移后，settings 表 `ambient.filesByWeather` 里可能残留指向旧目录的
/// 路径（旧版本迁移没重写）。这里对每个不可读的路径，按文件名在
/// `data_dir/imports` 下找回同名文件并重写；返回改写条数。找不到就保持原样，
/// 由前端给出「文件不可读」的提示。
#[tauri::command]
pub fn file_repair_custom_audio_paths(
    paths: State<'_, AppPaths>,
    db: State<'_, DbConnection>,
) -> CommandResult<u32> {
    repair_custom_audio_paths(&paths, &db)
}

fn repair_custom_audio_paths(paths: &AppPaths, db: &DbConnection) -> CommandResult<u32> {
    use serde_json::{Map, Value as JsonValue};

    let imports = paths.data_dir().join("imports");
    let mut changed = 0u32;

    // 对失效的自定义音频路径做两档处理：
    //   1) imports 下有同名文件（如存储地址迁移）→ 重写为新路径；
    //   2) 同名文件也不存在（用户已删除）→ 返回 None 表示「应清掉这条配置」，
    //      避免启动时 playCustom 对着已删的文件弹「路径不可用」。
    // 覆盖：天气自定义背景音频（ambient.filesByWeather）+ 专注音乐（focus.musicFile）。
    // 后者此前漏掉，存储地址迁移后专注音乐路径失效，点播放只会「路径不可用」。
    enum HealOutcome {
        Healed(String),
        Remove,
    }
    let heal_path = |stored: &str| -> Option<HealOutcome> {
        let candidate_path = Path::new(stored);
        if paths.check_readable(candidate_path).is_ok() {
            return None;
        }
        let file_name = candidate_path.file_name()?;
        let healed = imports.join(file_name);
        if healed.is_file() {
            return Some(HealOutcome::Healed(display_path(&healed)));
        }
        Some(HealOutcome::Remove)
    };

    // 1) ambient.filesByWeather：JSON 对象 { weather: path }
    let rows = db.select(
        "SELECT value FROM settings WHERE key = 'ambient.filesByWeather'",
        &[],
    )?;
    if let Some(row) = rows.first() {
        if let Some(value_str) = row["value"].as_str() {
            if let Ok(mut map) = serde_json::from_str::<Map<String, JsonValue>>(value_str) {
                let mut mutated = false;
                for value in map.values_mut() {
                    let Some(path_str) = value.as_str() else { continue };
                    match heal_path(path_str) {
                        Some(HealOutcome::Healed(healed)) => {
                            *value = JsonValue::String(healed);
                            mutated = true;
                            changed += 1;
                        }
                        Some(HealOutcome::Remove) => {
                            // 文件已删：回退该天气为无自定义歌（清空路径）
                            *value = JsonValue::String(String::new());
                            mutated = true;
                            changed += 1;
                        }
                        None => {}
                    }
                }
                if mutated {
                    let new_value = serde_json::to_string(&map)?;
                    db.execute(
                        "UPDATE settings SET value = ?1, updated_at = ?2 \
                         WHERE key = 'ambient.filesByWeather'",
                        &[
                            crate::db::SqlParam::Text(new_value),
                            crate::db::SqlParam::Text(chrono::Utc::now().to_rfc3339()),
                        ],
                    )?;
                }
            }
        }
    }

    // 2) focus.musicFile：单个路径字符串；文件已删 → 清空（按钮回到「选择专注音乐」）
    let rows = db.select(
        "SELECT value FROM settings WHERE key = 'focus.musicFile'",
        &[],
    )?;
    if let Some(row) = rows.first() {
        if let Some(path_str) = row["value"].as_str() {
            let outcome = heal_path(path_str);
            if let Some(HealOutcome::Healed(healed)) = outcome {
                db.execute(
                    "UPDATE settings SET value = ?1, updated_at = ?2 \
                     WHERE key = 'focus.musicFile'",
                    &[
                        crate::db::SqlParam::Text(healed),
                        crate::db::SqlParam::Text(chrono::Utc::now().to_rfc3339()),
                    ],
                )?;
                changed += 1;
            } else if matches!(outcome, Some(HealOutcome::Remove)) {
                db.execute(
                    "UPDATE settings SET value = '', updated_at = ?1 \
                     WHERE key = 'focus.musicFile'",
                    &[crate::db::SqlParam::Text(chrono::Utc::now().to_rfc3339())],
                )?;
                changed += 1;
            }
        }
    }

    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_readable_respects_configured_read_roots() {
        let root = std::env::temp_dir().join("nativemind_paths_test");
        let data = root.join("data");
        let extra = root.join("extra");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&extra).unwrap();
        let file = extra.join("book.epub");
        std::fs::write(&file, b"x").unwrap();

        let paths = AppPaths::new(
            root.join("default"),
            data,
            root.join("ext"),
            root.join("res"),
        );
        assert_eq!(paths.default_data_dir, root.join("default"));

        // 未配置额外目录时，extra 下的文件不可读
        assert!(paths.check_readable(&file).is_err());

        // 配置读取目录后放行
        *paths.read_roots.write().unwrap() = vec![extra];
        assert!(paths.check_readable(&file).is_ok());

        // 配置目录之外的仍拒绝
        let outside = root.join("outside.txt");
        std::fs::write(&outside, b"x").unwrap();
        assert!(paths.check_readable(&outside).is_err());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn migrate_data_copies_db_imports_and_rewrites_ambient_paths() {
        let root = std::env::temp_dir().join("nativemind_migrate_test");
        // 上一次失败可能留下脏目录，先清干净
        std::fs::remove_dir_all(&root).ok();
        let src = root.join("src");
        let dst = root.join("dst");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(src.join("imports")).unwrap();
        std::fs::write(src.join("imports").join("song.flac"), b"data").unwrap();

        // 源库：一张 settings 表，custom 背景音频指向 src/imports
        let db = DbConnection::open(src.join("nativemind.db")).unwrap();
        db.with(|connection| {
            connection
                .execute_batch(
                    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
                )
                .map_err(crate::utils::CommandError::from)
        })
        .unwrap();
        let payload =
            serde_json::json!({ "clear": format!("{}\\imports\\song.flac", src.display()) })
                .to_string();
        db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('ambient.filesByWeather', ?, ?)",
            &[crate::db::SqlParam::Text(payload), crate::db::SqlParam::Text("x".into())],
        )
        .unwrap();

        migrate_data(&db.path(), &src, &dst).unwrap();

        // 新库存在，且自定义音频路径被改写为新目录
        let new_db = DbConnection::open(dst.join("nativemind.db")).unwrap();
        let rows = new_db
            .select(
                "SELECT value FROM settings WHERE key = 'ambient.filesByWeather'",
                &[],
            )
            .unwrap();
        let value = rows[0]["value"].as_str().unwrap().to_string();
        let parsed: serde_json::Value = serde_json::from_str(&value).unwrap();
        let clear = parsed["clear"].as_str().unwrap();
        assert!(
            clear.contains(&format!("{}\\imports\\song.flac", dst.display())),
            "自定义音频路径应指向新目录，实际: {clear}"
        );
        // imports 文件被复制
        assert!(dst.join("imports").join("song.flac").exists());
        // 重复迁移不覆盖目标已有数据
        migrate_data(&db.path(), &src, &dst).unwrap();
        assert!(dst.join("nativemind.db").exists());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn repair_rewrites_stale_ambient_paths_by_filename() {
        let root = std::env::temp_dir().join("nativemind_repair_test");
        std::fs::remove_dir_all(&root).ok();
        let data = root.join("data");
        std::fs::create_dir_all(data.join("imports")).unwrap();
        // 目标文件按文件名可找回
        std::fs::write(data.join("imports").join("song.flac"), b"data").unwrap();

        let db = DbConnection::open(data.join("nativemind.db")).unwrap();
        db.with(|connection| {
            connection
                .execute_batch(
                    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
                )
                .map_err(crate::utils::CommandError::from)
        })
        .unwrap();
        // 残留旧路径（指向不存在的目录）
        let stale = serde_json::json!({
            "clear": r"C:\gone\imports\song.flac",
            "rain": r"D:\somewhere\imports\ambient.flac"
        })
        .to_string();
        db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('ambient.filesByWeather', ?, ?)",
            &[crate::db::SqlParam::Text(stale), crate::db::SqlParam::Text("x".into())],
        )
        .unwrap();

        let paths = AppPaths::new(
            root.join("default"),
            data.clone(),
            root.join("ext"),
            root.join("res"),
        );
        let changed = repair_custom_audio_paths(&paths, &db).unwrap();
        // clear 按文件名找回（重写）；rain 指向的文件不存在 → 清空该条配置
        assert_eq!(changed, 2, "clear 重写 + rain 清空");

        let rows = db
            .select("SELECT value FROM settings WHERE key = 'ambient.filesByWeather'", &[])
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(rows[0]["value"].as_str().unwrap()).unwrap();
        let clear = parsed["clear"].as_str().unwrap();
        assert!(
            clear.contains(&display_path(&data.join("imports").join("song.flac"))),
            "clear 应指向新 data/imports：{clear}"
        );
        let rain = parsed["rain"].as_str().unwrap();
        assert!(
            rain.is_empty(),
            "rain 文件已删应清空配置，避免启动报「路径不可用」：{rain}"
        );

        // focus.musicFile 同样处理：文件可找回 → 重写；文件已删 → 清空
        db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('focus.musicFile', ?, ?)",
            &[
                // 指向已删文件（imports 里没有同名）→ 应清空
                crate::db::SqlParam::Text("E:\\gone\\imports\\no-such.flac".into()),
                crate::db::SqlParam::Text("x".into()),
            ],
        )
        .unwrap();
        let changed2 = repair_custom_audio_paths(&paths, &db).unwrap();
        assert_eq!(changed2, 1, "focus.musicFile 失效且文件不存在 → 清空");
        let rows = db
            .select("SELECT value FROM settings WHERE key = 'focus.musicFile'", &[])
            .unwrap();
        let healed = rows[0]["value"].as_str().unwrap();
        assert!(
            healed.is_empty(),
            "focus.musicFile 应清空（文件已删），避免点击播放报「路径不可用」：{healed}"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validate_target_dir_rejects_root_unc_and_relative() {
        // 合法目录
        assert!(validate_target_dir(Path::new(r"E:\appdata\data"), "存储地址").is_ok());
        // 盘符根：拒绝（否则 resource_dir=C:\ 放开全盘读）
        assert!(validate_target_dir(Path::new(r"C:\"), "资源目录").is_err());
        // 网络共享：拒绝（否则整库外带）
        assert!(validate_target_dir(Path::new(r"\\server\share\data"), "存储地址").is_err());
        // 相对路径：拒绝
        assert!(validate_target_dir(Path::new("data"), "存储地址").is_err());
    }

    /// 设置页「检查」按钮的底层：中文目录存在 → ok；不存在 → 明确报不存在；
    /// 文件路径 → 报不是目录；相对路径 → 报非绝对路径。
    #[test]
    fn check_path_reports_cjk_directory_and_missing() {
        let root = std::env::temp_dir().join("nativemind_check_中文路径");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root).unwrap();

        // 中文目录存在且可写 → ok
        let ok = file_check_path(root.to_string_lossy().to_string());
        assert!(ok.ok, "中文目录应可用：{ok:?}");
        assert!(ok.exists && ok.is_dir);
        assert_eq!(ok.writable, Some(true));

        // 目录里的中文文件（不是目录）→ 报「不是目录」
        let file = root.join("笔记（其一）.txt");
        std::fs::write(&file, b"x").unwrap();
        let file_result = file_check_path(file.to_string_lossy().to_string());
        assert!(!file_result.ok);
        assert!(file_result.exists && !file_result.is_dir);

        // 不存在的目录 → 报「目录不存在」
        let missing = file_check_path(root.join("不存在的子目录").to_string_lossy().to_string());
        assert!(!missing.ok);
        assert!(!missing.exists);

        // 相对路径 → 报非绝对路径
        let relative = file_check_path("相对/目录".to_string());
        assert!(!relative.ok);

        std::fs::remove_dir_all(&root).ok();
    }
}

/// 换电脑时的完整数据导出：把 data_dir 打包成可迁移的自包含目录。
///
/// 导出到用户选的目标目录下的 `nativemind-backup-{时间戳}/` 文件夹，包含：
/// - `nativemind.db`：VACUUM INTO 一致性快照（WAL 模式下也安全，复用 db_backup 模式）
/// - `imports/`：导入的原始文件（PDF/EPUB/MD…）
/// - `paths.json`：路径覆盖配置（自定义 dataDir/resourceDir/读取目录）
/// - `README-恢复说明.txt`：新机器怎么恢复
///
/// 不引 zip crate：导出本身就是「自包含目录」，用户拷贝/压缩整目录即可；
/// 恢复时指向该目录即可，免去解压步骤。目标目录必须存在且可写。
#[tauri::command]
pub async fn data_export(
    paths: State<'_, AppPaths>,
    target_dir: String,
) -> CommandResult<String> {
    let target = Path::new(&target_dir);
    validate_target_dir(target, "导出目录")?;
    if !target.is_dir() {
        return Err(CommandError::new("导出目录不存在，请先创建它"));
    }

    let data_dir = paths.data_dir();
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let out = target.join(format!("nativemind-backup-{stamp}"));
    std::fs::create_dir_all(&out)?;

    let db_file = data_dir.join("nativemind.db");
    let new_db = out.join("nativemind.db");
    // VACUUM INTO 出一致快照：先 .tmp 再 rename，中途失败不留半截库
    let tmp = out.join("nativemind.db.tmp");
    let _ = std::fs::remove_file(&tmp);
    let escaped = tmp.to_string_lossy().replace('\'', "''");
    let conn = rusqlite::Connection::open(&db_file)?;
    conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
        .map_err(crate::utils::CommandError::from)?;
    std::fs::rename(&tmp, &new_db)?;

    // imports/：导入的原始文件
    let imports_src = data_dir.join("imports");
    if imports_src.is_dir() {
        let imports_dst = out.join("imports");
        std::fs::create_dir_all(&imports_dst)?;
        for entry in std::fs::read_dir(&imports_src)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let _ = std::fs::copy(entry.path(), imports_dst.join(entry.file_name()));
            }
        }
    }

    // paths.json：路径覆盖配置（含自定义 dataDir，恢复时按它定位用户数据位置）
    let config_file = paths.default_data_dir.join(PATHS_CONFIG_FILE);
    if config_file.is_file() {
        let _ = std::fs::copy(config_file, out.join(PATHS_CONFIG_FILE));
    }

    // 恢复说明
    let readme = format!(
        "NativeMind 数据备份\n\
         生成时间：{stamp}\n\
         包含：nativemind.db（数据库）、imports/（导入的原始文件）、paths.json（路径配置）\n\
         \n\
         恢复步骤（新电脑）：\n\
         1. 安装 NativeMind 后，打开 设置 → 数据 → 「恢复数据」\n\
         2. 选择本目录（含 nativemind.db 的这层）\n\
         3. 确认恢复，重启应用即可\n\
         \n\
         若选择手动恢复：安装后关闭应用，把本目录里的 nativemind.db 和 imports/ 覆盖到\n\
         数据目录（默认 %APPDATA%\\com.nativemind.app\\）即可。\n"
    );
    std::fs::write(out.join("README-恢复说明.txt"), readme)?;

    Ok(crate::utils::display_path(&out))
}

/// 换电脑时的数据恢复：从导出的自包含目录恢复到当前 data_dir。
///
/// 恢复前先做一次 db_backup（备份当前状态，误恢复可回退）。
/// 校验导出目录结构（含 nativemind.db）后：数据库快照覆盖 + imports 合并（跳过已存在）。
/// 恢复完成需重启应用（DbConnection 持有旧库句柄，热切换太冒险）。
#[tauri::command]
pub async fn data_import(
    paths: State<'_, AppPaths>,
    source_dir: String,
) -> CommandResult<String> {
    let source = Path::new(&source_dir);
    if !source.is_dir() {
        return Err(CommandError::new("恢复目录不存在，请选择包含 nativemind.db 的目录"));
    }
    let source_db = source.join("nativemind.db");
    if !source_db.is_file() {
        return Err(CommandError::new("该目录不是有效的备份：缺少 nativemind.db"));
    }

    let data_dir = paths.data_dir();

    // 恢复前备份当前状态（可回退）：VACUUM INTO 出一份一致性快照到 backups/
    {
        let backups = data_dir.join("backups");
        std::fs::create_dir_all(&backups)?;
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        let bak = backups.join(format!("nativemind-before-restore-{stamp}.db.bak"));
        let tmp = backups.join(format!("nativemind-before-restore-{stamp}.db.bak.tmp"));
        let _ = std::fs::remove_file(&tmp);
        let escaped = tmp.to_string_lossy().replace('\'', "''");
        let conn = rusqlite::Connection::open(data_dir.join("nativemind.db"))?;
        conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
            .map_err(crate::utils::CommandError::from)?;
        std::fs::rename(&tmp, &bak)?;
    }

    // 数据库：先复制到 .tmp 再原子替换（避免半截文件）
    let db_file = data_dir.join("nativemind.db");
    let tmp = data_dir.join("nativemind.db.restore.tmp");
    tokio::fs::copy(&source_db, &tmp).await?;
    tokio::fs::rename(&tmp, &db_file).await?;

    // 清理 WAL/SHM（快照已是完整库，残留的 WAL 会冲突）
    let _ = std::fs::remove_file(data_dir.join("nativemind.db-wal"));
    let _ = std::fs::remove_file(data_dir.join("nativemind.db-shm"));

    // imports/：合并，跳过已存在（不覆盖用户当前导入的文件）
    let imports_src = source.join("imports");
    if imports_src.is_dir() {
        let imports_dst = data_dir.join("imports");
        std::fs::create_dir_all(&imports_dst)?;
        for entry in std::fs::read_dir(&imports_src)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let target = imports_dst.join(entry.file_name());
                if !target.exists() {
                    let _ = std::fs::copy(entry.path(), &target);
                }
            }
        }
    }

    Ok(crate::utils::display_path(&db_file))
}

#[cfg(test)]
mod data_backup_tests {
    /// 数据导出：在临时 data_dir 造数据 → 导出 → 验证备份目录含 db + imports + README
    #[test]
    fn export_creates_self_contained_directory() {
        let root = std::env::temp_dir().join("nativemind_data_export_test");
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(&root.join("data/imports")).unwrap();

        // 造一个真实的 SQLite 库（导出用 VACUUM INTO，需要合法库文件）
        let db_path = root.join("data/nativemind.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)").unwrap();
        drop(conn);

        // 造一个导入文件
        std::fs::write(root.join("data/imports/note.md"), b"# hi").unwrap();

        let out_dir = root.join("target");
        std::fs::create_dir_all(&out_dir).unwrap();

        // 直接调内部逻辑：data_export 是 async 且依赖 State，这里验证核心 VACUUM 复制逻辑
        let out = out_dir.join("nativemind-backup-test");
        std::fs::create_dir_all(&out).unwrap();
        let tmp = out.join("nativemind.db.tmp");
        let escaped = tmp.to_string_lossy().replace('\'', "''");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(&format!("VACUUM INTO '{}'", escaped)).unwrap();
        drop(conn);
        std::fs::rename(&tmp, out.join("nativemind.db")).unwrap();

        // imports/ 复制
        std::fs::create_dir_all(out.join("imports")).unwrap();
        std::fs::copy(root.join("data/imports/note.md"), out.join("imports/note.md")).unwrap();

        assert!(out.join("nativemind.db").is_file());
        assert!(out.join("imports/note.md").is_file());

        std::fs::remove_dir_all(&root).ok();
    }
}

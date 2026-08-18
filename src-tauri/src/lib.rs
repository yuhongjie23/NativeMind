//! NativeMind Tauri 后端
//!
//! 职责边界（对应 C2 依赖单向、C7 可替换实现）：
//!
//! Rust 负责的是「浏览器做不到或做不好」的事 —— SQLite 事务、文件 IO、
//! 动态库加载、绕开 WebView 的 HTTP。业务规则、领域模型、迁移定义、
//! 文本解析全部留在 TS 侧，那里有完整的单元测试且不依赖 Tauri 运行时。
//!
//! 所以这一层刻意很薄：它不认识 Todo、Note、FocusSession，只认识
//! SQL 字符串、文件路径和 HTTP 请求。加功能时先问一句「这件事前端能不能做」，
//! 能做就别放进来。

mod commands;
mod db;
mod file_parser;
mod model_client;
mod utils;
mod vector;

use std::io::{Read, Write};
use std::path::PathBuf;

use tauri::Manager;

use crate::commands::file::load_path_overrides;
use crate::commands::AppPaths;
use crate::db::DbConnection;
use crate::model_client::OllamaClient;

/// 应用数据目录
///
/// 默认取系统标准位置；若默认数据目录下有 `paths.json` 覆盖配置（用户在设置里
/// 改过存储地址），则用覆盖值。拿不到（权限异常、路径解析失败）时不能退到当前
/// 工作目录：开发和打包后的 cwd 完全不同，会导致用户数据写进随机位置。
/// 这种情况直接 panic 更安全 —— 带着错误的数据目录跑起来才是真麻烦。
fn resolve_data_dir(handle: &tauri::AppHandle) -> PathBuf {
    let default = handle
        .path()
        .app_data_dir()
        .expect("无法确定应用数据目录，请检查系统权限");
    load_path_overrides(&default)
        .data_dir
        .map(PathBuf::from)
        .unwrap_or(default)
}

/// 单实例守卫端口列表（仅本机回环）。
/// 所有实例按同一顺序争抢端口：抢占成功 = 本实例在跑；握手确认已有 NativeMind = 本次启动退出。
/// 端口被其它软件占用则顺延，避免「某软件占了 57432 就永远打不开应用」。
const SINGLE_INSTANCE_PORTS: [u16; 5] = [57432, 57433, 57434, 57435, 57436];

/// 客户端握手魔数。Guard 线程收到同样魔数回写，用于区分「是 NativeMind」还是别的软件。
const SINGLE_INSTANCE_TOKEN: &[u8; 10] = b"NATIVEMIND";

/// 探测某端口是否已有 NativeMind 在监听（连接成功 + 收到魔数回复）。
fn single_instance_probe(port: u16) -> bool {
    let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(300)));
    let _ = stream.write_all(SINGLE_INSTANCE_TOKEN);
    let mut buf = [0u8; SINGLE_INSTANCE_TOKEN.len()];
    matches!(
        stream.read(&mut buf),
        Ok(n) if n == SINGLE_INSTANCE_TOKEN.len() && &buf[..n] == SINGLE_INSTANCE_TOKEN.as_slice()
    )
}

/// 占住端口：绑定成功则起一个守护线程持有监听 + 应答握手，返回 true。
/// 守护线程在进程退出时随之结束，端口自动释放。
fn spawn_single_instance_guard(port: u16) -> bool {
    let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", port)) else {
        return false;
    };
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut buf = [0u8; SINGLE_INSTANCE_TOKEN.len()];
            let _ = (&stream).read(&mut buf);
            let _ = (&stream).write_all(SINGLE_INSTANCE_TOKEN);
        }
    });
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例守卫：std-only，不引第三方 crate（本机网络受限，无法拉取 tauri-plugin-single-instance）。
    // 关键：所有实例争抢同一组端口，绝不允许「顺延到别的端口」导致两个窗口都跑起来。
    for port in SINGLE_INSTANCE_PORTS {
        if single_instance_probe(port) {
            std::process::exit(0); // 已有 NativeMind 在跑，不叠窗口
        }
        if spawn_single_instance_guard(port) {
            break; // 本实例成功占住该端口，继续启动
        }
        // 绑定失败 → 再探测一次：刚被抢走（两个实例竞速）→ 确认是 NativeMind 就退出；
        // 仍是别的软件占用 → 顺延到下一端口
        if single_instance_probe(port) {
            std::process::exit(0);
        }
    }

    tauri::Builder::default()
        // 文件选择对话框：前端「导入文件」的入口
        .plugin(tauri_plugin_dialog::init())
        // 系统通知：专注结束等需要切到别的应用也能感知的场景
        .plugin(tauri_plugin_notification::init())
        // 外部链接：知识页外部搜索结果点开在系统浏览器观看
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle();
            let data_dir = resolve_data_dir(handle);

            // 默认数据目录固定不变，是 paths.json 覆盖配置的存放处
            let default_data_dir = handle
                .path()
                .app_data_dir()
                .expect("无法确定应用数据目录，请检查系统权限");
            std::fs::create_dir_all(&default_data_dir)?;
            std::fs::create_dir_all(&data_dir)?;

            // 资源目录：优先取覆盖配置；拿不到时退回 data_dir —— 音频缺失只会
            // 让播放静默失败，不至于影响核心功能，没必要为它中断启动
            let overrides = load_path_overrides(&default_data_dir);
            let resource_dir = overrides
                .resource_dir
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    handle
                        .path()
                        .resource_dir()
                        .unwrap_or_else(|_| data_dir.clone())
                });

            let extension_dir = data_dir.join("extensions");
            std::fs::create_dir_all(&extension_dir)?;

            // 音频目录骨架：安装包体积限制（<2GB NSIS）不内嵌背景音乐，
            // 但安装后要有一个明确的「默认背景音乐路径」让用户放置文件。
            // 这里自动创建 audio/backgrounds（场景环境音/背景音乐）与 audio/songs
            // （音乐库兜底）等目录，创建失败静默 —— 资源目录不可写只影响背景音乐，
            // 不应因此中断启动（与 audio 缺失静默播放的既有逻辑一致）。
            for sub in ["backgrounds", "ambient", "cue", "companion"] {
                let _ = std::fs::create_dir_all(resource_dir.join("audio").join(sub));
            }
            let _ = std::fs::create_dir_all(resource_dir.join("songs"));

            // 把随包分发的 vec0 动态库放进 extensions 目录（若还没有），
            // 否则 sqlite-vec 加载不到、RAG 只能降级关键词检索。
            // 安全：vec0.dll 只会从应用自带的捆绑资源目录取，绝不从用户可改的
            // resource_dir 覆盖值取 —— 否则把资源目录指向含恶意 DLL 的目录即 RCE。
            let bundle_dir = handle
                .path()
                .resource_dir()
                .unwrap_or_else(|_| data_dir.clone());
            let bundled_vec = bundle_dir.join("vec0.dll");
            let dest_vec = extension_dir.join("vec0.dll");
            // 每次启动都从捆绑目录覆盖 extensions/vec0.dll：load_extension 会执行它，
            // 一旦被预置/替换成恶意 DLL 就是任意代码执行（file_write_text 已禁写该目录，
            // 这里是第二道保险）。覆盖发生在 load 之前，文件未被锁。
            if bundled_vec.exists() {
                let _ = std::fs::copy(&bundled_vec, &dest_vec);
            }

            // 打开数据库。这里**不跑迁移**：迁移由前端 Database.migrate() 驱动，
            // 版本表和 SQL 都在 TS 侧，见 db/migrations.rs 的说明
            let connection = DbConnection::open(data_dir.join("nativemind.db"))?;

            // sqlite-vec 是可选扩展，加载失败只记日志，
            // 前端 SqliteVecProvider 探测到不可用会降级到关键词检索（C3）
            if let Ok(status) = crate::vector::sqlite_vec::load_quietly(&connection, &extension_dir)
            {
                if status.available {
                    println!("[vector] sqlite-vec 已加载");
                }
            }

            app.manage(connection);

            app.manage(AppPaths::new(
                default_data_dir,
                data_dir.clone(),
                extension_dir,
                resource_dir,
            ));
            // 默认连本机 Ollama。地址非本机时 new 会失败，这属于配置错误，
            // 应当在启动阶段就暴露出来
            app.manage(OllamaClient::new(None)?);

            // 沉浸式全屏兜底：窗口装饰始终跟随全屏状态（全屏→无标题栏，退出→恢复）。
            // 不依赖前端调用入口，任何方式进入全屏都会生效。
            if let Some(window) = app.get_webview_window("main") {
                crate::commands::window::sync_decorations_with_fullscreen(&window);
            }

            // 托盘图标 + 专注倒计时提示：每 30 秒查活动会话，更新 tooltip。
            // 表可能还没迁移（迁移由前端跑），查不到就保持默认提示，不报错。
            {
                let mut tray_builder =
                    tauri::tray::TrayIconBuilder::with_id("main").tooltip("NativeMind");
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                let tray = tray_builder.build(app)?;

                // 每次从托管状态取当前 DB 路径：存储地址热替换后托盘读的是新库，
                // 而不是启动时固定的旧路径
                let app_handle = app.handle().clone();
                let tray_handle = tray.clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
                    loop {
                        interval.tick().await;
                        let db_path = app_handle.state::<DbConnection>().path();
                        let tooltip = match focus_remaining_minutes(&db_path) {
                            Some(remaining) => format!("专注剩余 {remaining} 分钟 · NativeMind"),
                            None => "NativeMind".to_string(),
                        };
                        let _ = tray_handle.set_tooltip(Some(tooltip));
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // db：命令名与前端 TauriSqlDriver 的默认值对齐，改名会断掉所有 Repository
            commands::db::db_select,
            commands::db::db_execute,
            commands::db::db_schema_status,
            commands::db::db_integrity_check,
            commands::db::db_path,
            commands::db::db_backup,
            // file
            commands::file::file_read_text,
            commands::file::file_write_text,
            commands::file::file_hash_content,
            commands::file::file_metadata,
            commands::file::file_extract_pdf,
            commands::file::file_extract_ebook,
            commands::file::file_update_paths,
            commands::file::doc_list_readable,
            commands::file::file_check_path,
            commands::file::file_app_paths,
            commands::file::file_set_app_paths,
            commands::file::file_repair_custom_audio_paths,
            commands::file::file_import_into_data_dir,
            commands::file::data_export,
            commands::file::data_import,
            // model
            commands::model::model_is_ready,
            commands::model::ollama_ensure_running,
            commands::model::model_list,
            commands::model::model_is_available,
            commands::model::model_complete,
            commands::model::model_complete_stream,
            commands::model::model_embed,
            // vector：前端 SqliteVecProvider.isAvailable() 靠它决定是否降级
            commands::vector::vector_status,
            commands::vector::vector_extension_dir,
            // audio：内置环境音/提示音 + 用户音乐目录
            commands::audio::audio_list_assets,
            commands::audio::audio_root,
            commands::audio::audio_list_music,
            commands::audio::audio_read,
            commands::audio::audio_read_imported,
            commands::audio::bgm_read,
            // search：前端外部搜索的唯一出站通道
            commands::search::search_fetch,
            // window：沉浸式全屏（隐藏系统装饰）
            commands::window::window_is_fullscreen,
            commands::window::window_toggle_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

/// 查当前活动专注会话，返回剩余分钟数（无活动/查询失败返回 None）
fn focus_remaining_minutes(db_path: &std::path::Path) -> Option<i64> {
    use rusqlite::OpenFlags;

    let connection =
        rusqlite::Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let (started_at, duration_minutes): (String, i64) = connection
        .query_row(
            "SELECT started_at, duration_minutes FROM focus_sessions
             WHERE status = 'active' ORDER BY started_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()?;

    let started = chrono::DateTime::parse_from_rfc3339(&started_at)
        .ok()?
        .with_timezone(&chrono::Utc);
    let elapsed_minutes = (chrono::Utc::now() - started).num_minutes();
    Some((duration_minutes - elapsed_minutes).max(0))
}

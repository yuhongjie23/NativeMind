use crate::{
    db::DbConnection,
    model_client::OllamaClient,
    utils::{CommandError, CommandResult},
};
use serde_json::{json, Value};
use std::path::PathBuf;

pub struct Backend {
    jobs: crate::model_jobs::ModelJobs,
    file_jobs: crate::file_jobs::FileJobs,
    db: DbConnection,
    model: OllamaClient,
    root: PathBuf,
    owner: Option<crate::window_session::WindowSession>,
    vector: crate::vector::sqlite_vec::VectorStatus,
    // Keep this last so the directory stays reserved until other fields drop.
    _directory_lock: rusqlite::Connection,
}

fn string<'a>(args: &'a Value, key: &str) -> CommandResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new(format!("Missing {key}")))
}

impl Backend {
    pub fn new(root: PathBuf) -> CommandResult<Self> {
        let directory_lock = crate::runtime_lock::acquire(&root)?;
        crate::archive::apply_pending(&root)?;
        std::fs::create_dir_all(root.join("imports"))?;
        std::fs::create_dir_all(root.join("music"))?;
        crate::file_transfer::cleanup_stale(&root)?;
        let db = DbConnection::open(root.join("nativemind.db"))?;
        if let Err(error) = crate::import_cleanup::cleanup(&root, &db) {
            eprintln!("Unused import cleanup skipped: {error}");
        }
        let extensions = crate::runtime_paths::resource_dir(&std::env::current_exe()?)?;
        let vector = crate::vector::sqlite_vec::load_quietly(&db, &extensions)?;
        db.with(|connection| {
            crate::sql_policy::install(connection);
            Ok(())
        })?;
        Ok(Self {
            jobs: Default::default(),
            file_jobs: Default::default(),
            db,
            model: OllamaClient::new(None)?,
            root,
            owner: None,
            vector,
            _directory_lock: directory_lock,
        })
    }

    pub fn reap_jobs(&mut self) { self.jobs.reap(); self.file_jobs.reap(); }

    fn release_window(&mut self) -> CommandResult<()> {
        self.db.with(|connection| {
            if !connection.is_autocommit() { connection.execute_batch("ROLLBACK")?; }
            Ok(())
        })?;
        // Dropping jobs aborts HTTP tasks and terminates disposable parser processes.
        self.jobs = Default::default();
        self.file_jobs = Default::default();
        self.owner = None;
        Ok(())
    }

    pub async fn invoke(&mut self, args: &Value) -> CommandResult<Value> {
        let client = string(args, "clientId")?;
        if client.is_empty() || client.len() > 256 || client.chars().any(char::is_control) {
            return Err(CommandError::new("Missing Anna window identity"));
        }
        let command = string(args, "command")?;
        if command == "native_connect" {
            // A repeated handshake may resume only with proof of the current lease.
            // A caller-controlled window name is never enough to retrieve its secret.
            if args.get("leaseToken").is_some() {
                let owner = self.owner.as_mut().ok_or_else(|| CommandError::new("ANNA_SESSION_EXPIRED: 连接已关闭，请重新打开页面"))?;
                owner.authorize(client, args["leaseToken"].as_str())?;
                return Ok(json!({"leaseToken":owner.token,"protocolVersion":2}));
            }
            if let Some(owner) = &self.owner {
                if !owner.expired() { return Err(CommandError::new("ANNA_WINDOW_BUSY: 另一个 Anna 页面正在使用本地数据，请先关闭该页面")); }
                self.release_window()?;
            }
            let owner = crate::window_session::WindowSession::new(client)?;
            let token = owner.token.clone();
            self.owner = Some(owner);
            return Ok(json!({"leaseToken":token,"protocolVersion":2}));
        }
        // Allow only this read-only health probe without a connection; package tooling uses it.
        if command == "native_status" && args.get("leaseToken").is_none() {
            return Ok(json!({"mode":"local-development", "database":"sqlite", "model":"ollama", "publishReady":false,
                "protocolVersion":2, "vector":{"available":self.vector.available}}));
        }
        self.owner.as_mut().ok_or_else(|| CommandError::new("ANNA_SESSION_EXPIRED: 请先连接本地服务"))?
            .authorize(client, args["leaseToken"].as_str())?;
        if command == "native_heartbeat" { return Ok(json!({"ok":true})); }
        if command == "native_disconnect" {
            self.release_window()?;
            return Ok(json!({"ok":true}));
        }
        if command == "data_restore_status" {
            return crate::restore_recovery::status(&self.root);
        }
        if self.root.join("restore-request.json").exists() {
            return Err(CommandError::new(
                "恢复已准备好，请重启 Anna 本地开发环境后重新打开应用",
            ));
        }
        let payload = args.get("args").cloned().unwrap_or_else(|| json!({}));
        match command {
            "model_job_start" => self.jobs.start(&payload),
            "model_job_poll" => self.jobs.poll(&payload),
            "model_job_cancel" => Ok(self.jobs.cancel(&payload)),
            "search_fetch" => {
                let url = string(&payload, "url")?;
                let parsed =
                    reqwest::Url::parse(url).map_err(|_| CommandError::new("搜索地址无效"))?;
                if parsed.scheme() != "https"
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.port().is_some_and(|port| port != 443)
                    || !matches!(
                        parsed.host_str(),
                        Some("www.bing.com" | "cn.bing.com" | "www.googleapis.com")
                    )
                {
                    return Err(CommandError::new(
                        "Anna 开发版只允许已支持的 HTTPS 搜索引擎地址",
                    ));
                }
                Ok(serde_json::to_value(
                    crate::search_http::search_fetch(url.to_owned()).await?,
                )?)
            }
            "data_export_local" => crate::archive::export(&self.root, &self.db.path()).await,
            "data_list_exports" => crate::archive::list(&self.root),
            "data_import_local" => crate::archive::import(&self.root, string(&payload, "path")?),
            "data_restore_local" => {
                crate::archive::schedule_restore(
                    &self.root,
                    &self.db.path(),
                    string(&payload, "id")?,
                )
                .await
            }
            "storage_check" => Ok(crate::startup_check::storage(&self.root)),
            "learning_notifications_sync" => {
                let reminders: Vec<crate::learning_notifications::ScheduledReminder> = serde_json::from_value(payload.get("reminders").cloned().unwrap_or(json!([])))?;
                let root = self.root.clone();
                tokio::task::spawn_blocking(move || crate::learning_notifications::sync(&root, &reminders)).await
                    .map_err(|_| CommandError::new("系统提醒任务中断"))?
            }
            "native_status" => Ok(
                json!({"mode":"local-development", "database":"sqlite", "model":"ollama", "publishReady":false, "protocolVersion":2, "vector":self.vector}),
            ),
            "db_select" | "db_execute" => {
                let sql = string(&payload, "sql")?;
                let params: Vec<crate::db::SqlParam> = serde_json::from_value(
                    payload.get("params").cloned().unwrap_or_else(|| json!([])),
                )?;
                if command == "db_select" {
                    self.db.with(|connection| {
                        if !connection.prepare(sql)?.readonly() {
                            return Err(CommandError::new("db_select only permits read-only queries"));
                        }
                        Ok(())
                    })?;
                    Ok(serde_json::to_value(self.db.select(sql, &params)?)?)
                } else {
                    Ok(json!(self.db.execute(sql, &params)?))
                }
            }
            "db_path" => Ok(json!(crate::utils::display_path(&self.db.path()))),
            "db_backup" => Ok(json!(
                crate::db::backup::create_snapshot(self.db.path(), self.root.join("backups"))
                    .await?
            )),
            "db_schema_status" => Ok(serde_json::to_value(crate::db::migrations::schema_status(
                &self.db,
            )?)?),
            "db_integrity_check" => Ok(json!(crate::db::migrations::integrity_check(&self.db)?)),
            "model_is_ready" => Ok(json!(self.model.is_ready().await)),
            "model_list" => Ok(serde_json::to_value(self.model.list_models_checked().await?)?),
            "model_is_available" => {
                let name = string(&payload, "model")?;
                let target = name.trim_end_matches(":latest");
                Ok(json!(self
                    .model
                    .list_models()
                    .await
                    .iter()
                    .any(|m| m.name == name
                        || m.name.trim_end_matches(":latest") == target
                        || m.name.starts_with(&format!("{target}-")))))
            }
            "model_complete" => Ok(json!(
                self.model
                    .complete(serde_json::from_value(
                        payload
                            .get("request")
                            .cloned()
                            .ok_or_else(|| CommandError::new("Missing request"))?
                    )?)
                    .await?
            )),
            "model_embed" => {
                let texts: Vec<String> = serde_json::from_value(
                    payload
                        .get("texts")
                        .cloned()
                        .ok_or_else(|| CommandError::new("Missing texts"))?,
                )?;
                Ok(json!(
                    self.model.embed(string(&payload, "model")?, &texts).await?
                ))
            }
            "file_app_paths" => Ok(
                json!({"dataDir":crate::utils::display_path(&self.root), "resourceDir":"", "readDirs":[]}),
            ),
            // Desktop folder permissions must not be imported into an Anna-hosted app.
            "file_update_paths" => {
                if payload
                    .get("readDirs")
                    .and_then(Value::as_array)
                    .is_some_and(|v| !v.is_empty())
                    || payload
                        .get("musicDir")
                        .and_then(Value::as_str)
                        .is_some_and(|v| !v.is_empty())
                {
                    return Err(CommandError::new(
                        "Anna 版请使用文件选择导入，不开放任意本地目录",
                    ));
                }
                Ok(Value::Null)
            }
            "file_read_text" | "file_extract_pdf" | "file_extract_ebook" => {
                let path = crate::utils::ensure_within(
                    &self.root.join("imports"),
                    &PathBuf::from(string(&payload, "path")?),
                )?;
                match command {
                    "file_read_text" => Ok(json!(tokio::fs::read_to_string(path).await?)),
                    "file_extract_pdf" => Ok(serde_json::to_value(
                        crate::file_parser::pdf::extract(&path).await?,
                    )?),
                    _ => Ok(serde_json::to_value(
                        crate::file_parser::ebook::extract(&path).await?,
                    )?),
                }
            }
            "file_job_start" => self.file_jobs.start(&self.root, &payload),
            "file_job_poll" => self.file_jobs.poll(&payload),
            "file_job_cancel" => self.file_jobs.cancel(&payload),
            "file_stage" => crate::file_transfer::stage(&self.root, &payload),
            "file_stage_commit" => crate::file_transfer::commit(&self.root, &payload),
            "file_stage_abort" => crate::file_transfer::abort(&self.root, &payload),
            "audio_list_music" => crate::audio::list(&self.root),
            "video_read_chunk" => crate::local_media::read_chunk(&self.root,
                payload["path"].as_str().ok_or_else(|| CommandError::new("Missing path"))?,
                payload["offset"].as_u64().ok_or_else(|| CommandError::new("Missing offset"))?),
            "audio_read_chunk" => crate::audio::read_chunk(&self.root, &payload),
            _ => Err(CommandError::new(format!(
                "Anna 尚未适配原生命令：{command}"
            ))),
        }
    }

}

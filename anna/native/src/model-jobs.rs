//! Model work runs outside the serialized database command queue.
use crate::{
    model_client::OllamaClient,
    utils::{CommandError, CommandResult},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::task::JoinHandle;

#[derive(Default)]
struct Output {
    text: String,
    result: Option<Result<Value, String>>,
}
struct Job {
    output: Arc<Mutex<Output>>,
    task: JoinHandle<()>,
    touched: Instant,
}
impl Drop for Job {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[derive(Default)]
pub struct ModelJobs {
    jobs: HashMap<String, Job>,
}

impl ModelJobs {
    pub fn reap(&mut self) {
        // Closing a window or losing the connection must not leave generation running.
        self.jobs
            .retain(|_, job| job.touched.elapsed() < Duration::from_secs(30));
    }
    pub fn start(&mut self, args: &Value) -> CommandResult<Value> {
        self.reap();
        let id = args["id"]
            .as_str()
            .ok_or_else(|| CommandError::new("Missing job id"))?;
        if id.len() != 36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
            return Err(CommandError::new("Invalid job id"));
        }
        if self.jobs.len() >= 8 || self.jobs.contains_key(id) {
            return Err(CommandError::new("模型任务过多，请等待或停止当前生成"));
        }
        let command = args["command"].as_str().unwrap_or("").to_owned();
        if !matches!(
            command.as_str(),
            "model_complete"
                | "model_embed"
                | "model_is_ready"
                | "model_list"
                | "model_is_available"
                | "ollama_ensure_running"
        ) {
            return Err(CommandError::new("Unsupported model job"));
        }
        let payload = args["payload"].clone();
        let client = OllamaClient::new(None)?;
        let output = Arc::new(Mutex::new(Output::default()));
        let target = output.clone();
        let task = tokio::spawn(async move {
            let work = async {
                match command.as_str() {
                    "model_complete" => {
                        let request = serde_json::from_value(payload["request"].clone())?;
                        let text = client
                            .complete_stream(request, |event| {
                                let mut state = target.lock().unwrap();
                                state.text.push_str(&event.delta);
                            })
                            .await?;
                        Ok(json!(text))
                    }
                    "model_embed" => {
                        let texts: Vec<String> = serde_json::from_value(payload["texts"].clone())?;
                        if texts.len() > 256 {
                            return Err(CommandError::new("Too many embedding inputs"));
                        }
                        let model = payload["model"]
                            .as_str()
                            .ok_or_else(|| CommandError::new("Missing model"))?;
                        Ok(json!(client.embed(model, &texts, payload["release_after"].as_bool().unwrap_or(false)).await?))
                    }
                    "model_is_ready" => Ok(json!(client.is_ready().await)),
                    "model_list" => Ok(json!(client.list_models_checked().await?)),
                    "model_is_available" => {
                        let name = payload["model"]
                            .as_str()
                            .ok_or_else(|| CommandError::new("Missing model"))?;
                        let short = name.trim_end_matches(":latest");
                        Ok(json!(client
                            .list_models()
                            .await
                            .iter()
                            .any(|m| m.name == name
                                || m.name.trim_end_matches(":latest") == short
                                || m.name.starts_with(&format!("{short}-")))))
                    }
                    "ollama_ensure_running" => {
                        crate::model_client::startup::ensure_running(&client)
                            .await
                            .map(|s| json!(s))
                            .map_err(CommandError::new)
                    }
                    _ => unreachable!(),
                }
            };
            let result = match tokio::time::timeout(Duration::from_secs(300), work).await {
                Ok(result) => result.map_err(|e: CommandError| e.to_string()),
                Err(_) => Err("模型请求超时".to_owned()),
            };
            target.lock().unwrap().result = Some(result);
        });
        self.jobs.insert(
            id.to_owned(),
            Job {
                output,
                task,
                touched: Instant::now(),
            },
        );
        Ok(json!({"id":id}))
    }
    pub fn poll(&mut self, args: &Value) -> CommandResult<Value> {
        let id = args["id"].as_str().unwrap_or("");
        let job = self
            .jobs
            .get_mut(id)
            .ok_or_else(|| CommandError::new("模型任务已结束或连接已过期"))?;
        job.touched = Instant::now();
        let state = job.output.lock().unwrap();
        let cursor = args["cursor"].as_u64().unwrap_or(0) as usize;
        if cursor > state.text.len() || !state.text.is_char_boundary(cursor) {
            return Err(CommandError::new("Invalid stream cursor"));
        }
        let mut end = (cursor + 32768).min(state.text.len());
        while !state.text.is_char_boundary(end) {
            end -= 1;
        }
        let done = end == state.text.len() && state.result.is_some();
        let result = if done {
            state.result.as_ref().and_then(|r| r.as_ref().ok())
        } else {
            None
        };
        let error = if done {
            state.result.as_ref().and_then(|r| r.as_ref().err())
        } else {
            None
        };
        Ok(
            json!({"delta": &state.text[cursor..end], "cursor":end, "done":done, "value":result, "error":error}),
        )
    }
    pub fn cancel(&mut self, args: &Value) -> Value {
        self.jobs.remove(args["id"].as_str().unwrap_or(""));
        json!(true)
    }
}

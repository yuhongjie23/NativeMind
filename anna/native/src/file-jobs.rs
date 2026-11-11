//! Disposable parser processes keep blocking libraries away from the DB loop.
use crate::utils::{CommandError, CommandResult};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};

const PARSE_TIMEOUT: Duration = Duration::from_secs(120);

struct Job {
    child: Child,
    reader: JoinHandle<()>,
    output: Arc<Mutex<Option<Result<Value, String>>>>,
    started: Instant,
    touched: Instant,
    cancelled: bool,
    failure: Option<String>,
}

impl Job {
    fn spawn(mut command: Command) -> CommandResult<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn()?;
        let stdout = child.stdout.take().expect("piped parser stdout");
        let output = Arc::new(Mutex::new(None));
        let target = output.clone();
        let reader = match std::thread::Builder::new()
            .name("parser-output".into())
            .spawn(move || {
                let result = crate::parser_worker::read_result(stdout);
                *target.lock().unwrap() = Some(result);
            }) {
            Ok(reader) => reader,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        Ok(Self {
            child,
            reader,
            output,
            started: Instant::now(),
            touched: Instant::now(),
            cancelled: false,
            failure: None,
        })
    }

    fn terminate(&mut self) {
        // Close the lease as well as requesting OS termination. Do not synchronously
        // wait in the command loop; capacity is released only after try_wait succeeds.
        self.child.stdin.take();
        if let Err(error) = self.child.kill() {
            if self.child.try_wait().ok().flatten().is_none() {
                eprintln!("Parser termination pending: {error}");
            }
        }
    }

    fn finished(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_some() && self.reader.is_finished()
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        self.terminate();
        // Normal removal follows try_wait; at backend shutdown only our at most two
        // disposable children remain. Reap them rather than leaving zombies behind.
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct FileJobs {
    jobs: HashMap<String, Job>,
}

impl FileJobs {
    pub fn reap(&mut self) {
        for job in self.jobs.values_mut() {
            if job.touched.elapsed() >= Duration::from_secs(30) {
                job.cancelled = true;
            }
            if job.started.elapsed() >= PARSE_TIMEOUT && !job.finished() && job.failure.is_none() {
                job.failure = Some("文档解析超过 2 分钟，已停止；请拆分文档后重试".into());
            }
            let output_failed = job
                .output
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|result| result.is_err());
            if job.cancelled || job.failure.is_some() || output_failed {
                job.terminate();
            }
        }
        self.jobs
            .retain(|_, job| !(job.cancelled && job.finished()));
    }

    pub fn start(&mut self, root: &Path, args: &Value) -> CommandResult<Value> {
        self.reap();
        let id = args["id"].as_str().unwrap_or("");
        if id.len() != 36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
            return Err(CommandError::new("Invalid file job id"));
        }
        if self.jobs.contains_key(id) {
            return Err(CommandError::new("Duplicate file job id"));
        }
        if self.jobs.len() >= 2 {
            return Err(CommandError::new("FILE_JOB_BUSY: 文件解析任务仍在处理或收尾，请稍后再试"));
        }
        let command = args["command"].as_str().unwrap_or("");
        let uri = args["payload"]["path"]
            .as_str()
            .ok_or_else(|| CommandError::new("Missing path"))?;
        let path = crate::parser_worker::validate(root, command, Path::new(uri))?;
        let mut process = Command::new(std::env::current_exe()?);
        process
            .args(["--local-dev", "--file-worker", command])
            .arg(path)
            .env("NATIVEMIND_ANNA_DATA_DIR", root);
        let job = Job::spawn(process)?;
        let pid = job.child.id();
        self.jobs.insert(id.to_owned(), job);
        Ok(json!({ "id": id, "workerPid": pid }))
    }

    pub fn poll(&mut self, args: &Value) -> CommandResult<Value> {
        self.reap();
        let job = self
            .jobs
            .get_mut(args["id"].as_str().unwrap_or(""))
            .filter(|job| !job.cancelled)
            .ok_or_else(|| CommandError::new("文件解析已取消或连接已过期"))?;
        job.touched = Instant::now();
        if let Some(error) = &job.failure {
            return Ok(json!({"done":true,"error":error}));
        }
        let Some(status) = job.child.try_wait()? else {
            return Ok(json!({"done":false}));
        };
        if !job.reader.is_finished() {
            return Ok(json!({"done":false}));
        }
        let output = job.output.lock().unwrap();
        match output.as_ref() {
            Some(Err(error)) => Ok(json!({"done":true,"error":error})),
            Some(Ok(value)) if status.success() => Ok(json!({"done":true,"value":value})),
            _ => Ok(json!({"done":true,"error":"文件解析进程异常退出"})),
        }
    }

    pub fn cancel(&mut self, args: &Value) -> CommandResult<Value> {
        if let Some(job) = self.jobs.get_mut(args["id"].as_str().unwrap_or("")) {
            job.cancelled = true;
        }
        self.reap();
        Ok(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    // A deterministic blocked parser fixture compiled only into the Rust test binary.
    #[test]
    fn blocking_worker_fixture() {
        let Some(marker) = std::env::var_os("NATIVEMIND_PARSER_TEST_READY") else {
            return;
        };
        crate::parser_worker::watch_parent().unwrap();
        std::fs::write(marker, "ready").unwrap();
        loop {
            std::thread::park();
        }
    }

    fn blocked_job() -> Job {
        let marker = std::env::temp_dir().join(format!(
            "nativemind-parser-ready-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "file_jobs::tests::blocking_worker_fixture",
                "--nocapture",
            ])
            .env("NATIVEMIND_PARSER_TEST_READY", &marker);
        let job = Job::spawn(command).unwrap();
        let start = Instant::now();
        while !marker.exists() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let ready = marker.exists();
        let _ = std::fs::remove_file(marker);
        assert!(
            ready,
            "fixture must enter the blocking parser before cancellation"
        );
        job
    }

    fn await_reap(jobs: &mut FileJobs) {
        let start = Instant::now();
        while !jobs.jobs.is_empty() && start.elapsed() < Duration::from_secs(5) {
            jobs.reap();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            jobs.jobs.is_empty(),
            "child processes and reader threads must exit"
        );
    }

    #[test]
    fn cancellation_and_lost_polling_physically_end_workers_and_free_slots() {
        let mut jobs = FileJobs::default();
        jobs.jobs.insert("one".into(), blocked_job());
        jobs.jobs.insert("two".into(), blocked_job());
        assert!(jobs
            .start(
                Path::new("unused"),
                &json!({"id":"12345678-1234-1234-1234-123456789abc"})
            )
            .is_err());
        jobs.cancel(&json!({"id":"one"})).unwrap();
        assert!(jobs.poll(&json!({"id":"one"})).is_err());
        jobs.jobs.get_mut("two").unwrap().touched = Instant::now() - Duration::from_secs(31);
        await_reap(&mut jobs);
        jobs.jobs.insert("next".into(), blocked_job());
        jobs.cancel(&json!({"id":"next"})).unwrap();
        await_reap(&mut jobs);
    }

    #[test]
    fn hard_timeout_terminates_worker_and_reports_failure() {
        let mut jobs = FileJobs::default();
        let mut job = blocked_job();
        job.started = Instant::now() - PARSE_TIMEOUT - Duration::from_secs(1);
        jobs.jobs.insert("slow".into(), job);
        let result = jobs.poll(&json!({"id":"slow"})).unwrap();
        assert_eq!(result["done"], true);
        assert!(result["error"].as_str().unwrap().contains("超过 2 分钟"));
        jobs.cancel(&json!({"id":"slow"})).unwrap();
        await_reap(&mut jobs);
    }

    #[test]
    fn loss_of_parent_pipe_ends_worker_without_an_explicit_kill() {
        let mut job = blocked_job();
        job.child.stdin.take();
        let start = Instant::now();
        while !job.finished() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(job.finished());
        assert!(job.child.try_wait().unwrap().unwrap().success());
    }
}

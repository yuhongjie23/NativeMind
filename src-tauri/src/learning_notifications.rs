use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use crate::utils::{CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledReminder { pub id: String, pub title: String, pub due_at: String }

fn hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325u64, |value, byte| (value ^ byte as u64).wrapping_mul(0x100000001b3))
}

fn payload(root: &Path, reminders: &[ScheduledReminder]) -> CommandResult<Value> {
    if reminders.len() > 64 { return Err(CommandError::new("最多支持 64 条系统提醒")); }
    let prefix = format!("nm{:016x}", hash(&root.to_string_lossy()));
    let mut entries = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for reminder in reminders {
        if reminder.id.is_empty() || reminder.id.len() > 100 || reminder.title.trim().is_empty() || reminder.title.chars().count() > 120 {
            return Err(CommandError::new("提醒编号或标题不合法"));
        }
        chrono::DateTime::parse_from_rfc3339(&reminder.due_at).map_err(|_| CommandError::new("提醒时间不合法"))?;
        let id = format!("{:016x}", hash(&reminder.id));
        if !ids.insert(id.clone()) { return Err(CommandError::new("提醒编号重复，请重新创建")); }
        entries.push(json!({"id": id, "title": reminder.title, "dueAt": reminder.due_at}));
    }
    Ok(json!({"prefix":prefix, "reminders":entries}))
}

pub fn sync(root: &Path, reminders: &[ScheduledReminder]) -> CommandResult<Value> {
    let data = payload(root, reminders)?;
    #[cfg(not(target_os = "windows"))]
    { let _ = data; Ok(json!({"supported":false,"enabled":false,"scheduled":0,"message":"当前系统尚不支持退出后的提醒；应用打开后会保留到期事项。"})) }
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut child = Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", include_str!("learning_notifications.ps1")])
            .creation_flags(0x08000000).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        child.stdin.take().ok_or_else(|| CommandError::new("无法启动系统提醒"))?.write_all(serde_json::to_string(&data)?.as_bytes())?;
        let started = std::time::Instant::now();
        while child.try_wait()?.is_none() {
            if started.elapsed() > std::time::Duration::from_secs(20) {
                let _ = child.kill(); let _ = child.wait(); return Err(CommandError::new("Windows 提醒同步超时，请重试"));
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        let output = child.wait_with_output()?;
        let response: Value = serde_json::from_slice(&output.stdout).map_err(|_| CommandError::new("Windows 提醒服务未返回有效结果"))?;
        if !output.status.success() { return Err(CommandError::new(response["message"].as_str().unwrap_or("Windows 提醒同步失败"))); }
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry() -> ScheduledReminder { ScheduledReminder { id:"test-reminder".into(), title:"阅读 <第三章> & 复习".into(), due_at:"2026-12-01T08:00:00Z".into() } }
    #[test] fn namespaces_are_stable_and_separate() {
        let a = payload(Path::new("one"), &[entry()]).unwrap();
        assert_eq!(a, payload(Path::new("one"), &[entry()]).unwrap());
        assert_ne!(a["prefix"], payload(Path::new("two"), &[]).unwrap()["prefix"]);
        assert_eq!(a["reminders"][0]["id"].as_str().unwrap().len(), 16);
        assert_eq!(a["reminders"][0]["title"], entry().title);
    }
    #[test] fn invalid_and_duplicate_entries_do_not_reach_windows() {
        assert!(payload(Path::new("one"), &[entry(), entry()]).is_err());
        let mut bad = entry(); bad.due_at = "bad".into();
        assert!(payload(Path::new("one"), &[bad]).is_err());
        assert!(payload(Path::new("one"), &vec![entry(); 65]).is_err());
    }
}

//! Launch-only Executa. No database, HTTP, file arguments, credentials or reverse RPC.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const TOOL: &str = "tool-forforever23-hongjie-yu-3qny9w3z";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const LIMIT: u64 = 4096;

fn verified_desktop(root: &Path, app_hash: &str, vector_hash: &str) -> Result<PathBuf, &'static str> {
    for (path, expected) in [("desktop/nativemind.exe", app_hash), ("desktop/vec0.dll", vector_hash)] {
        if expected.len() != 64 { return Err("PACKAGE_NOT_BUILT"); }
        let mut current = root.to_path_buf();
        for part in path.split('/') {
            current.push(part);
            let meta = std::fs::symlink_metadata(&current).map_err(|_| "PACKAGE_INCOMPLETE")?;
            if meta.file_type().is_symlink() { return Err("PACKAGE_LINK_REFUSED"); }
        }
        let mut file = std::fs::File::open(&current).map_err(|_| "PACKAGE_UNREADABLE")?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = file.read(&mut buffer).map_err(|_| "PACKAGE_UNREADABLE")?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }
        if format!("{:x}", hasher.finalize()) != expected { return Err("PACKAGE_INTEGRITY_FAILED"); }
    }
    Ok(root.join("desktop/nativemind.exe"))
}

fn launch() -> Result<(), &'static str> {
    if !cfg!(all(windows, target_arch = "x86_64")) { return Err("WINDOWS_X64_REQUIRED"); }
    // Routing hint only, never an authentication claim.
    if std::env::var("ANNA_RUNTIME_PROFILE").ok().as_deref() != Some("desktop-windows") {
        return Err("SELECT_LOCAL_WINDOWS_AGENT");
    }
    let exe = std::env::current_exe().map_err(|_| "PACKAGE_UNAVAILABLE")?;
    let root = exe.parent().and_then(Path::parent).ok_or("PACKAGE_UNAVAILABLE")?;
    let app = verified_desktop(root, env!("NATIVEMIND_DESKTOP_SHA256"), env!("NATIVEMIND_VECTOR_SHA256"))?;
    spawn_desktop(&app)
}

#[cfg(not(windows))]
fn spawn_desktop(_: &Path) -> Result<(), &'static str> { Err("WINDOWS_X64_REQUIRED") }

#[cfg(windows)]
fn spawn_desktop(app: &Path) -> Result<(), &'static str> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{CreateProcessW, STARTUPINFOW, PROCESS_INFORMATION, CREATE_UNICODE_ENVIRONMENT, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS};
    let wide = |value: &std::ffi::OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let application = wide(app.as_os_str());
    let mut args = wide(std::ffi::OsStr::new(&format!("\"{}\" --anna-confirm", app.display())));
    let directory = wide(app.parent().ok_or("PACKAGE_UNAVAILABLE")?.as_os_str());
    // Do not pass Anna access tokens, invocation context or tool credentials to the app.
    let mut environment = std::collections::BTreeMap::new();
    for name in ["SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PATH", "HOMEDRIVE", "HOMEPATH"] {
        if let Some(value) = std::env::var_os(name) { environment.insert(name.to_uppercase(), value); }
    }
    let mut block = Vec::new();
    for (name, value) in environment {
        let mut entry = std::ffi::OsString::from(format!("{name}=")); entry.push(value);
        block.extend(wide(&entry));
    }
    block.push(0u16);
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // Explicit FALSE prevents the desktop inheriting ANY Agent/stdio pipe handles.
    // Rust's regular Command can leave upstream inheritable handles open on Windows.
    let success = unsafe { CreateProcessW(application.as_ptr(), args.as_mut_ptr(), std::ptr::null(), std::ptr::null(), 0,
        CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
        block.as_ptr().cast(), directory.as_ptr(), &startup, &mut process) };
    if success == 0 { return Err("LOCAL_LAUNCH_FAILED"); }
    unsafe { CloseHandle(process.hThread); CloseHandle(process.hProcess); }
    Ok(())
}

fn respond(frame: &[u8], last: &mut Option<Instant>, mut open: impl FnMut() -> Result<(), &'static str>) -> Option<Value> {
    let request: Value = match serde_json::from_slice(frame) {
        Ok(value) => value,
        Err(_) => return Some(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}})),
    };
    let id = request.get("id")?;
    if !(id.is_null() || id.is_i64() || id.is_u64() || id.as_str().is_some_and(|s| s.len() <= 64)) {
        return Some(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid request ID"}}));
    }
    let error = |code, message| json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}});
    if request["jsonrpc"] != "2.0" { return Some(error(-32600, "Invalid request")); }
    let result = match request["method"].as_str() {
        Some("initialize") => json!({"protocolVersion":"2.0","serverInfo":{"name":TOOL,"version":VERSION},"capabilities":{}}),
        Some("describe") => json!({"name":TOOL,"display_name":"NativeMind Local Launcher","version":VERSION,
            "description":"Ask the local user to open NativeMind. Never reads learning data. Windows x64 local Agent required.",
            "tools":[{"name":"open_app","description":"Open NativeMind with confirmation on this computer. No arguments or learning data.","timeout":30,"parameters":[]}],
            "credentials":[]}),
        Some("health") => json!({"status":"ready"}),
        Some("invoke") => {
            if request["params"]["tool"] != "open_app" { return Some(error(-32601, "Unknown tool")); }
            if !request["params"]["arguments"].as_object().is_some_and(|args| args.is_empty()) {
                return Some(error(-32602, "open_app accepts only an empty object"));
            }
            if last.is_some_and(|time| time.elapsed() < Duration::from_secs(15)) {
                json!({"success":false,"error":"LAUNCH_ALREADY_REQUESTED"})
            } else {
                // Limit failures too. Do not retry potentially successful process creation.
                *last = Some(Instant::now());
                match open() {
                    Ok(()) => json!({"success":true,"data":{"status":"launch_requested","message":"Confirm opening NativeMind on your computer. Learning data stays local."}}),
                    Err(code) => json!({"success":false,"error":code}),
                }
            }
        }
        _ => return Some(error(-32601, "Unknown method")),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

fn main() -> std::io::Result<()> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let mut last = None;
    loop {
        let mut frame = Vec::new();
        let n = (&mut input).take(LIMIT + 1).read_until(b'\n', &mut frame)?;
        if n == 0 { break; }
        if n as u64 > LIMIT { break; } // Bounded memory; no payload echo/logging.
        if let Some(response) = respond(&frame, &mut last, launch) {
            writeln!(output, "{response}")?;
            output.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_empty_open_can_launch() {
        let mut last = None;
        for request in [json!({"tool":"native_command","arguments":{}}), json!({"tool":"open_app","arguments":{"path":"private.db"}}), json!({"tool":"open_app","arguments":null})] {
            let frame = json!({"jsonrpc":"2.0","id":1,"method":"invoke","params":request}).to_string();
            let response = respond(frame.as_bytes(), &mut last, || panic!("must not launch")).unwrap();
            assert!(response.get("error").is_some());
            assert!(!response.to_string().contains("private.db"));
        }
        let frame = br#"{"jsonrpc":"2.0","id":1,"method":"invoke","params":{"tool":"open_app","arguments":{}}}"#;
        assert_eq!(respond(frame, &mut last, || Ok(())).unwrap()["result"]["data"]["status"], "launch_requested");
        assert_eq!(respond(frame, &mut last, || panic!("rate limited")).unwrap()["result"]["error"], "LAUNCH_ALREADY_REQUESTED");
    }
    #[test]
    fn notifications_and_credentials_never_launch_or_return_data() {
        let mut last = None;
        assert!(respond(br#"{"jsonrpc":"2.0","method":"invoke","params":{"tool":"open_app","arguments":{}}}"#, &mut last, || panic!()).is_none());
        let out = respond(br#"{"jsonrpc":"2.0","id":2,"method":"describe","params":{"context":{"credentials":{"key":"SECRET"}}}}"#, &mut last, || panic!()).unwrap();
        assert!(!out.to_string().contains("SECRET"));
        assert_eq!(out["result"]["tools"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn package_tampering_is_refused() {
        let root = std::env::temp_dir().join(format!("nativemind-launcher-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("desktop")).unwrap();
        for file in ["nativemind.exe", "vec0.dll"] { std::fs::write(root.join("desktop").join(file), b"fixture").unwrap(); }
        let hash = format!("{:x}", Sha256::digest(b"fixture"));
        assert!(verified_desktop(&root, &hash, &hash).is_ok());
        std::fs::write(root.join("desktop/vec0.dll"), b"changed").unwrap();
        assert_eq!(verified_desktop(&root, &hash, &hash).unwrap_err(), "PACKAGE_INTEGRITY_FAILED");
        // Remove explicit fixture files only; never recursive cleanup of an inferred path.
        for file in ["nativemind.exe", "vec0.dll"] { std::fs::remove_file(root.join("desktop").join(file)).unwrap(); }
        std::fs::remove_dir(root.join("desktop")).unwrap(); std::fs::remove_dir(root).unwrap();
    }
}

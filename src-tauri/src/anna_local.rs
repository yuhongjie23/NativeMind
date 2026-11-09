//! Local consent is not an Anna account assertion. No Anna token enters this app.
pub fn allow_start() -> bool {
    if !cfg!(feature = "anna-local") || !std::env::args().any(|arg| arg == "--anna-confirm") {
        return true;
    }
    confirm()
}

#[cfg(windows)]
fn confirm() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, title: *const u16, flags: u32) -> i32;
    }
    let text: Vec<u16> = "Anna 请求打开本机 NativeMind。\n学习数据不会发送给 Anna。是否打开？\n\nAnna requested NativeMind on this PC.\nLearning data stays local. Open the app?\0".encode_utf16().collect();
    let title: Vec<u16> = "NativeMind Local\0".encode_utf16().collect();
    // Yes/No, No by default; only the local user can confirm.
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x04 | 0x20 | 0x100 | 0x10000) == 6 }
}

#[cfg(not(windows))]
fn confirm() -> bool { false }

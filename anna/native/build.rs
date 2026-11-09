use std::{env, fs, path::PathBuf};

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("Cargo target OS");
    let library = match target_os.as_str() {
        "windows" => "vec0.dll",
        "macos" => "vec0.dylib",
        _ => "vec0.so",
    };
    let source = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../src-tauri/resources")
        .join(library);
    println!("cargo:rerun-if-changed={}", source.display());
    // OUT_DIR is <profile>/build/<package-hash>/out, including cross-target builds.
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let resources = output
        .ancestors()
        .nth(3)
        .expect("Cargo profile directory")
        .join("resources");
    fs::create_dir_all(&resources).expect("Create adjacent native resources");
    // Shared Rust tests run under Anna's manifest, not src-tauri's resource tree.
    println!("cargo:rustc-env=NATIVEMIND_BUNDLED_RESOURCES={}", resources.display());
    fs::copy(&source, resources.join(library)).unwrap_or_else(|error| {
        panic!(
            "Cannot bundle {}: {error}. Supply the extension for the target OS before building.",
            source.display()
        )
    });
}

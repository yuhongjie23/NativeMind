fn main() {
    for name in ["NATIVEMIND_DESKTOP_SHA256", "NATIVEMIND_VECTOR_SHA256"] {
        println!("cargo:rerun-if-env-changed={name}");
        let value = std::env::var(name).unwrap_or_default();
        println!("cargo:rustc-env={name}={value}");
    }
}

use std::path::Path;

// Bundle scripts/provision/{lib,steps,main}.sh into a single provision.sh in
// OUT_DIR so the Rust sidecar can include_str! it — the Tauri build is then
// self-contained and always ships the current script.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let prov = Path::new(&manifest).join("../../scripts/provision");
    let parts = ["lib.sh", "steps.sh", "main.sh"];
    println!("cargo:rerun-if-env-changed=HIVE_VERSION");
    let version = std::env::var("HIVE_VERSION").unwrap_or_else(|_| "0.0.0-dev".into());

    let mut out = String::new();
    out.push_str("#!/usr/bin/env bash\n");
    out.push_str(&format!("SCRIPT_VERSION=\"{version}\"\n"));
    for p in parts {
        let path = prov.join(p);
        println!("cargo:rerun-if-changed={}", path.display());
        let body = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
        out.push_str(&body);
        out.push('\n');
    }

    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("provision.sh");
    std::fs::write(&dest, out).expect("write provision.sh");

    tauri_build::build();
}

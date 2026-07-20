// SSH sidecar that drives provision.sh on the target server. Uses the system
// OpenSSH binary (per the amended design) so agent-held keys, ~/.ssh/config and
// two decades of sshd compatibility come for free. Secrets are streamed over
// stdin (never argv); progress NDJSON is forwarded to the frontend on a Channel.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

const PROVISION_SH: &str = include_str!(concat!(env!("OUT_DIR"), "/provision.sh"));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    path: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    encrypted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    public_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionParams {
    host: String,
    key_path: String,
    #[serde(default)]
    tailscale_auth_key: String,
    auth_token: String,
    #[serde(default)]
    port: Option<u16>,
}

fn known_hosts_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("hive");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("known_hosts")
}

fn ssh_common_args(key_path: &str) -> Vec<String> {
    vec![
        "-o".into(), "BatchMode=yes".into(),
        "-o".into(), "ConnectTimeout=15".into(),
        "-o".into(), "StrictHostKeyChecking=yes".into(),
        // Quote the path: ssh tokenizes -o values on whitespace, and the macOS
        // config dir ("Application Support") contains a space.
        "-o".into(), format!("UserKnownHostsFile=\"{}\"", known_hosts_path().display()),
        "-i".into(), key_path.to_string(),
        "-l".into(), "root".into(),
    ]
}

/// Map ssh stderr to a shared SetupErrorCode string.
fn ssh_error_code(stderr: &str) -> &'static str {
    let s = stderr.to_lowercase();
    if s.contains("host key verification failed") || s.contains("remote host identification has changed") {
        "SSH_HOST_KEY_CHANGED"
    } else if s.contains("permission denied") || s.contains("no matching") || s.contains("authentication") {
        "SSH_AUTH_FAILED"
    } else if s.contains("connection refused") || s.contains("timed out") || s.contains("could not resolve")
        || s.contains("no route to host") || s.contains("connection timed out")
    {
        "SSH_UNREACHABLE"
    } else {
        "SSH_UNREACHABLE"
    }
}

// ── list_keys ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn provision_list_keys() -> Vec<SshKey> {
    let mut keys = Vec::new();
    let Some(home) = dirs::home_dir() else { return keys };
    let ssh_dir = home.join(".ssh");
    let Ok(entries) = std::fs::read_dir(&ssh_dir) else { return keys };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.extension().map(|e| e == "pub").unwrap_or(false) {
            continue;
        }
        if matches!(name.as_str(), "known_hosts" | "known_hosts.old" | "config" | "authorized_keys" | "agent.sock") {
            continue;
        }
        // A private key: either a matching .pub exists, or the file looks like one.
        let pub_path = path.with_extension("pub").exists()
            || ssh_dir.join(format!("{name}.pub")).exists();
        let looks_private = std::fs::read_to_string(&path)
            .map(|c| c.contains("PRIVATE KEY"))
            .unwrap_or(false);
        if !pub_path && !looks_private {
            continue;
        }

        // Derive type + public key + encrypted flag via ssh-keygen (no passphrase).
        let out = Command::new("ssh-keygen")
            .args(["-y", "-P", "", "-f"])
            .arg(&path)
            .output();
        let (encrypted, public_key, r#type) = match out {
            Ok(o) if o.status.success() => {
                let pk = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let ty = pk.split_whitespace().next().map(map_key_type);
                (Some(false), Some(pk), ty)
            }
            _ => {
                // Failed with empty passphrase → most likely encrypted.
                let ty = std::fs::read_to_string(ssh_dir.join(format!("{name}.pub")))
                    .ok()
                    .and_then(|p| p.split_whitespace().next().map(map_key_type));
                (Some(true), None, ty)
            }
        };
        keys.push(SshKey {
            path: path.to_string_lossy().to_string(),
            label: name,
            r#type,
            encrypted,
            public_key,
        });
    }
    keys.sort_by(|a, b| a.label.cmp(&b.label));
    keys
}

fn map_key_type(algo: &str) -> String {
    match algo {
        "ssh-ed25519" => "ed25519".into(),
        "ssh-rsa" => "rsa".into(),
        a if a.starts_with("ecdsa") => "ecdsa".into(),
        a if a.starts_with("sk-") => "security-key".into(),
        other => other.to_string(),
    }
}

// ── test_connection ──────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn provision_test_connection(host: String, _key_path: String) -> TestConnectionResult {
    tauri::async_runtime::spawn_blocking(move || {
        // ssh-keyscan fetches the host key without needing prior trust; piping it
        // through ssh-keygen -lf yields the SHA256 fingerprint for the TOFU dialog.
        let scan = Command::new("ssh-keyscan")
            .args(["-T", "10", "-t", "ed25519,rsa,ecdsa", &host])
            .output();
        let scan = match scan {
            Ok(o) if !o.stdout.is_empty() => o.stdout,
            Ok(o) => {
                return TestConnectionResult {
                    fingerprint: None,
                    error: Some(ssh_error_code(&String::from_utf8_lossy(&o.stderr)).into()),
                }
            }
            Err(_) => return TestConnectionResult { fingerprint: None, error: Some("SSH_UNREACHABLE".into()) },
        };

        let mut kg = match Command::new("ssh-keygen")
            .args(["-l", "-f", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => return TestConnectionResult { fingerprint: None, error: Some("UNKNOWN".into()) },
        };
        if let Some(mut si) = kg.stdin.take() {
            let _ = si.write_all(&scan);
        }
        let out = kg.wait_with_output().ok();
        let fp = out
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.lines().next().map(|l| l.to_string()))
            .and_then(|line| line.split_whitespace().nth(1).map(|s| s.to_string()));
        match fp {
            Some(f) => TestConnectionResult { fingerprint: Some(f), error: None },
            None => TestConnectionResult { fingerprint: None, error: Some("UNKNOWN".into()) },
        }
    })
    .await
    .unwrap_or(TestConnectionResult { fingerprint: None, error: Some("UNKNOWN".into()) })
}

// ── trust_host ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn provision_trust_host(host: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scan = Command::new("ssh-keyscan")
            .args(["-T", "10", "-t", "ed25519,rsa,ecdsa", &host])
            .output()
            .map_err(|e| e.to_string())?;
        if scan.stdout.is_empty() {
            return Err("SSH_UNREACHABLE".into());
        }
        let kh = known_hosts_path();
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&kh)
            .map_err(|e| e.to_string())?;
        f.write_all(&scan.stdout).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── start / resume provision ─────────────────────────────────────────────────

/// Locally built dev release tarball, if any. HIVE_DEV_RELEASE_TARBALL wins;
/// debug builds fall back to dist-release/ in the repo (make release-tarball)
/// so `npm run tauri dev` works without remembering the env var.
fn dev_release_tarball() -> Option<String> {
    if let Ok(p) = std::env::var("HIVE_DEV_RELEASE_TARBALL") {
        return Some(p);
    }
    if cfg!(debug_assertions) {
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
        let p = format!(
            "{}/../../dist-release/hive-backend-0.0.0-dev-linux-{arch}.tar.gz",
            env!("CARGO_MANIFEST_DIR")
        );
        if std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }
    None
}

fn provision_args(params: &ProvisionParams) -> Vec<String> {
    let port = params.port.unwrap_or(3000);
    let mut args = vec!["--port".to_string(), port.to_string()];
    if params.tailscale_auth_key.trim().is_empty() {
        // Local (e.g. OrbStack) mode: no tailnet, bind all interfaces so the VM
        // is reachable from the host on its LAN IP.
        args.push("--skip-tailscale".into());
        args.push("--host".into());
        args.push("0.0.0.0".into());
    } else {
        args.push("--host".into());
        args.push("0.0.0.0".into());
    }
    // Dev convenience: install a locally-built backend tarball instead of a
    // GitHub release. The Rust side scps it and adds --release-file.
    if dev_release_tarball().is_some() {
        args.push("--release-file".into());
        args.push("/var/lib/hive/hive-backend.tar.gz".into());
    }
    args
}

fn env_prelude(params: &ProvisionParams) -> String {
    let hash = {
        let mut h = Sha256::new();
        h.update(params.auth_token.as_bytes());
        hex(&h.finalize())
    };
    let mut s = String::new();
    s.push_str(&format!("export HIVE_AUTH_TOKEN_SHA256='{hash}'\n"));
    if !params.tailscale_auth_key.trim().is_empty() {
        s.push_str(&format!("export TS_AUTHKEY='{}'\n", shell_single_quote(&params.tailscale_auth_key)));
    }
    s
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn shell_single_quote(s: &str) -> String {
    s.replace('\'', "")
}

/// scp a dev release tarball to the server when one is configured or found.
fn maybe_upload_release(params: &ProvisionParams) -> Result<(), String> {
    let Some(tarball) = dev_release_tarball() else { return Ok(()) };
    // Ensure /var/lib/hive exists, then scp the tarball into it.
    let mkdir = Command::new("ssh")
        .args(ssh_common_args(&params.key_path))
        .arg(&params.host)
        .arg("mkdir -p /var/lib/hive")
        .output()
        .map_err(|e| e.to_string())?;
    if !mkdir.status.success() {
        return Err(ssh_error_code(&String::from_utf8_lossy(&mkdir.stderr)).into());
    }
    let mut scp_args = vec![
        "-o".to_string(), "BatchMode=yes".into(),
        "-o".into(), format!("UserKnownHostsFile=\"{}\"", known_hosts_path().display()),
        "-i".into(), params.key_path.clone(),
    ];
    scp_args.push(tarball);
    scp_args.push(format!("root@{}:/var/lib/hive/hive-backend.tar.gz", params.host));
    let scp = Command::new("scp").args(&scp_args).output().map_err(|e| e.to_string())?;
    if !scp.status.success() {
        return Err(format!("RELEASE_DOWNLOAD_FAILED: {}", String::from_utf8_lossy(&scp.stderr)));
    }
    Ok(())
}

fn run_provision(params: ProvisionParams, on_event: Channel<serde_json::Value>) -> Result<(), String> {
    maybe_upload_release(&params)?;

    let prov_args = provision_args(&params);
    let remote = format!("bash -s -- {}", prov_args.join(" "));
    let stdin_payload = format!("{}{}", env_prelude(&params), PROVISION_SH);

    let mut child = Command::new("ssh")
        .args(ssh_common_args(&params.key_path))
        .arg(&params.host)
        .arg(&remote)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    // Stream the env prelude + script to the remote bash over stdin.
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(stdin_payload.as_bytes());
        // Dropping stdin closes it → bash sees EOF and runs.
    });

    // Forward each NDJSON line to the channel.
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let reader = BufReader::new(stdout);
    let mut saw_end = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if val.get("event").and_then(|e| e.as_str()) == Some("run_end") {
                saw_end = true;
            }
            let _ = on_event.send(val);
        }
    }
    let _ = writer.join();

    let mut stderr_buf = String::new();
    if let Some(mut se) = child.stderr.take() {
        let _ = se.read_to_string(&mut stderr_buf);
    }
    let status = child.wait().map_err(|e| e.to_string())?;

    if !saw_end && !status.success() {
        // SSH-level failure before the script could emit run_end.
        let code = ssh_error_code(&stderr_buf);
        let _ = on_event.send(serde_json::json!({
            "v": 1, "seq": -1, "event": "run_end", "status": "error", "errorCode": code
        }));
        return Err(format!("{code}: {}", stderr_buf.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn provision_start(
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_provision(params, on_event))
        .await
        .map_err(|e| e.to_string())?
}

// resume is identical: provision.sh is idempotent and re-runs from the first
// non-ok step. The frontend passes the same params it stored.
#[tauri::command]
pub async fn provision_resume(
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_provision(params, on_event))
        .await
        .map_err(|e| e.to_string())?
}

// ── local Claude auth ────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ClaudeAuthResult {
    token: String,
}

/// `claude` usually lives in a shell-profile PATH entry (~/.local/bin, brew),
/// which GUI-launched apps do not inherit. Probe PATH, then known locations.
fn claude_binary() -> Option<std::path::PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join("claude");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        std::path::PathBuf::from("/opt/homebrew/bin/claude"),
        std::path::PathBuf::from("/usr/local/bin/claude"),
    ];
    candidates.into_iter().find(|c| c.is_file())
}

#[tauri::command]
pub async fn provision_claude_auth() -> Result<ClaudeAuthResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Run `claude setup-token` locally; it opens the browser and prints a
        // one-year CLAUDE_CODE_OAUTH_TOKEN (sk-ant-oat01-…). Capture it.
        let bin = claude_binary().ok_or_else(|| "CLAUDE_CLI_MISSING".to_string())?;
        let out = Command::new(bin)
            .arg("setup-token")
            .output()
            .map_err(|_| "CLAUDE_CLI_MISSING".to_string())?;
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        let token = combined
            .split_whitespace()
            .find(|t| t.starts_with("sk-ant-oat01-"))
            .map(|t| t.trim_matches(|c: char| !c.is_ascii_graphic()).to_string());
        match token {
            Some(t) => Ok(ClaudeAuthResult { token: t }),
            None => Err("CLAUDE_PASTEBACK_BROKEN".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

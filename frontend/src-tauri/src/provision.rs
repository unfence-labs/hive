// SSH sidecar that drives provision.sh on the target server. Uses the system
// OpenSSH binary (per the amended design) so agent-held keys, ~/.ssh/config and
// two decades of sshd compatibility come for free. Secrets are streamed over
// stdin (never argv); progress NDJSON is forwarded to the frontend on a Channel.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Manager, State};

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
    /// SSH user; defaults to root. Non-root users need passwordless sudo.
    #[serde(default)]
    user: Option<String>,
    key_path: String,
    #[serde(default)]
    tailscale_auth_key: String,
    auth_token: String,
    #[serde(default)]
    port: Option<u16>,
    /// Explicit tailnet-vs-local choice; defaults to "skip when no auth key"
    /// so the wizard's behavior is unchanged. Updates pass it explicitly (an
    /// already-joined server needs no key but must stay in tailnet mode).
    #[serde(default)]
    skip_tailscale: Option<bool>,
}

impl ProvisionParams {
    fn ssh_user(&self) -> &str {
        match self.user.as_deref() {
            Some(u) if !u.trim().is_empty() => u,
            _ => "root",
        }
    }

    fn skip_tailscale(&self) -> bool {
        self.skip_tailscale
            .unwrap_or_else(|| self.tailscale_auth_key.trim().is_empty())
    }
}

/// Non-root users run the remote script through passwordless sudo.
fn sudo_prefix(user: &str) -> &'static str {
    if user == "root" { "" } else { "sudo -n " }
}

fn known_hosts_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("hive");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("known_hosts")
}

fn ssh_common_args(key_path: &str, user: &str) -> Vec<String> {
    vec![
        "-o".into(), "BatchMode=yes".into(),
        "-o".into(), "ConnectTimeout=15".into(),
        "-o".into(), "StrictHostKeyChecking=yes".into(),
        // Quote the path: ssh tokenizes -o values on whitespace, and the macOS
        // config dir ("Application Support") contains a space.
        "-o".into(), format!("UserKnownHostsFile=\"{}\"", known_hosts_path().display()),
        "-i".into(), key_path.to_string(),
        "-l".into(), user.to_string(),
    ]
}

/// Map ssh stderr to a shared SetupErrorCode string.
fn ssh_error_code(stderr: &str) -> &'static str {
    let s = stderr.to_lowercase();
    if s.contains("host key verification failed") || s.contains("remote host identification has changed") {
        "SSH_HOST_KEY_CHANGED"
    } else if s.contains("a password is required")
        || s.contains("not in the sudoers")
        || s.contains("sudo: command not found")
    {
        "SSH_NO_ROOT"
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

const HIVE_VERSION: &str = match option_env!("HIVE_VERSION") {
    Some(v) => v,
    None => "0.0.0-dev",
};

/// Resolve the backend tarball to push over SSH: HIVE_DEV_RELEASE_TARBALL
/// wins, then a locally built dist-release/ (make release-tarball), then the
/// tarball bundled with the app (production installs and updates).
fn release_tarball(resource_dir: Option<&std::path::Path>, arch: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HIVE_DEV_RELEASE_TARBALL") {
        return Some(PathBuf::from(p));
    }
    let name = format!("hive-backend-{HIVE_VERSION}-linux-{arch}.tar.gz");
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dist-release")
        .join(&name);
    if dev.exists() {
        return Some(dev);
    }
    let res = resource_dir?.join("release").join(&name);
    res.exists().then_some(res)
}

/// `uname -m` on the server, mapped to the release arch tags.
fn probe_arch(params: &ProvisionParams) -> Result<String, String> {
    let out = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, params.ssh_user()))
        .arg(&params.host)
        .arg("uname -m")
        .output()
        .map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(format!("{}: {}", ssh_error_code(&stderr), stderr.trim()));
    }
    let m = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(match m.as_str() {
        "x86_64" => "x64".to_string(),
        "aarch64" | "arm64" => "arm64".to_string(),
        other => other.to_string(),
    })
}

fn provision_args(params: &ProvisionParams, has_tarball: bool) -> Vec<String> {
    let port = params.port.unwrap_or(3000);
    let mut args = vec!["--port".to_string(), port.to_string()];
    if params.skip_tailscale() {
        // Local (e.g. OrbStack) mode: no tailnet, bind all interfaces so the VM
        // is reachable from the host on its LAN IP.
        args.push("--skip-tailscale".into());
    }
    args.push("--host".into());
    args.push("0.0.0.0".into());
    if has_tarball {
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
fn maybe_upload_release(params: &ProvisionParams, tarball: Option<&std::path::Path>) -> Result<(), String> {
    let Some(tarball) = tarball else { return Ok(()) };
    let user = params.ssh_user();
    let sudo = sudo_prefix(user);
    // scp to /tmp (writable by any user), then move into place with root rights.
    let mut scp_args = vec![
        "-o".to_string(), "BatchMode=yes".into(),
        "-o".into(), format!("UserKnownHostsFile=\"{}\"", known_hosts_path().display()),
        "-i".into(), params.key_path.clone(),
    ];
    // Upload into the SSH user's home: /tmp is sticky, so a fixed /tmp path
    // owned by another user (e.g. a previous root-run install) is unwritable.
    scp_args.push(tarball.to_string_lossy().to_string());
    scp_args.push(format!("{user}@{}:hive-backend.tar.gz", params.host));
    let scp = Command::new("scp").args(&scp_args).output().map_err(|e| e.to_string())?;
    if !scp.status.success() {
        return Err(format!("RELEASE_DOWNLOAD_FAILED: {}", String::from_utf8_lossy(&scp.stderr)));
    }
    let mv = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, user))
        .arg(&params.host)
        .arg(format!(
            "{sudo}mkdir -p /var/lib/hive && {sudo}mv ./hive-backend.tar.gz /var/lib/hive/hive-backend.tar.gz"
        ))
        .output()
        .map_err(|e| e.to_string())?;
    if !mv.status.success() {
        return Err(ssh_error_code(&String::from_utf8_lossy(&mv.stderr)).into());
    }
    Ok(())
}

fn run_provision(
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
    resource_dir: Option<PathBuf>,
) -> Result<(), String> {
    let arch = probe_arch(&params)?;
    let tarball = release_tarball(resource_dir.as_deref(), &arch);
    maybe_upload_release(&params, tarball.as_deref())?;

    let user = params.ssh_user().to_string();
    let prov_args = provision_args(&params, tarball.is_some());
    let remote = format!("{}bash -s -- {}", sudo_prefix(&user), prov_args.join(" "));
    let stdin_payload = format!("{}{}", env_prelude(&params), PROVISION_SH);

    let mut child = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, &user))
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
        // SSH-level failure before the script could emit run_end. Forward the
        // stderr tail so the UI can show what actually went wrong.
        let code = ssh_error_code(&stderr_buf);
        let detail = stderr_buf.trim();
        let mut start = detail.len().saturating_sub(500);
        while start < detail.len() && !detail.is_char_boundary(start) {
            start += 1;
        }
        let detail = &detail[start..];
        let _ = on_event.send(serde_json::json!({
            "v": 1, "seq": -1, "event": "run_end", "status": "error", "errorCode": code,
            "detail": detail
        }));
        return Err(format!("{code}: {detail}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn provision_start(
    app: tauri::AppHandle,
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || run_provision(params, on_event, resource_dir))
        .await
        .map_err(|e| e.to_string())?
}

// resume is identical: provision.sh is idempotent and re-runs from the first
// non-ok step. The frontend passes the same params it stored.
#[tauri::command]
pub async fn provision_resume(
    app: tauri::AppHandle,
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || run_provision(params, on_event, resource_dir))
        .await
        .map_err(|e| e.to_string())?
}


// ── local Claude sign-in (PTY-driven, code pasted back in the app) ───────────
//
// `claude setup-token` requires an interactive terminal: it opens the browser,
// then waits for the user to paste an authorization code before printing the
// OAuth token. We give it a pseudo-TTY via `script` so the app can drive the
// whole exchange: start → browser opens → the UI collects the code → the code
// is written to the CLI → the token is parsed from its output.

pub struct ClaudeAuthSession {
    child: Child,
    stdin: ChildStdin,
    buffer: Arc<Mutex<String>>,
}

#[derive(Default)]
pub struct ClaudeAuthState(pub Mutex<Option<ClaudeAuthSession>>);

/// `claude` usually lives in a shell-profile PATH entry (~/.local/bin, brew),
/// which GUI-launched apps do not inherit. Probe PATH, then known locations.
fn claude_binary() -> Option<PathBuf> {
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
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    candidates.into_iter().find(|c| c.is_file())
}

fn kill_session(session: &mut ClaudeAuthSession) {
    let _ = session.child.kill();
    let _ = session.child.wait();
}

#[derive(Serialize)]
pub struct ClaudeAuthStarted {
    /// Auth URL parsed from the CLI output — fallback link; the CLI usually
    /// opens the browser itself.
    url: Option<String>,
}

#[tauri::command]
pub async fn claude_auth_start(
    state: State<'_, ClaudeAuthState>,
) -> Result<ClaudeAuthStarted, String> {
    let bin = claude_binary().ok_or_else(|| "CLAUDE_CLI_MISSING".to_string())?;

    // `script` allocates the PTY the CLI needs while exposing plain pipes to us.
    // Widen the PTY first: the default 80 columns hard-wraps the ~108-char
    // token across lines, which once corrupted a captured token.
    let inner = format!("stty cols 500 2>/dev/null; exec \"{}\" setup-token", bin.display());
    let mut cmd = Command::new("script");
    if cfg!(target_os = "macos") {
        cmd.arg("-q").arg("/dev/null").arg("/bin/sh").arg("-c").arg(&inner);
    } else {
        cmd.arg("-qec").arg(&inner).arg("/dev/null");
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "CLAUDE_CLI_MISSING".to_string())?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let buffer = Arc::new(Mutex::new(String::new()));
    {
        let buffer = Arc::clone(&buffer);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]).to_string();
                        if let Ok(mut b) = buffer.lock() {
                            b.push_str(&text);
                        }
                    }
                }
            }
        });
    }

    // Replace any previous session.
    {
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = slot.take() {
            kill_session(&mut old);
        }
        *slot = Some(ClaudeAuthSession { child, stdin, buffer: Arc::clone(&buffer) });
    }

    // Give the CLI a moment to print the auth URL (it opens the browser itself).
    let url = tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if let Ok(b) = buffer.lock() {
                if let Some(m) = b.split_whitespace().find(|t| t.starts_with("https://")) {
                    return Some(m.trim_end_matches(|c: char| !c.is_ascii_graphic()).to_string());
                }
            }
        }
        None
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(ClaudeAuthStarted { url })
}

#[derive(Serialize)]
pub struct ClaudeAuthResult {
    token: String,
}

#[tauri::command]
pub async fn claude_auth_code(
    state: State<'_, ClaudeAuthState>,
    code: String,
) -> Result<ClaudeAuthResult, String> {
    let buffer = {
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        let session = slot.as_mut().ok_or("CLAUDE_PASTEBACK_BROKEN: no session")?;
        session
            .stdin
            .write_all(format!("{}\n", code.trim()).as_bytes())
            .map_err(|e| format!("CLAUDE_PASTEBACK_BROKEN: {e}"))?;
        let _ = session.stdin.flush();
        Arc::clone(&session.buffer)
    };

    // Wait for the CLI to print the token.
    let token = tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..150 {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if let Some(t) = find_token(&buffer, false) {
                return Some(t);
            }
        }
        find_token(&buffer, true)
    })
    .await
    .map_err(|e| e.to_string())?;

    // Session is done either way.
    if let Ok(mut slot) = state.0.lock() {
        if let Some(mut session) = slot.take() {
            kill_session(&mut session);
        }
    }

    match token {
        Some(token) => Ok(ClaudeAuthResult { token }),
        None => Err("CLAUDE_PASTEBACK_BROKEN: the CLI did not return a token".into()),
    }
}

#[derive(Serialize)]
pub struct ClaudeAuthPoll {
    /// Token found in the CLI output — the localhost-callback flow completes
    /// without ever showing the user a code to paste.
    token: Option<String>,
    /// True when the CLI exited without producing a token.
    exited: bool,
    /// Tail of the CLI output (ANSI-stripped) when it exited token-less, so
    /// the error panel shows what actually happened instead of guesswork.
    detail: Option<String>,
}

/// Strip ANSI escape sequences (CSI, OSC, lone ESC) — the CLI's TUI interleaves
/// them with the text it renders.
fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('[') => {
                // CSI: ESC [ params final-byte(@..~)
                chars.next();
                for c2 in chars.by_ref() {
                    if ('@'..='~').contains(&c2) {
                        break;
                    }
                }
            }
            Some(']') => {
                // OSC: ESC ] ... (BEL | ESC \)
                chars.next();
                while let Some(c2) = chars.next() {
                    if c2 == '\u{7}' {
                        break;
                    }
                    if c2 == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {
                chars.next();
            }
        }
    }
    out
}

/// Extract the OAuth token from PTY output.
///
/// Two candidate sources, union'd:
///  A. The RAW buffer: the token charset excludes ESC/spaces/newlines, so a
///     run terminates naturally at any of them — immune to ANSI-strip bugs.
///  B. The ANSI-stripped, per-line scan — catches a token interleaved with
///     escape sequences mid-run.
/// Only candidates of plausible length (90–120; wrap-truncated fragments and
/// repaint-glued runs fall outside) are accepted. Unless `allow_tail` (used
/// once the CLI exited), a candidate ending exactly at the buffer edge is
/// rejected — the tail may still be in flight.
fn extract_token(raw: &str, allow_tail: bool) -> Option<String> {
    let mut best: Option<(String, bool)> = None;
    let mut consider = |run: String, terminated: bool| {
        if run.len() <= 120
            && best.as_ref().map(|(b, _)| run.len() > b.len()).unwrap_or(true)
        {
            best = Some((run, terminated));
        }
    };

    // Source A: the raw byte stream. Works when the CLI happens to emit the
    // token contiguously (the token charset excludes ESC/space/newline).
    for (pos, _) in raw.match_indices("sk-ant-oat01-") {
        let rest = &raw[pos..];
        let run: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let terminated = rest.len() > run.len();
        consider(run, terminated);
    }

    // Source B: a real terminal emulation of the stream. The TUI renders
    // differentially — words placed with cursor jumps, unchanged cells never
    // re-emitted — so only the final screen grid contains the assembled text.
    let mut parser = vt100::Parser::new(200, 510, 0);
    parser.process(raw.as_bytes());
    let rendered = parser.screen().contents();
    for line in rendered.lines() {
        for (pos, _) in line.match_indices("sk-ant-oat01-") {
            let run: String = line[pos..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            // Grid lines are complete rows: the run is terminated by layout.
            consider(run, true);
        }
    }

    let (token, terminated) = best?;
    (token.len() >= 90 && (terminated || allow_tail)).then_some(token)
}

fn find_token(buffer: &Arc<Mutex<String>>, allow_tail: bool) -> Option<String> {
    let b = buffer.lock().ok()?;
    extract_token(&b, allow_tail)
}

fn buffer_tail(buffer: &Arc<Mutex<String>>) -> Option<String> {
    let b = buffer.lock().ok()?;
    // Raw tail with escapes made visible (\u{241b}) — an accurate view of what
    // the CLI emitted, for the error panel when sign-in ends token-less.
    let tail: String = b
        .chars()
        .rev()
        .take(600)
        .collect::<String>()
        .chars()
        .rev()
        .map(|c| if c == '\u{1b}' { '\u{241b}' } else { c })
        .collect();
    let trimmed = tail.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[tauri::command]
pub async fn claude_auth_poll(state: State<'_, ClaudeAuthState>) -> Result<ClaudeAuthPoll, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let Some(session) = slot.as_mut() else {
        return Ok(ClaudeAuthPoll { token: None, exited: true, detail: None });
    };
    if let Some(token) = find_token(&session.buffer, false) {
        let mut s = slot.take().expect("session present");
        kill_session(&mut s);
        return Ok(ClaudeAuthPoll { token: Some(token), exited: true, detail: None });
    }
    let exited = matches!(session.child.try_wait(), Ok(Some(_)));
    if exited {
        // Give the reader thread a beat to flush trailing output, then re-check.
        let buffer = Arc::clone(&session.buffer);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let token = find_token(&buffer, true);
        let detail = if token.is_none() { buffer_tail(&buffer) } else { None };
        let mut s = slot.take().expect("session present");
        kill_session(&mut s);
        return Ok(ClaudeAuthPoll { token, exited: true, detail });
    }
    Ok(ClaudeAuthPoll { token: None, exited: false, detail: None })
}

#[tauri::command]
pub async fn claude_auth_cancel(state: State<'_, ClaudeAuthState>) -> Result<(), String> {
    if let Ok(mut slot) = state.0.lock() {
        if let Some(mut session) = slot.take() {
            kill_session(&mut session);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_token, strip_ansi};

    // 13-char prefix + 95 chars = 108, the shape of a real setup token.
    const TOKEN: &str = "sk-ant-oat01-AbC123_deF456-gHi789jKl012MnO345pQr678StU901vWx234Yz567AbC890dEf123gHi456JkL789MnO012pQ";

    #[test]
    fn extracts_plain_token() {
        let raw = format!("Your token:\n{TOKEN}\nDone.");
        assert_eq!(extract_token(&raw, false).as_deref(), Some(TOKEN));
    }

    #[test]
    fn newline_terminates_token_without_gluing_next_line() {
        let raw = format!("{TOKEN}\nDone123\n");
        assert_eq!(extract_token(&raw, false).as_deref(), Some(TOKEN));
    }

    #[test]
    fn rejects_wrap_truncated_fragment() {
        let (a, b) = TOKEN.split_at(79);
        let raw = format!("token: {a}\r\n{b}\r\nDone.");
        assert_eq!(extract_token(&raw, false), None);
        assert_eq!(extract_token(&raw, true), None);
    }

    #[test]
    fn strips_ansi_around_token() {
        let esc = '\u{1b}';
        let raw = format!("{esc}[2K{esc}[1G{esc}[32m{TOKEN}{esc}[0m\nDone.");
        assert_eq!(extract_token(&raw, false).as_deref(), Some(TOKEN));
    }

    #[test]
    fn prefers_longest_candidate_over_truncated_repaint() {
        let partial = &TOKEN[..50];
        let esc = '\u{1b}';
        let raw = format!("{partial}{esc}[1G{TOKEN} ok\n");
        assert_eq!(extract_token(&raw, false).as_deref(), Some(TOKEN));
    }

    #[test]
    fn rejects_unterminated_tail_until_exit() {
        let raw = format!("printing {TOKEN}");
        assert_eq!(extract_token(&raw, false), None);
        assert_eq!(extract_token(&raw, true).as_deref(), Some(TOKEN));
    }

    #[test]
    fn assembles_token_from_differential_tui_rendering() {
        // Frame 1 prints the full token; frame 2 repaints it with cursor
        // jumps, skipping the unchanged column (the real CLI does exactly
        // this — the "o" of oat01 was never re-emitted).
        let esc = '\u{1b}';
        let rest = &TOKEN[8..]; // "at01-..." — skips the 'o' at column 8
        let raw = format!("{TOKEN}{esc}[1Gsk-ant-{esc}[9G{rest}\r\n");
        assert_eq!(extract_token(&raw, false).as_deref(), Some(TOKEN));
    }

    #[test]
    fn rejects_short_fragment() {
        assert_eq!(extract_token("sk-ant-oat01-tooshort \n", true), None);
    }

    #[test]
    fn strip_ansi_removes_osc_sequences() {
        assert_eq!(strip_ansi("\u{1b}]11;?\u{7}ok\u{1b}[6n"), "ok");
    }
}

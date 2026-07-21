// SSH sidecar that drives provision.sh on the target server. Uses the system
// OpenSSH binary so agent-held keys, ~/.ssh/config and two decades of sshd
// compatibility come for free. Secrets are streamed over stdin (never argv);
// progress NDJSON is forwarded to the frontend on a Channel.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

const PROVISION_LIB: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../scripts/provision/lib.sh"
));
const PROVISION_STEPS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../scripts/provision/steps.sh"
));
const PROVISION_MAIN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../scripts/provision/main.sh"
));

fn version_for_build(debug: bool) -> &'static str {
    if debug {
        "0.0.0-dev"
    } else {
        env!("CARGO_PKG_VERSION")
    }
}

fn hive_version() -> &'static str {
    version_for_build(cfg!(debug_assertions))
}

fn provision_script() -> String {
    format!(
        "#!/usr/bin/env bash\nSCRIPT_VERSION=\"{}\"\n{}\n{}\n{}\n",
        hive_version(),
        PROVISION_LIB,
        PROVISION_STEPS,
        PROVISION_MAIN
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    path: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#type: Option<String>,
    encrypted: bool,
    agent_loaded: bool,
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
    #[serde(default)]
    port: Option<u16>,
    /// Explicit tailnet-vs-local choice. Local mode is debug-only.
    skip_tailscale: bool,
}

impl ProvisionParams {
    fn ssh_user(&self) -> &str {
        self.user.as_deref().unwrap_or("root")
    }
}

fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty()
        || host.starts_with('-')
        || !host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b':' | b'-'))
    {
        return Err("SSH_UNREACHABLE: invalid host".into());
    }
    Ok(())
}

fn validate_user(user: &str) -> Result<(), String> {
    let mut chars = user.bytes();
    let valid_first = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == b'_');
    if !valid_first || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
    {
        return Err("SSH_AUTH_FAILED: invalid SSH user".into());
    }
    Ok(())
}

fn validate_key_path(key_path: &str) -> Result<(), String> {
    if key_path.trim().is_empty() || key_path.starts_with('-') || key_path.contains('\0') {
        return Err("SSH_AUTH_FAILED: invalid SSH key path".into());
    }
    Ok(())
}

fn validate_local_mode(skip_tailscale: bool, debug: bool) -> Result<(), String> {
    if skip_tailscale && !debug {
        return Err("TS_AUTHKEY_INVALID: local mode is only available in debug builds".into());
    }
    Ok(())
}

fn validate_params(params: &ProvisionParams) -> Result<(), String> {
    validate_host(&params.host)?;
    validate_user(params.ssh_user())?;
    validate_key_path(&params.key_path)?;
    if params.port == Some(0) {
        return Err("UNKNOWN: invalid backend port".into());
    }
    validate_local_mode(params.skip_tailscale, cfg!(debug_assertions))
}

/// Non-root users run the remote script through passwordless sudo.
fn sudo_prefix(user: &str) -> &'static str {
    if user == "root" {
        ""
    } else {
        "sudo -n "
    }
}

fn known_hosts_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|base| base.join("hive/known_hosts"))
        .ok_or_else(|| "UNKNOWN: configuration directory unavailable".into())
}

/// Options shared by ssh and scp invocations (scp takes no -l; the user goes
/// into its destination spec instead).
fn ssh_opts(key_path: &str) -> Result<Vec<String>, String> {
    Ok(vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=15".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        // Quote the path: ssh tokenizes -o values on whitespace, and the macOS
        // config dir ("Application Support") contains a space.
        "-o".into(),
        format!("UserKnownHostsFile=\"{}\"", known_hosts_path()?.display()),
        "-i".into(),
        key_path.to_string(),
    ])
}

fn ssh_common_args(key_path: &str, user: &str) -> Result<Vec<String>, String> {
    let mut args = ssh_opts(key_path)?;
    args.push("-l".into());
    args.push(user.to_string());
    Ok(args)
}

/// Map ssh stderr to a shared SetupErrorCode string.
fn ssh_error_code(stderr: &str) -> &'static str {
    let s = stderr.to_lowercase();
    if s.contains("host key verification failed")
        || s.contains("remote host identification has changed")
    {
        "SSH_HOST_KEY_CHANGED"
    } else if s.contains("a password is required")
        || s.contains("not in the sudoers")
        || s.contains("sudo: command not found")
    {
        "SSH_NO_ROOT"
    } else if s.contains("permission denied")
        || s.contains("no matching")
        || s.contains("authentication")
    {
        "SSH_AUTH_FAILED"
    } else {
        "SSH_UNREACHABLE"
    }
}

// ── list_keys ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn provision_list_keys() -> Vec<SshKey> {
    tauri::async_runtime::spawn_blocking(list_keys_blocking)
        .await
        .unwrap_or_default()
}

fn list_keys_blocking() -> Vec<SshKey> {
    let mut keys = Vec::new();
    let agent_keys = agent_key_identities();
    let Some(home) = dirs::home_dir() else {
        return keys;
    };
    let ssh_dir = home.join(".ssh");
    let Ok(entries) = std::fs::read_dir(&ssh_dir) else {
        return keys;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.extension().map(|e| e == "pub").unwrap_or(false) {
            continue;
        }
        if matches!(
            name.as_str(),
            "known_hosts" | "known_hosts.old" | "config" | "authorized_keys" | "agent.sock"
        ) {
            continue;
        }
        // A private key: either a matching .pub exists, or the file looks like one.
        let public_path = path.with_extension("pub");
        let has_public_key = public_path.exists();
        let looks_private = std::fs::read_to_string(&path)
            .map(|c| c.contains("PRIVATE KEY"))
            .unwrap_or(false);
        if !has_public_key && !looks_private {
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
                (false, Some(pk), ty)
            }
            _ => {
                // Failed with an empty passphrase: only an already-loaded
                // ssh-agent identity can use this key in BatchMode.
                let pk = std::fs::read_to_string(&public_path)
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
                let ty = pk
                    .as_deref()
                    .and_then(|value| value.split_whitespace().next().map(map_key_type));
                (true, pk, ty)
            }
        };
        let agent_loaded = public_key
            .as_deref()
            .and_then(public_key_identity)
            .is_some_and(|identity| agent_keys.contains(&identity));
        keys.push(SshKey {
            path: path.to_string_lossy().to_string(),
            label: name,
            r#type,
            encrypted,
            agent_loaded,
            public_key,
        });
    }
    keys.sort_by(|a, b| a.label.cmp(&b.label));
    keys
}

fn public_key_identity(public_key: &str) -> Option<String> {
    let mut fields = public_key.split_whitespace();
    let algorithm = fields.next()?;
    let blob = fields.next()?;
    Some(format!("{algorithm} {blob}"))
}

fn agent_key_identities() -> HashSet<String> {
    Command::new("ssh-add")
        .arg("-L")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(public_key_identity)
                .collect()
        })
        .unwrap_or_default()
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

fn is_valid_run_end(value: &serde_json::Value) -> bool {
    value.get("event").and_then(|event| event.as_str()) == Some("run_end")
        && matches!(
            value.get("status").and_then(|status| status.as_str()),
            Some("ok" | "error")
        )
}

// ── test_connection / trust_host (TOFU) ──────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl TestConnectionResult {
    fn err(code: &str) -> Self {
        Self {
            fingerprint: None,
            host_key: None,
            error: Some(code.into()),
        }
    }
}

fn keyscan(host: &str) -> Result<String, String> {
    let scan = Command::new("ssh-keyscan")
        .args(["-T", "10", "-t", "ed25519,ecdsa,rsa", host])
        .output();
    match scan {
        Ok(o) if !o.stdout.is_empty() => Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(o) => Err(ssh_error_code(&String::from_utf8_lossy(&o.stderr)).into()),
        Err(_) => Err("SSH_UNREACHABLE".into()),
    }
}

fn host_key_parts(line: &str) -> Option<(&str, &str, &str)> {
    if line.contains('\n') || line.contains('\r') {
        return None;
    }
    let mut fields = line.split_whitespace();
    let host = fields.next()?;
    let algorithm = fields.next()?;
    let blob = fields.next()?;
    (!host.starts_with('#')).then_some((host, algorithm, blob))
}

fn host_key_priority(algorithm: &str) -> Option<u8> {
    match algorithm {
        "ssh-ed25519" => Some(0),
        value if value.starts_with("ecdsa-sha2-") => Some(1),
        "ssh-rsa" => Some(2),
        _ => None,
    }
}

fn is_supported_host_key(line: &str) -> bool {
    host_key_parts(line)
        .and_then(|(_, algorithm, _)| host_key_priority(algorithm))
        .is_some()
}

fn select_host_key(scan: &str) -> Option<String> {
    scan.lines()
        .filter_map(|line| {
            let (_, algorithm, _) = host_key_parts(line)?;
            Some((host_key_priority(algorithm)?, line.trim()))
        })
        .min_by_key(|(priority, _)| *priority)
        .map(|(_, line)| line.to_string())
}

fn same_host_key(left: &str, right: &str) -> bool {
    match (host_key_parts(left), host_key_parts(right)) {
        (Some((_, left_algorithm, left_blob)), Some((_, right_algorithm, right_blob))) => {
            left_algorithm == right_algorithm && left_blob == right_blob
        }
        _ => false,
    }
}

fn fingerprint_for_host_key(host_key: &str) -> Result<String, String> {
    let mut keygen = Command::new("ssh-keygen")
        .args(["-l", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| "UNKNOWN".to_string())?;
    keygen
        .stdin
        .take()
        .ok_or_else(|| "UNKNOWN".to_string())?
        .write_all(format!("{host_key}\n").as_bytes())
        .map_err(|_| "UNKNOWN".to_string())?;
    let output = keygen
        .wait_with_output()
        .map_err(|_| "UNKNOWN".to_string())?;
    if !output.status.success() {
        return Err("UNKNOWN".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .nth(1)
        .map(str::to_string)
        .ok_or_else(|| "UNKNOWN".to_string())
}

#[tauri::command]
pub async fn provision_test_connection(host: String) -> TestConnectionResult {
    if validate_host(&host).is_err() {
        return TestConnectionResult::err("SSH_UNREACHABLE");
    }
    tauri::async_runtime::spawn_blocking(move || {
        let scan = match keyscan(&host) {
            Ok(s) => s,
            Err(code) => return TestConnectionResult::err(&code),
        };
        let Some(host_key) = select_host_key(&scan) else {
            return TestConnectionResult::err("UNKNOWN");
        };
        match fingerprint_for_host_key(&host_key) {
            Ok(fingerprint) => TestConnectionResult {
                fingerprint: Some(fingerprint),
                host_key: Some(host_key),
                error: None,
            },
            Err(code) => TestConnectionResult::err(&code),
        }
    })
    .await
    .unwrap_or_else(|_| TestConnectionResult::err("UNKNOWN"))
}

static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());
static UNIQUE_FILE_ID: AtomicU64 = AtomicU64::new(0);

fn known_host_matches(field: &str, host: &str) -> bool {
    field
        .split(',')
        .any(|entry| entry == host || entry == format!("[{host}]:22"))
}

fn replace_known_host(existing: &str, host: &str, host_key: &str) -> Result<String, String> {
    let (_, algorithm, blob) = host_key_parts(host_key).ok_or("SSH_HOST_KEY_CHANGED")?;
    let mut contents = existing
        .lines()
        .filter(|line| {
            line.split_whitespace()
                .next()
                .map_or(true, |field| !known_host_matches(field, host))
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    contents.push(format!("{host} {algorithm} {blob}"));
    Ok(contents.join("\n") + "\n")
}

fn write_known_host(host: &str, host_key: &str) -> Result<(), String> {
    let _guard = KNOWN_HOSTS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = known_hosts_path()?;
    let parent = path.parent().ok_or("UNKNOWN: invalid known_hosts path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }

    let existing = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };
    let contents = replace_known_host(&existing, host, host_key)?;

    let id = UNIQUE_FILE_ID.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".known_hosts-{}-{id}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|e| e.to_string())?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    if let Err(error) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn provision_trust_host(
    host: String,
    host_key: Option<String>,
    expected_host_key: Option<String>,
) -> Result<(), String> {
    validate_host(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let scanned = host_key.is_none();
        let selected = match host_key {
            Some(key) if is_supported_host_key(&key) => key,
            Some(_) => return Err("SSH_HOST_KEY_CHANGED: invalid host key".into()),
            None => select_host_key(&keyscan(&host)?).ok_or("SSH_UNREACHABLE")?,
        };
        if scanned && expected_host_key.is_none() {
            return Err("SSH_HOST_KEY_CHANGED: expected host key required".into());
        }
        if expected_host_key
            .as_deref()
            .is_some_and(|expected| !same_host_key(&selected, expected))
        {
            return Err("SSH_HOST_KEY_CHANGED: server key differs from the approved key".into());
        }
        write_known_host(&host, &selected)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── start provision ──────────────────────────────────────────────────────────

fn release_tarball(arch: &str) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Ok(p) = std::env::var("HIVE_DEV_RELEASE_TARBALL") {
        return Some(PathBuf::from(p));
    }
    let name = release_asset_name(hive_version(), arch);
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dist-release")
        .join(&name);
    dev.exists().then_some(dev)
}

fn release_asset_name(version: &str, arch: &str) -> String {
    format!("hive-backend-{version}-linux-{arch}.tar.gz")
}

/// `uname -m` on the server, mapped to the release arch tags.
fn probe_arch(params: &ProvisionParams) -> Result<String, String> {
    let out = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, params.ssh_user())?)
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

fn provision_args(
    params: &ProvisionParams,
    remote_release: Option<&str>,
) -> Result<Vec<String>, String> {
    provision_args_for_build(params, remote_release, cfg!(debug_assertions))
}

fn provision_args_for_build(
    params: &ProvisionParams,
    remote_release: Option<&str>,
    debug: bool,
) -> Result<Vec<String>, String> {
    let port = params.port.unwrap_or(3000);
    let mut args = vec!["--port".to_string(), port.to_string()];
    if params.skip_tailscale {
        validate_local_mode(true, debug)?;
        args.push("--local-dev".into());
    }
    args.push("--host".into());
    args.push("0.0.0.0".into());
    if let Some(path) = remote_release {
        if !debug {
            return Err("RELEASE_DOWNLOAD_FAILED: local release uploads are debug-only".into());
        }
        args.push("--dev-release-file".into());
        args.push(path.into());
    }
    Ok(args)
}

fn env_prelude(params: &ProvisionParams) -> String {
    if params.tailscale_auth_key.trim().is_empty() {
        return String::new();
    }
    format!(
        "TS_AUTHKEY='{}'\n",
        shell_single_quote(&params.tailscale_auth_key)
    )
}

fn shell_single_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn next_upload_paths() -> (String, String) {
    let id = UNIQUE_FILE_ID.fetch_add(1, Ordering::Relaxed);
    let name = format!("hive-backend-dev-{}-{id}.tar.gz", std::process::id());
    (name.clone(), format!("/var/lib/hive/uploads/{name}"))
}

fn scp_host(host: &str) -> String {
    if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn maybe_upload_release(
    params: &ProvisionParams,
    tarball: Option<&std::path::Path>,
) -> Result<Option<String>, String> {
    let Some(tarball) = tarball else {
        return Ok(None);
    };
    if !cfg!(debug_assertions) {
        return Err("RELEASE_DOWNLOAD_FAILED: local release uploads are debug-only".into());
    }
    let tarball = std::fs::canonicalize(tarball)
        .map_err(|error| format!("RELEASE_DOWNLOAD_FAILED: {error}"))?;
    if !tarball.is_file() {
        return Err("RELEASE_DOWNLOAD_FAILED: release path is not a file".into());
    }
    let user = params.ssh_user();
    let sudo = sudo_prefix(user);
    let (upload_name, remote_path) = next_upload_paths();
    let mut scp_args = ssh_opts(&params.key_path)?;
    scp_args.push(tarball.to_string_lossy().to_string());
    scp_args.push(format!("{user}@{}:{upload_name}", scp_host(&params.host)));
    let scp = Command::new("scp")
        .args(&scp_args)
        .output()
        .map_err(|e| e.to_string())?;
    if !scp.status.success() {
        return Err(format!(
            "RELEASE_DOWNLOAD_FAILED: {}",
            String::from_utf8_lossy(&scp.stderr)
        ));
    }
    let mv = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, user)?)
        .arg(&params.host)
        .arg(format!(
            "{sudo}mkdir -p /var/lib/hive/uploads && {sudo}mv -- ./{upload_name} {remote_path}"
        ))
        .output()
        .map_err(|e| e.to_string())?;
    if !mv.status.success() {
        return Err(ssh_error_code(&String::from_utf8_lossy(&mv.stderr)).into());
    }
    Ok(Some(remote_path))
}

fn run_provision(
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
    child_pid: Arc<Mutex<Option<u32>>>,
) -> Result<(), String> {
    validate_params(&params)?;
    let tarball = if cfg!(debug_assertions) {
        let arch = probe_arch(&params)?;
        release_tarball(&arch)
    } else {
        None
    };
    let remote_release = maybe_upload_release(&params, tarball.as_deref())?;

    let user = params.ssh_user().to_string();
    let prov_args = provision_args(&params, remote_release.as_deref())?;
    let command = format!("{}bash -s -- {}", sudo_prefix(&user), prov_args.join(" "));
    let remote = match remote_release.as_deref() {
        Some(path) => format!(
            "{command}; status=$?; {}rm -f -- {path}; exit $status",
            sudo_prefix(&user)
        ),
        None => command,
    };
    let stdin_payload = format!("{}{}", env_prelude(&params), provision_script());

    let mut child = Command::new("ssh")
        .args(ssh_common_args(&params.key_path, &user)?)
        .arg(&params.host)
        .arg(&remote)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    *child_pid.lock().unwrap() = Some(child.id());

    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(stdin_payload.as_bytes());
        // Dropping stdin closes it → bash sees EOF and runs.
    });

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer);
        buffer
    });
    let reader = BufReader::new(stdout);
    let mut saw_end = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if is_valid_run_end(&val) {
                saw_end = true;
            }
            let _ = on_event.send(val);
        }
    }
    let _ = writer.join();

    let status = child.wait();
    *child_pid.lock().unwrap() = None;
    let status = status.map_err(|e| e.to_string())?;
    let stderr_buf = stderr_reader.join().unwrap_or_default();

    if !saw_end {
        // The script never reported completion (SSH-level failure, or an exit
        // without run_end). Synthesize a terminal event so the UI never hangs.
        let (code, detail) = if status.success() {
            (
                "UNKNOWN".to_string(),
                "the provision script ended without reporting completion".to_string(),
            )
        } else {
            let detail = stderr_buf.trim();
            let mut start = detail.len().saturating_sub(500);
            while start < detail.len() && !detail.is_char_boundary(start) {
                start += 1;
            }
            (
                ssh_error_code(&stderr_buf).to_string(),
                detail[start..].to_string(),
            )
        };
        let _ = on_event.send(serde_json::json!({
            "v": 1, "seq": -1, "event": "run_end", "status": "error", "errorCode": code,
            "detail": detail
        }));
        return Err(format!("{code}: {detail}"));
    }
    Ok(())
}

#[derive(Clone, Default)]
pub struct ProvisionState {
    run_lock: Arc<Mutex<()>>,
    child_pid: Arc<Mutex<Option<u32>>>,
}

impl ProvisionState {
    /// Kill the ssh child of the active run, if any. The remote script is
    /// marker-resumable, so interrupting it is always safe.
    pub fn kill_active_run(&self) {
        if let Some(pid) = *self.child_pid.lock().unwrap() {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
    }
}

#[tauri::command]
pub async fn provision_start(
    state: State<'_, ProvisionState>,
    params: ProvisionParams,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    validate_params(&params)?;
    let lock = Arc::clone(&state.run_lock);
    let child_pid = Arc::clone(&state.child_pid);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .try_lock()
            .map_err(|_| "CONCURRENT_RUN: another provision run is active".to_string())?;
        run_provision(params, on_event, child_pid)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn provision_cancel(state: State<'_, ProvisionState>) {
    state.kill_active_run();
}

// ── local Claude sign-in (PTY-driven, code pasted back in the app) ───────────
//
// `claude setup-token` requires an interactive terminal: it opens the browser,
// then waits for the user to paste an authorization code before printing the
// OAuth token. We give it a pseudo-TTY via `script` so the app can drive the
// whole exchange: start → browser opens → the UI collects the code → the code
// is written to the CLI → claude_auth_poll picks the token out of its output.

pub struct ClaudeAuthSession {
    child: Child,
    stdin: ChildStdin,
    buffer: Arc<Mutex<String>>,
}

#[derive(Default)]
pub struct ClaudeAuthState(pub Mutex<Option<ClaudeAuthSession>>);

impl ClaudeAuthState {
    pub fn kill_active_session(&self) {
        if let Some(mut session) = self.0.lock().unwrap().take() {
            kill_session(&mut session);
        }
    }
}

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
    let inner = format!(
        "stty cols 500 2>/dev/null; exec '{}' setup-token",
        shell_single_quote(&bin.display().to_string())
    );
    let mut cmd = Command::new("script");
    if cfg!(target_os = "macos") {
        cmd.arg("-q")
            .arg("/dev/null")
            .arg("/bin/sh")
            .arg("-c")
            .arg(&inner);
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

    {
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = slot.take() {
            kill_session(&mut old);
        }
        *slot = Some(ClaudeAuthSession {
            child,
            stdin,
            buffer: Arc::clone(&buffer),
        });
    }

    // Give the CLI a moment to print the auth URL (it opens the browser itself).
    let url = tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if let Ok(b) = buffer.lock() {
                if let Some(m) = b.split_whitespace().find(|t| t.starts_with("https://")) {
                    return Some(
                        m.trim_end_matches(|c: char| !c.is_ascii_graphic())
                            .to_string(),
                    );
                }
            }
        }
        None
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(ClaudeAuthStarted { url })
}

/// Forward the pasted authorization code to the CLI. The token is not awaited
/// here — claude_auth_poll is the single delivery path, so the code write and
/// the background poll can never race a double submit.
#[tauri::command]
pub async fn claude_auth_code(
    state: State<'_, ClaudeAuthState>,
    code: String,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = slot.as_mut().ok_or("CLAUDE_PASTEBACK_BROKEN: no session")?;
    session
        .stdin
        .write_all(format!("{}\n", code.trim()).as_bytes())
        .map_err(|e| format!("CLAUDE_PASTEBACK_BROKEN: {e}"))?;
    let _ = session.stdin.flush();
    Ok(())
}

#[derive(Serialize)]
pub struct ClaudeAuthPoll {
    /// Token found in the CLI output — the localhost-callback flow completes
    /// without ever showing the user a code to paste.
    token: Option<String>,
    /// True when the CLI exited without producing a token.
    exited: bool,
    /// Tail of the CLI output when it exited token-less, so the error panel
    /// shows what actually happened instead of guesswork.
    detail: Option<String>,
}

/// Extract the OAuth token from PTY output.
///
/// Two candidate sources, union'd:
///  A. The RAW buffer: the token charset excludes ESC/spaces/newlines, so a
///     run terminates naturally at any of them — immune to ANSI-strip bugs.
///  B. A vt100 terminal emulation of the stream — the TUI renders
///     differentially (cursor jumps, unchanged cells never re-emitted), so
///     only the final screen grid contains the assembled text.
/// Only candidates of plausible length (90–120; wrap-truncated fragments and
/// repaint-glued runs fall outside) are accepted. Unless `allow_tail` (used
/// once the CLI exited), a candidate ending exactly at the buffer edge is
/// rejected — the tail may still be in flight.
fn extract_token(raw: &str, allow_tail: bool) -> Option<String> {
    let mut best: Option<(String, bool)> = None;
    let mut consider = |run: String, terminated: bool| {
        if run.len() <= 120
            && best
                .as_ref()
                .map(|(b, _)| run.len() > b.len())
                .unwrap_or(true)
        {
            best = Some((run, terminated));
        }
    };

    for (pos, _) in raw.match_indices("sk-ant-oat01-") {
        let rest = &raw[pos..];
        let run: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let terminated = rest.len() > run.len();
        consider(run, terminated);
    }

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
    let exited = {
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        let Some(session) = slot.as_mut() else {
            return Ok(ClaudeAuthPoll {
                token: None,
                exited: true,
                detail: None,
            });
        };
        if let Some(token) = find_token(&session.buffer, false) {
            let mut s = slot.take().expect("session present");
            kill_session(&mut s);
            return Ok(ClaudeAuthPoll {
                token: Some(token),
                exited: true,
                detail: None,
            });
        }
        matches!(session.child.try_wait(), Ok(Some(_)))
    };
    if !exited {
        return Ok(ClaudeAuthPoll {
            token: None,
            exited: false,
            detail: None,
        });
    }

    // The CLI exited: give the reader thread a beat to flush trailing output
    // (off the mutex, off the async executor), then re-check.
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(300))
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let Some(mut session) = slot.take() else {
        return Ok(ClaudeAuthPoll {
            token: None,
            exited: true,
            detail: None,
        });
    };
    let token = find_token(&session.buffer, true);
    let detail = if token.is_none() {
        buffer_tail(&session.buffer)
    } else {
        None
    };
    kill_session(&mut session);
    Ok(ClaudeAuthPoll {
        token,
        exited: true,
        detail,
    })
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
    use super::{
        env_prelude, extract_token, hive_version, is_valid_run_end, next_upload_paths,
        provision_args_for_build, provision_script, public_key_identity, release_asset_name,
        replace_known_host, same_host_key, scp_host, select_host_key, ssh_error_code,
        validate_host, validate_key_path, validate_local_mode, validate_user, version_for_build,
        ProvisionParams,
    };

    fn params(skip_tailscale: bool) -> ProvisionParams {
        ProvisionParams {
            host: "server.example.com".into(),
            user: Some("hive_admin".into()),
            key_path: "/home/user/.ssh/id_ed25519".into(),
            tailscale_auth_key: String::new(),
            port: Some(3000),
            skip_tailscale,
        }
    }

    #[test]
    fn validates_ssh_hosts_users_and_key_paths() {
        for host in ["203.0.113.10", "server.example.com", "fd7a:115c:a1e0::1"] {
            assert!(validate_host(host).is_ok(), "{host}");
        }
        for host in ["", "-oProxyCommand=bad", "server/path", "server name"] {
            assert!(validate_host(host).is_err(), "{host}");
        }

        for user in ["root", "_service", "hive.admin-2"] {
            assert!(validate_user(user).is_ok(), "{user}");
        }
        for user in ["", "-root", "2root", "root name", "root@host"] {
            assert!(validate_user(user).is_err(), "{user}");
        }

        assert!(validate_key_path("/home/user/.ssh/id_ed25519").is_ok());
        assert!(validate_key_path("").is_err());
        assert!(validate_key_path("-oProxyCommand=bad").is_err());
    }

    #[test]
    fn selects_one_host_key_in_preference_order() {
        let scan = concat!(
            "host ssh-rsa RSA_BLOB\n",
            "host ecdsa-sha2-nistp256 ECDSA_BLOB\n",
            "host ssh-ed25519 ED25519_BLOB\n",
        );
        assert_eq!(
            select_host_key(scan).as_deref(),
            Some("host ssh-ed25519 ED25519_BLOB")
        );
        assert_eq!(
            select_host_key("host ssh-rsa RSA\nhost ecdsa-sha2-nistp256 ECDSA\n").as_deref(),
            Some("host ecdsa-sha2-nistp256 ECDSA")
        );
    }

    #[test]
    fn compares_tailnet_key_by_algorithm_and_blob() {
        let public = "203.0.113.10 ssh-ed25519 SAME_KEY";
        let tailnet = "100.64.0.10 ssh-ed25519 SAME_KEY";
        assert!(same_host_key(public, tailnet));
        assert!(!same_host_key(
            public,
            "100.64.0.10 ssh-ed25519 DIFFERENT_KEY"
        ));
        assert!(!same_host_key(
            public,
            "100.64.0.10 ecdsa-sha2-nistp256 SAME_KEY"
        ));
    }

    #[test]
    fn replaces_only_the_matching_known_host_entry() {
        let existing = concat!(
            "server.example.com ssh-rsa OLD_KEY\n",
            "other.example.com ssh-ed25519 OTHER_KEY\n",
        );
        let replaced = replace_known_host(
            existing,
            "server.example.com",
            "server.example.com ssh-ed25519 NEW_KEY",
        )
        .expect("known_hosts contents");
        assert_eq!(
            replaced,
            concat!(
                "other.example.com ssh-ed25519 OTHER_KEY\n",
                "server.example.com ssh-ed25519 NEW_KEY\n",
            )
        );
    }

    #[test]
    fn release_build_rejects_debug_provision_flags() {
        assert!(validate_local_mode(true, false).is_err());
        assert!(provision_args_for_build(&params(true), None, false).is_err());
        assert!(provision_args_for_build(
            &params(false),
            Some("/var/lib/hive/uploads/dev.tar.gz"),
            false,
        )
        .is_err());

        let args = provision_args_for_build(
            &params(true),
            Some("/var/lib/hive/uploads/dev.tar.gz"),
            true,
        )
        .expect("debug flags");
        assert!(args.contains(&"--local-dev".to_string()));
        assert!(args.contains(&"--dev-release-file".to_string()));
    }

    #[test]
    fn tailscale_key_is_a_local_shell_variable() {
        let mut provision = params(false);
        assert_eq!(env_prelude(&provision), "");

        provision.tailscale_auth_key = "tskey-auth-a'b".into();
        let prelude = env_prelude(&provision);
        assert_eq!(prelude, "TS_AUTHKEY='tskey-auth-a'\\''b'\n");
        assert!(!prelude.contains("export"));
    }

    #[test]
    fn cargo_version_drives_release_assets_and_embedded_script() {
        assert_eq!(version_for_build(true), "0.0.0-dev");
        assert_eq!(version_for_build(false), env!("CARGO_PKG_VERSION"));
        assert_eq!(hive_version(), version_for_build(cfg!(debug_assertions)));
        assert_eq!(
            release_asset_name("1.2.3", "arm64"),
            "hive-backend-1.2.3-linux-arm64.tar.gz"
        );
        let script = provision_script();
        assert!(script.starts_with(&format!(
            "#!/usr/bin/env bash\nSCRIPT_VERSION=\"{}\"\n",
            hive_version()
        )));
        assert!(script.contains("parse_args()"));
    }

    #[test]
    fn debug_upload_paths_are_unique_and_ipv6_scp_hosts_are_bracketed() {
        let (_, first) = next_upload_paths();
        let (_, second) = next_upload_paths();
        assert_ne!(first, second);
        assert!(first.starts_with("/var/lib/hive/uploads/hive-backend-dev-"));
        assert_eq!(scp_host("203.0.113.10"), "203.0.113.10");
        assert_eq!(scp_host("fd7a:115c:a1e0::1"), "[fd7a:115c:a1e0::1]");
    }

    #[test]
    fn maps_ssh_failures_to_setup_error_codes() {
        assert_eq!(
            ssh_error_code("Host key verification failed"),
            "SSH_HOST_KEY_CHANGED"
        );
        assert_eq!(
            ssh_error_code("sudo: a password is required"),
            "SSH_NO_ROOT"
        );
        assert_eq!(
            ssh_error_code("Permission denied (publickey)"),
            "SSH_AUTH_FAILED"
        );
        assert_eq!(ssh_error_code("Connection timed out"), "SSH_UNREACHABLE");
    }

    #[test]
    fn accepts_only_explicit_terminal_run_statuses() {
        assert!(is_valid_run_end(&serde_json::json!({
            "event": "run_end",
            "status": "ok"
        })));
        assert!(is_valid_run_end(&serde_json::json!({
            "event": "run_end",
            "status": "error"
        })));
        assert!(!is_valid_run_end(&serde_json::json!({
            "event": "run_end",
            "status": "done"
        })));
        assert!(!is_valid_run_end(&serde_json::json!({
            "event": "run_end"
        })));
    }

    #[test]
    fn compares_agent_keys_without_comments() {
        assert_eq!(
            public_key_identity("ssh-ed25519 AAAATEST workstation").as_deref(),
            Some("ssh-ed25519 AAAATEST")
        );
        assert_eq!(public_key_identity("not-enough-fields"), None);
    }

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
}

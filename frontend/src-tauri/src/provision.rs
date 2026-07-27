//! SSH sidecar that drives `scripts/provision` on the operator's server.
//!
//! The system OpenSSH binary does the transport, so agent-held keys, the
//! operator's `~/.ssh/config` and two decades of sshd compatibility come for
//! free. Three properties are load-bearing:
//!
//!  * the provisioning script is **never written to the server's disk** — it is
//!    streamed to a `bash -s` reading standard input;
//!  * host keys are trusted in an **app-private** known-hosts file, so Hive
//!    never edits the operator's own SSH configuration;
//!  * the escalation password, when one is needed, travels only at the head of
//!    that same standard-input stream — never in argv, never on disk, never in
//!    persisted state, and never in output that reaches the UI or a log.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

// ── error taxonomy ───────────────────────────────────────────────────────────

/// Transport-level codes owned by this sidecar. The install run's own failures
/// use `SETUP_ERROR_CODES` from `scripts/provision/lib.sh`; these cover
/// everything that goes wrong before or around it. Mirrored in
/// `shared/setup-errors.ts` as `SSH_ERROR_CODES`, which the test below asserts.
pub const SSH_ERROR_CODES: &[&str] = &[
    "SSH_INVALID_INPUT",
    "SSH_UNREACHABLE",
    "SSH_AUTH_FAILED",
    "SSH_HOST_KEY_UNKNOWN",
    "SSH_HOST_KEY_CHANGED",
    "SSH_ESCALATION_FAILED",
    "SSH_PASSWORD_REQUIRED",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionError {
    code: String,
    detail: String,
}

impl ProvisionError {
    fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.into(),
        }
    }

    fn unknown(detail: impl Into<String>) -> Self {
        Self::new("UNKNOWN", detail)
    }

    fn invalid(detail: impl Into<String>) -> Self {
        Self::new("SSH_INVALID_INPUT", detail)
    }

    /// A terminal record shaped like the script's own `run_end`, so a run that
    /// dies before or outside the script still closes the progress stream.
    fn as_run_end(&self) -> serde_json::Value {
        serde_json::json!({
            "v": 1,
            "seq": -1,
            "event": "run_end",
            "status": "error",
            "errorCode": self.code,
            "detail": self.detail,
        })
    }
}

// ── secrets ──────────────────────────────────────────────────────────────────

const REDACTED: &str = "[redacted]";

/// A value that must never reach argv, disk, a log, or persisted state. Held as
/// bytes so it can be zeroed on drop without `unsafe`, and its `Debug` is
/// redacted so it cannot leak through a derived formatter.
pub struct Secret(Vec<u8>);

impl Secret {
    fn expose(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or("")
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.iter_mut().for_each(|byte| *byte = 0);
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(String::deserialize(deserializer)?.into_bytes()))
    }
}

#[cfg(test)]
impl From<&str> for Secret {
    fn from(value: &str) -> Self {
        Self(value.as_bytes().to_vec())
    }
}

/// Strip the password out of anything captured from the remote side. Applied to
/// every stdout line before it is parsed and to the whole stderr buffer, so no
/// path from the wire to the UI or a log can carry it.
fn redact(text: &str, secret: Option<&Secret>) -> String {
    match secret {
        Some(secret) if !secret.is_empty() => text.replace(secret.expose(), REDACTED),
        _ => text.to_string(),
    }
}

/// sudo reads exactly one line for the password. A value that cannot be sent as
/// one line would leave its tail in front of the script, so it is refused here
/// rather than half-sent.
fn validate_password(secret: &Secret) -> Result<(), ProvisionError> {
    if secret.is_empty() {
        return Err(ProvisionError::invalid("the escalation password is empty"));
    }
    if secret
        .expose()
        .bytes()
        .any(|byte| byte < 0x20 || byte == 0x7f)
    {
        return Err(ProvisionError::invalid(
            "the escalation password contains a control character and cannot be sent as one line",
        ));
    }
    Ok(())
}

// ── embedded provisioning script ─────────────────────────────────────────────

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

/// Bundle the fragments exactly the way `scripts/provision/build.sh` does: the
/// whole body inside one function that is called on the last line, so a stream
/// truncated anywhere in the middle is a syntax error at EOF and executes
/// nothing. The `shell=bash` directives belong at the top of a file and are
/// dropped, as in the published bundle.
fn provision_script() -> String {
    let mut script = String::with_capacity(
        PROVISION_LIB.len() + PROVISION_STEPS.len() + PROVISION_MAIN.len() + 128,
    );
    script.push_str("#!/usr/bin/env bash\n");
    script.push_str(&format!("SCRIPT_VERSION=\"{}\"\n", hive_version()));
    script.push_str("__hive_provision() {\n");
    for fragment in [PROVISION_LIB, PROVISION_STEPS, PROVISION_MAIN] {
        for line in fragment.lines() {
            if line == "# shellcheck shell=bash" {
                continue;
            }
            script.push_str(line);
            script.push('\n');
        }
    }
    script.push_str("}\n__hive_provision \"$@\"\n");
    script
}

/// The bytes written to the remote shell's standard input. When a password is
/// present it is the first line: `sudo -S` reads it one byte at a time and
/// consumes the newline, so everything after it reaches bash byte-identically.
fn stdin_payload(password: Option<&Secret>) -> Vec<u8> {
    let mut payload = Vec::new();
    if let Some(secret) = password {
        payload.extend_from_slice(secret.expose().as_bytes());
        payload.push(b'\n');
    }
    payload.extend_from_slice(provision_script().as_bytes());
    payload
}

// ── input validation ─────────────────────────────────────────────────────────
//
// Every value below is either an ssh argument or a word in the remote command
// string. Nothing may start with `-`, so no value can be read as an option.

fn validate_host(host: &str) -> Result<(), ProvisionError> {
    let shaped = !host.is_empty()
        && !host.starts_with('-')
        && host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b':' | b'-'));
    if shaped {
        Ok(())
    } else {
        Err(ProvisionError::invalid(format!("invalid host: {host:?}")))
    }
}

fn validate_user(user: &str) -> Result<(), ProvisionError> {
    let mut bytes = user.bytes();
    let first_ok = bytes
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == b'_');
    let rest_ok = bytes.all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    if first_ok && rest_ok {
        Ok(())
    } else {
        Err(ProvisionError::invalid(format!(
            "invalid SSH user: {user:?}"
        )))
    }
}

fn validate_key_path(key_path: &str) -> Result<(), ProvisionError> {
    if key_path.trim().is_empty() || key_path.starts_with('-') || key_path.contains('\0') {
        return Err(ProvisionError::invalid(format!(
            "invalid SSH key path: {key_path:?}"
        )));
    }
    Ok(())
}

/// Same shape `main.sh` enforces: absolute, no traversal, no shell
/// metacharacters. Rejecting here keeps the sidecar from ever building a remote
/// command the script would refuse anyway.
fn validate_directory(label: &str, path: &str) -> Result<(), ProvisionError> {
    let shaped = path.starts_with('/')
        && !path.contains("..")
        && path.len() > 1
        && path
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'/' | b'.' | b'_' | b'-'));
    if shaped {
        Ok(())
    } else {
        Err(ProvisionError::invalid(format!(
            "invalid {label}: {path:?} (must be an absolute path with no traversal)"
        )))
    }
}

fn validate_network_mode(mode: &str) -> Result<(), ProvisionError> {
    if matches!(mode, "public" | "tailnet") {
        Ok(())
    } else {
        Err(ProvisionError::invalid(format!(
            "invalid network mode: {mode:?} (expected public or tailnet)"
        )))
    }
}

fn validate_interface(interface: &str) -> Result<(), ProvisionError> {
    let shaped = !interface.is_empty()
        && !interface.starts_with('-')
        && interface
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    if shaped {
        Ok(())
    } else {
        Err(ProvisionError::invalid(format!(
            "invalid network interface: {interface:?}"
        )))
    }
}

const PUBLIC_KEY_ALGORITHMS: &[&str] = &[
    "ssh-ed25519",
    "ssh-rsa",
    "ssh-dss",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "sk-ssh-ed25519@openssh.com",
    "sk-ecdsa-sha2-nistp256@openssh.com",
];

/// Accept exactly what `ssh_key_valid` in `steps.sh` accepts, and hand on only
/// `<algorithm> <blob>`: the trailing comment identifies the operator's machine
/// and account, and the server has no use for it.
fn normalize_public_key(key: &str) -> Result<String, ProvisionError> {
    let mut fields = key.split_whitespace();
    let algorithm = fields.next().unwrap_or_default();
    let blob = fields.next().unwrap_or_default();
    // The smallest real OpenSSH blob (ed25519) is 68 base64 characters, so a
    // floor of 40 rejects nonsense without ever refusing a key the server's own
    // `ssh_key_valid` would take.
    let blob_ok = blob.len() >= 40
        && blob
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'/' | b'='));
    if !PUBLIC_KEY_ALGORITHMS.contains(&algorithm) || !blob_ok {
        return Err(ProvisionError::invalid(
            "not a valid OpenSSH public key: expected '<algorithm> <base64 blob>'",
        ));
    }
    Ok(format!("{algorithm} {blob}"))
}

/// Wrap a value so the remote login shell passes it through as one word. Every
/// script argument goes through this — a public key contains spaces.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// ── connection and options ───────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    host: String,
    /// Defaults to root. Any other account escalates, with or without a
    /// password, as the script's preflight decides.
    #[serde(default)]
    user: Option<String>,
    key_path: String,
}

impl Connection {
    fn user(&self) -> &str {
        self.user.as_deref().unwrap_or("root")
    }

    fn validate(&self) -> Result<(), ProvisionError> {
        validate_host(&self.host)?;
        validate_user(self.user())?;
        validate_key_path(&self.key_path)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProvisionOptions {
    port: Option<u16>,
    install_dir: Option<String>,
    data_dir: Option<String>,
    network_mode: Option<String>,
    tailnet_interface: Option<String>,
    /// Authorized on the hive service account, so an editor or terminal session
    /// connects as hive rather than as the install account.
    ssh_public_key: Option<String>,
    reset: bool,
}

impl ProvisionOptions {
    fn validate(&self) -> Result<(), ProvisionError> {
        if self.port == Some(0) {
            return Err(ProvisionError::invalid("invalid backend port: 0"));
        }
        if let Some(dir) = &self.install_dir {
            validate_directory("install directory", dir)?;
        }
        if let Some(dir) = &self.data_dir {
            validate_directory("data directory", dir)?;
        }
        if let Some(mode) = &self.network_mode {
            validate_network_mode(mode)?;
        }
        if let Some(interface) = &self.tailnet_interface {
            validate_interface(interface)?;
        }
        if let Some(key) = &self.ssh_public_key {
            normalize_public_key(key)?;
        }
        Ok(())
    }

    fn script_args(&self, preflight: bool) -> Result<Vec<String>, ProvisionError> {
        self.validate()?;
        let mut args = Vec::new();
        if preflight {
            args.push("--preflight".to_string());
        }
        if let Some(port) = self.port {
            args.push("--port".into());
            args.push(port.to_string());
        }
        if let Some(dir) = &self.install_dir {
            args.push("--install-dir".into());
            args.push(dir.clone());
        }
        if let Some(dir) = &self.data_dir {
            args.push("--data-dir".into());
            args.push(dir.clone());
        }
        if let Some(mode) = &self.network_mode {
            args.push("--network-mode".into());
            args.push(mode.clone());
        }
        if let Some(interface) = &self.tailnet_interface {
            args.push("--tailnet-interface".into());
            args.push(interface.clone());
        }
        if let Some(key) = &self.ssh_public_key {
            args.push("--ssh-public-key".into());
            args.push(normalize_public_key(key)?);
        }
        // --reset discards recorded step state; preflight records none.
        if self.reset && !preflight {
            args.push("--reset".into());
        }
        Ok(args)
    }
}

// ── privilege modes ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrivilegeMode {
    /// The login is already root; nothing is prefixed.
    Root,
    /// The account escalates without being asked for a password.
    SudoNoPassword,
    /// The account escalates with a password, sent at the head of stdin.
    SudoPassword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeFinding {
    root: bool,
    sudo_no_password: bool,
    mode: PrivilegeMode,
}

/// Read the mode off the script's own `privilege` preflight check. Nothing else
/// may decide it: a password sent to a sudo that never reads it becomes the
/// first line of the script, in cleartext, in the error output.
fn privilege_finding(checks: &[PreflightCheck]) -> Option<PrivilegeFinding> {
    let data = checks
        .iter()
        .find(|check| check.check == "privilege")?
        .data
        .as_ref()?;
    let root = data.get("root")?.as_bool()?;
    let sudo_no_password = data.get("sudoNoPassword")?.as_bool()?;
    let mode = if root {
        PrivilegeMode::Root
    } else if sudo_no_password {
        PrivilegeMode::SudoNoPassword
    } else {
        PrivilegeMode::SudoPassword
    };
    Some(PrivilegeFinding {
        root,
        sudo_no_password,
        mode,
    })
}

/// The remote command line. `-k` makes sudo ignore any cached credential, so a
/// still-valid ticket cannot cause the password line to go unread; `-S` reads
/// it from stdin; `-p ''` suppresses the prompt (which goes to stderr, leaving
/// the NDJSON on stdout clean).
fn remote_command(mode: PrivilegeMode, args: &[String]) -> String {
    let prefix = match mode {
        PrivilegeMode::Root => "",
        PrivilegeMode::SudoNoPassword => "sudo -n -- ",
        PrivilegeMode::SudoPassword => "sudo -k -S -p '' -- ",
    };
    let quoted: Vec<String> = args.iter().map(|arg| shell_quote(arg)).collect();
    format!("{prefix}bash -s -- {}", quoted.join(" "))
}

// ── ssh transport ────────────────────────────────────────────────────────────

fn known_hosts_path() -> Result<PathBuf, ProvisionError> {
    dirs::config_dir()
        .map(|base| base.join("hive/known_hosts"))
        .ok_or_else(|| ProvisionError::unknown("configuration directory unavailable"))
}

fn ssh_args(connection: &Connection) -> Result<Vec<String>, ProvisionError> {
    let known_hosts = known_hosts_path()?;
    Ok(vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=15".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        // ssh splits -o values on whitespace and the macOS configuration
        // directory ("Application Support") contains one, so quote the path.
        "-o".into(),
        format!("UserKnownHostsFile=\"{}\"", known_hosts.display()),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        // apt and the Node download idle longer than a default NAT timeout.
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=8".into(),
        "-i".into(),
        connection.key_path.clone(),
        "-l".into(),
        connection.user().to_string(),
    ])
}

/// Map ssh and sudo diagnostics onto the sidecar's codes. Order matters: the
/// unknown-host refusal also says "Host key verification failed", and it means
/// something entirely different from a key that changed.
fn ssh_error_code(stderr: &str) -> &'static str {
    let text = stderr.to_lowercase();
    if text.contains("remote host identification has changed") {
        "SSH_HOST_KEY_CHANGED"
    } else if text.contains("host key is known for")
        || text.contains("no matching host key fingerprint")
    {
        "SSH_HOST_KEY_UNKNOWN"
    } else if text.contains("host key verification failed") {
        "SSH_HOST_KEY_CHANGED"
    } else if text.contains("incorrect password attempt")
        || text.contains("a password is required")
        || text.contains("is not in the sudoers file")
        || text.contains("sudo: command not found")
        || text.contains("no tty present")
        || text.contains("sorry, try again")
    {
        "SSH_ESCALATION_FAILED"
    } else if text.contains("permission denied")
        || text.contains("no matching")
        || text.contains("authentication")
    {
        "SSH_AUTH_FAILED"
    } else {
        "SSH_UNREACHABLE"
    }
}

/// Last `limit` bytes of a diagnostic, cut on a character boundary.
fn tail(text: &str, limit: usize) -> &str {
    let mut start = text.len().saturating_sub(limit);
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

struct RemoteOutcome {
    /// The `run_end` record the script emitted, if it got that far.
    terminal: Option<serde_json::Value>,
    success: bool,
    /// Already redacted.
    stderr: String,
}

fn is_run_end(value: &serde_json::Value) -> bool {
    value.get("event").and_then(serde_json::Value::as_str) == Some("run_end")
        && matches!(
            value.get("status").and_then(serde_json::Value::as_str),
            Some("ok" | "error")
        )
}

/// Build a typed error out of what a run produced when it never reported a
/// terminal record, so a dead connection is never an open-ended wait.
fn terminal_error(outcome: &RemoteOutcome) -> ProvisionError {
    if outcome.success {
        return ProvisionError::unknown(
            "the provisioning script ended without reporting completion",
        );
    }
    let detail = tail(outcome.stderr.trim(), 500).trim();
    let detail = if detail.is_empty() {
        "the connection ended without a diagnostic".to_string()
    } else {
        detail.to_string()
    };
    ProvisionError::new(ssh_error_code(&outcome.stderr), detail)
}

/// Run one remote command with the payload on its standard input, forwarding
/// every NDJSON record to `on_record` as it arrives.
fn run_remote(
    connection: &Connection,
    command: &str,
    payload: Vec<u8>,
    password: Option<&Secret>,
    tracker: &Arc<Mutex<Option<u32>>>,
    on_record: &mut dyn FnMut(serde_json::Value),
) -> Result<RemoteOutcome, ProvisionError> {
    let mut child = Command::new("ssh")
        .args(ssh_args(connection)?)
        .arg(&connection.host)
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ProvisionError::new("SSH_UNREACHABLE", format!("could not start ssh: {error}"))
        })?;
    // Take the pipes before publishing the pid: a tracker holding the pid of a
    // child this function then abandoned would let a later cancel signal a
    // process id that has since been reused.
    let (stdin, stdout, stderr) =
        match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProvisionError::unknown("ssh pipes unavailable"));
            }
        };
    if let Ok(mut slot) = tracker.lock() {
        *slot = Some(child.id());
    }

    let mut stdin = stdin;
    let writer = std::thread::spawn(move || {
        let mut payload = payload;
        let _ = stdin.write_all(&payload).and_then(|()| stdin.flush());
        payload.iter_mut().for_each(|byte| *byte = 0);
        // Dropping stdin closes it, and bash sees EOF and runs.
    });

    let mut stderr = stderr;
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });

    let mut terminal = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        // Redact before parsing: no path from the wire to the UI can carry the
        // password, not even one this sidecar did not anticipate.
        let line = redact(&line, password);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if is_run_end(&record) {
            terminal = Some(record.clone());
        }
        on_record(record);
    }
    let _ = writer.join();

    let status = child.wait();
    if let Ok(mut slot) = tracker.lock() {
        *slot = None;
    }
    let status = status.map_err(|error| ProvisionError::unknown(error.to_string()))?;
    let stderr_raw = stderr_reader.join().unwrap_or_default();
    let stderr = redact(&String::from_utf8_lossy(&stderr_raw), password);

    Ok(RemoteOutcome {
        terminal,
        success: status.success(),
        stderr,
    })
}

// ── the operator's SSH keys ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    path: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_type: Option<String>,
    /// Passphrase-protected.
    encrypted: bool,
    agent_loaded: bool,
    /// Whether this key can authenticate in BatchMode: either it has no
    /// passphrase, or an agent already holds it.
    usable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    public_key: Option<String>,
}

/// An identity as the agent reports it: algorithm and blob, without the
/// comment, which differs between the file and the agent's copy.
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

fn map_key_type(algorithm: &str) -> String {
    match algorithm {
        "ssh-ed25519" => "ed25519".into(),
        "ssh-rsa" => "rsa".into(),
        "ssh-dss" => "dsa".into(),
        value if value.starts_with("ecdsa") => "ecdsa".into(),
        value if value.starts_with("sk-") => "security-key".into(),
        other => other.to_string(),
    }
}

/// A private key file always carries a PEM header naming it one. Testing the
/// content rather than the file name is what keeps `known_hosts`, `config`,
/// `authorized_keys` and every other resident of ~/.ssh out of the list without
/// a name blocklist that has to be kept up to date.
fn looks_like_private_key(head: &[u8]) -> bool {
    String::from_utf8_lossy(head).contains("PRIVATE KEY")
}

fn read_head(path: &std::path::Path, limit: usize) -> Option<Vec<u8>> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut head = vec![0u8; limit];
    let read = file.read(&mut head).ok()?;
    head.truncate(read);
    Some(head)
}

fn list_keys_blocking() -> Vec<SshKey> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(home.join(".ssh")) else {
        return Vec::new();
    };
    let agent_keys = agent_key_identities();
    let mut keys = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().is_some_and(|value| value == "pub") {
            continue;
        }
        let Some(head) = read_head(&path, 4096) else {
            continue;
        };
        if !looks_like_private_key(&head) {
            continue;
        }

        // ssh-keygen with an empty passphrase both proves the key is readable
        // and yields its public half; failing means a passphrase guards it.
        let derived = Command::new("ssh-keygen")
            .args(["-y", "-P", "", "-f"])
            .arg(&path)
            .output();
        let (encrypted, public_key) = match derived {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (false, Some(text).filter(|value| !value.is_empty()))
            }
            _ => {
                let sibling = std::fs::read_to_string(path.with_extension("pub"))
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
                (true, sibling)
            }
        };
        let key_type = public_key
            .as_deref()
            .and_then(|value| value.split_whitespace().next())
            .map(map_key_type);
        let agent_loaded = public_key
            .as_deref()
            .and_then(public_key_identity)
            .is_some_and(|identity| agent_keys.contains(&identity));

        keys.push(SshKey {
            path: path.to_string_lossy().to_string(),
            label: entry.file_name().to_string_lossy().to_string(),
            key_type,
            encrypted,
            agent_loaded,
            usable: !encrypted || agent_loaded,
            public_key,
        });
    }
    keys.sort_by(|left, right| left.label.cmp(&right.label));
    keys
}

// ── host identity ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentity {
    /// The full known-hosts line, to be handed back to `provision_trust_host`.
    host_key: String,
    fingerprint: String,
    key_type: String,
    /// Already present in the app-private store, byte-for-byte.
    trusted: bool,
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

/// Modern first. ed25519 is preferred, ecdsa accepted, rsa taken only when the
/// server offers nothing better.
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

fn keyscan(host: &str) -> Result<String, ProvisionError> {
    let scan = Command::new("ssh-keyscan")
        .args(["-T", "10", "-t", "ed25519,ecdsa,rsa", host])
        .output();
    match scan {
        Ok(output) if !output.stdout.is_empty() => {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(ProvisionError::new(
                ssh_error_code(&stderr),
                format!("no host key from {host}: {}", tail(stderr.trim(), 300)),
            ))
        }
        Err(error) => Err(ProvisionError::new(
            "SSH_UNREACHABLE",
            format!("could not run ssh-keyscan: {error}"),
        )),
    }
}

fn fingerprint_for_host_key(host_key: &str) -> Result<String, ProvisionError> {
    let mut keygen = Command::new("ssh-keygen")
        .args(["-l", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| ProvisionError::unknown(format!("could not run ssh-keygen: {error}")))?;
    keygen
        .stdin
        .take()
        .ok_or_else(|| ProvisionError::unknown("ssh-keygen stdin unavailable"))?
        .write_all(format!("{host_key}\n").as_bytes())
        .map_err(|error| ProvisionError::unknown(error.to_string()))?;
    let output = keygen
        .wait_with_output()
        .map_err(|error| ProvisionError::unknown(error.to_string()))?;
    if !output.status.success() {
        return Err(ProvisionError::unknown("the host key could not be parsed"));
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .nth(1)
        .map(str::to_string)
        .ok_or_else(|| ProvisionError::unknown("ssh-keygen printed no fingerprint"))
}

static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());
static UNIQUE_FILE_ID: AtomicU64 = AtomicU64::new(0);

fn known_host_matches(field: &str, host: &str) -> bool {
    field
        .split(',')
        .any(|entry| entry == host || entry == format!("[{host}]:22"))
}

/// The entry currently trusted for `host`, if any.
fn known_host_entry(existing: &str, host: &str) -> Option<String> {
    existing
        .lines()
        .find(|line| {
            line.split_whitespace()
                .next()
                .is_some_and(|field| known_host_matches(field, host))
        })
        .map(str::to_string)
}

fn read_known_hosts() -> Result<String, ProvisionError> {
    match std::fs::read_to_string(known_hosts_path()?) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(ProvisionError::unknown(error.to_string())),
    }
}

fn replace_known_host(
    existing: &str,
    host: &str,
    host_key: &str,
) -> Result<String, ProvisionError> {
    let (_, algorithm, blob) =
        host_key_parts(host_key).ok_or_else(|| ProvisionError::invalid("malformed host key"))?;
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

/// Written to Hive's own configuration directory, never to the operator's
/// ~/.ssh/known_hosts: approving a server for Hive must not change how the
/// operator's own ssh behaves.
fn write_known_host(host: &str, host_key: &str) -> Result<(), ProvisionError> {
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|error| ProvisionError::unknown(error.to_string()))?;
    let path = known_hosts_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| ProvisionError::unknown("invalid known_hosts path"))?;
    std::fs::create_dir_all(parent).map_err(|error| ProvisionError::unknown(error.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| ProvisionError::unknown(error.to_string()))?;
    }

    let existing = read_known_hosts()?;
    if let Some(entry) = known_host_entry(&existing, host) {
        if !same_host_key(&entry, host_key) {
            return Err(ProvisionError::new(
                "SSH_HOST_KEY_CHANGED",
                format!("{host} is already trusted with a different key; it is not re-trusted"),
            ));
        }
    }
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
    let mut file = options
        .open(&temp)
        .map_err(|error| ProvisionError::unknown(error.to_string()))?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all())
    {
        let _ = std::fs::remove_file(&temp);
        return Err(ProvisionError::unknown(error.to_string()));
    }
    if let Err(error) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProvisionError::unknown(error.to_string()));
    }
    Ok(())
}

// ── preflight ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    check: String,
    /// `ok`, `warn` or `fail`.
    status: String,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    /// The code the install would fail with, on a failing check.
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    ok: bool,
    blockers: Vec<String>,
    checks: Vec<PreflightCheck>,
    privilege: PrivilegeFinding,
    #[serde(skip_serializing_if = "Option::is_none")]
    script_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
}

fn string_field(record: &serde_json::Value, key: &str) -> Option<String> {
    record
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn preflight_check(record: &serde_json::Value) -> Option<PreflightCheck> {
    if record.get("event").and_then(serde_json::Value::as_str) != Some("preflight_check") {
        return None;
    }
    Some(PreflightCheck {
        check: string_field(record, "check")?,
        status: string_field(record, "status")?,
        detail: string_field(record, "detail").unwrap_or_default(),
        data: record.get("data").cloned(),
        error_code: string_field(record, "errorCode"),
    })
}

/// Turn the raw preflight stream into the report the UI gets. A run that
/// produced no summary record did not finish, and its findings are not a
/// verdict — that is an error, not an "ok: false".
fn build_preflight_report(
    records: &[serde_json::Value],
) -> Result<PreflightReport, ProvisionError> {
    let checks: Vec<PreflightCheck> = records.iter().filter_map(preflight_check).collect();
    let summary = records
        .iter()
        .find(|record| record.get("event").and_then(serde_json::Value::as_str) == Some("preflight"))
        .ok_or_else(|| ProvisionError::unknown("preflight ended without a summary"))?;
    let start = records.iter().find(|record| {
        record.get("event").and_then(serde_json::Value::as_str) == Some("preflight_start")
    });
    let privilege = privilege_finding(&checks)
        .ok_or_else(|| ProvisionError::unknown("preflight reported no usable privilege finding"))?;
    Ok(PreflightReport {
        ok: summary
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        blockers: summary
            .get("blockers")
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        checks,
        privilege,
        script_version: start.and_then(|record| string_field(record, "scriptVersion")),
        run_id: start.and_then(|record| string_field(record, "runId")),
    })
}

/// Preflight runs unprivileged and by design: it creates nothing, takes no
/// lock, and reports rather than decides — including whether escalation on this
/// account needs a password.
fn execute_preflight(
    connection: &Connection,
    options: &ProvisionOptions,
    tracker: &Arc<Mutex<Option<u32>>>,
) -> Result<PreflightReport, ProvisionError> {
    connection.validate()?;
    let args = options.script_args(true)?;
    // No escalation prefix. Preflight is read-only and does not require root —
    // discovering that this account cannot escalate is one of its findings, and
    // escalating to ask would defeat the question.
    let command = remote_command(PrivilegeMode::Root, &args);
    let mut records = Vec::new();
    let outcome = run_remote(
        connection,
        &command,
        stdin_payload(None),
        None,
        tracker,
        &mut |record| records.push(record),
    )?;
    if outcome.terminal.is_none() {
        return Err(terminal_error(&outcome));
    }
    build_preflight_report(&records)
}

// ── install ──────────────────────────────────────────────────────────────────

/// Mirror the script's own terminal record into the command's result, so a
/// failing run rejects with the code the script chose rather than a generic one.
fn error_from_terminal(record: &serde_json::Value) -> Option<ProvisionError> {
    if record.get("status").and_then(serde_json::Value::as_str) == Some("ok") {
        return None;
    }
    Some(ProvisionError::new(
        &string_field(record, "errorCode").unwrap_or_else(|| "UNKNOWN".to_string()),
        string_field(record, "detail")
            .unwrap_or_else(|| "the provisioning run reported a failure".to_string()),
    ))
}

/// Runs the install and guarantees the stream closes with exactly one terminal
/// `run_end` record: the script's own when it produced one, a synthesized one
/// otherwise.
fn run_install(
    connection: &Connection,
    options: &ProvisionOptions,
    password: Option<Secret>,
    tracker: &Arc<Mutex<Option<u32>>>,
    on_event: &Channel<serde_json::Value>,
) -> Result<(), ProvisionError> {
    let surface = |error: ProvisionError| {
        let _ = on_event.send(error.as_run_end());
        error
    };

    let privilege = execute_preflight(connection, options, tracker)
        .map_err(surface)?
        .privilege;
    let _ = on_event.send(serde_json::json!({
        "v": 1,
        "event": "privilege_resolved",
        "mode": privilege.mode,
        "root": privilege.root,
        "sudoNoPassword": privilege.sudo_no_password,
    }));

    // The password is bound to the mode preflight established. Anything
    // supplied for a mode that does not consume one is dropped here and never
    // reaches the wire: an unread password line becomes the script's first line.
    let password = match privilege.mode {
        PrivilegeMode::SudoPassword => Some(password.ok_or_else(|| {
            surface(ProvisionError::new(
                "SSH_PASSWORD_REQUIRED",
                "this account needs a password to escalate, and none was supplied",
            ))
        })?),
        _ => None,
    };

    let args = options.script_args(false).map_err(surface)?;
    let command = remote_command(privilege.mode, &args);
    let payload = stdin_payload(password.as_ref());
    let outcome = run_remote(
        connection,
        &command,
        payload,
        password.as_ref(),
        tracker,
        &mut |record| {
            let _ = on_event.send(record);
        },
    )
    .map_err(surface)?;

    match &outcome.terminal {
        Some(record) => error_from_terminal(record).map_or(Ok(()), Err),
        None => Err(surface(terminal_error(&outcome))),
    }
}

// ── run state ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct ProvisionState {
    running: Arc<AtomicBool>,
    child: Arc<Mutex<Option<u32>>>,
}

struct RunGuard(Arc<AtomicBool>);

impl RunGuard {
    fn acquire(running: &Arc<AtomicBool>) -> Result<Self, ProvisionError> {
        running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self(Arc::clone(running)))
            .map_err(|_| {
                ProvisionError::new("CONCURRENT_RUN", "another provisioning run is active")
            })
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl ProvisionState {
    /// Terminate the ssh child of the active run. The remote script records its
    /// progress step by step, so interrupting it and resuming later is safe.
    pub fn kill_active_run(&self) {
        let pid = self.child.lock().ok().and_then(|slot| *slot);
        if let Some(pid) = pid {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
    }
}

// ── commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn provision_list_keys() -> Vec<SshKey> {
    tauri::async_runtime::spawn_blocking(list_keys_blocking)
        .await
        .unwrap_or_default()
}

/// Retrieve the server's host key and its fingerprint for approval. Nothing
/// else happens over this host until the operator has approved it.
#[tauri::command]
pub async fn provision_test_connection(host: String) -> Result<HostIdentity, ProvisionError> {
    validate_host(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host_key = select_host_key(&keyscan(&host)?).ok_or_else(|| {
            ProvisionError::new(
                "SSH_UNREACHABLE",
                format!("{host} offered no ed25519, ecdsa or rsa host key"),
            )
        })?;
        let (_, algorithm, _) =
            host_key_parts(&host_key).ok_or_else(|| ProvisionError::unknown("malformed scan"))?;
        let key_type = map_key_type(algorithm);
        let fingerprint = fingerprint_for_host_key(&host_key)?;

        // A server already approved under a different key is a distinct
        // outcome, not a fresh approval prompt.
        let trusted = match known_host_entry(&read_known_hosts()?, &host) {
            Some(entry) if same_host_key(&entry, &host_key) => true,
            Some(_) => {
                return Err(ProvisionError::new(
                    "SSH_HOST_KEY_CHANGED",
                    format!(
                        "{host} now presents a different host key ({fingerprint}); \
                         it is not re-trusted automatically"
                    ),
                ))
            }
            None => false,
        };
        Ok(HostIdentity {
            host_key,
            fingerprint,
            key_type,
            trusted,
        })
    })
    .await
    .map_err(|error| ProvisionError::unknown(error.to_string()))?
}

/// Record the approved host key in Hive's own known-hosts file.
#[tauri::command]
pub async fn provision_trust_host(host: String, host_key: String) -> Result<(), ProvisionError> {
    validate_host(&host)?;
    if !is_supported_host_key(&host_key) {
        return Err(ProvisionError::invalid(
            "the host key is not an ed25519, ecdsa or rsa key",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || write_known_host(&host, &host_key))
        .await
        .map_err(|error| ProvisionError::unknown(error.to_string()))?
}

/// Run the script's preflight over the same connection and return its findings.
#[tauri::command]
pub async fn provision_preflight(
    connection: Connection,
    options: ProvisionOptions,
) -> Result<PreflightReport, ProvisionError> {
    connection.validate()?;
    options.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        execute_preflight(&connection, &options, &Arc::new(Mutex::new(None)))
    })
    .await
    .map_err(|error| ProvisionError::unknown(error.to_string()))?
}

#[tauri::command]
pub async fn provision_start(
    state: State<'_, ProvisionState>,
    connection: Connection,
    options: ProvisionOptions,
    password: Option<Secret>,
    on_event: Channel<serde_json::Value>,
) -> Result<(), ProvisionError> {
    connection.validate()?;
    options.validate()?;
    if let Some(secret) = password.as_ref() {
        validate_password(secret)?;
    }
    let running = Arc::clone(&state.running);
    let tracker = Arc::clone(&state.child);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = RunGuard::acquire(&running)?;
        run_install(&connection, &options, password, &tracker, &on_event)
    })
    .await
    .map_err(|error| ProvisionError::unknown(error.to_string()))?
}

#[tauri::command]
pub fn provision_cancel(state: State<'_, ProvisionState>) {
    state.kill_active_run();
}

#[cfg(test)]
mod tests {
    use super::{
        build_preflight_report, error_from_terminal, is_run_end, known_host_entry,
        list_keys_blocking, looks_like_private_key, normalize_public_key, privilege_finding,
        provision_script, public_key_identity, redact, remote_command, replace_known_host,
        same_host_key, select_host_key, shell_quote, ssh_error_code, stdin_payload, tail,
        terminal_error, validate_directory, validate_host, validate_key_path,
        validate_network_mode, validate_password, validate_user, version_for_build, PreflightCheck,
        PrivilegeMode, ProvisionOptions, RemoteOutcome, Secret, SSH_ERROR_CODES,
    };

    const SHARED_SETUP_ERRORS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../shared/setup-errors.ts"
    ));

    fn check(name: &str, data: serde_json::Value) -> PreflightCheck {
        PreflightCheck {
            check: name.into(),
            status: "ok".into(),
            detail: String::new(),
            data: Some(data),
            error_code: None,
        }
    }

    fn args(options: &ProvisionOptions, preflight: bool) -> Vec<String> {
        options.script_args(preflight).expect("script args")
    }

    /// A real ed25519 blob is 68 base64 characters; nothing shorter is a key.
    const ED25519_BLOB: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAIH5Yk3xQ9v0mZ1n2ZQ8yq3Kx7bR4tV6wN8pL0aS2dF3g";

    // ── validation ───────────────────────────────────────────────────────────

    #[test]
    fn rejects_values_that_could_be_read_as_options() {
        for host in ["203.0.113.10", "server.example.com", "fd7a:115c:a1e0::1"] {
            assert!(validate_host(host).is_ok(), "{host}");
        }
        for host in [
            "",
            "-oProxyCommand=bad",
            "server/path",
            "server name",
            "a;b",
        ] {
            assert!(validate_host(host).is_err(), "{host}");
        }

        for user in ["root", "_service", "hive.admin-2"] {
            assert!(validate_user(user).is_ok(), "{user}");
        }
        for user in ["", "-root", "2root", "root name", "root@host", "a$b"] {
            assert!(validate_user(user).is_err(), "{user}");
        }

        assert!(validate_key_path("/home/user/.ssh/id_ed25519").is_ok());
        for path in ["", "  ", "-oProxyCommand=bad", "/a\0b"] {
            assert!(validate_key_path(path).is_err(), "{path}");
        }

        assert!(validate_directory("install directory", "/opt/hive").is_ok());
        for path in ["", "/", "opt/hive", "/opt/../etc", "/opt/hive;rm", "-/opt"] {
            assert!(
                validate_directory("install directory", path).is_err(),
                "{path}"
            );
        }

        assert!(validate_network_mode("public").is_ok());
        assert!(validate_network_mode("tailnet").is_ok());
        assert!(validate_network_mode("--reset").is_err());
    }

    #[test]
    fn public_keys_lose_their_comment_and_junk_is_refused() {
        assert_eq!(
            normalize_public_key(&format!("ssh-ed25519 {ED25519_BLOB} lenny@workstation"))
                .as_deref(),
            Ok(format!("ssh-ed25519 {ED25519_BLOB}").as_str())
        );
        assert_eq!(
            normalize_public_key(&format!("  ecdsa-sha2-nistp256 {ED25519_BLOB}==  ")).as_deref(),
            Ok(format!("ecdsa-sha2-nistp256 {ED25519_BLOB}==").as_str())
        );
        for key in [
            String::new(),
            "ssh-ed25519".into(),
            format!("not-an-algorithm {ED25519_BLOB}"),
            // A truncated or hand-mangled blob is not a key.
            "ssh-ed25519 AAAAC3NzaC1lZDI1".into(),
            format!("ssh-ed25519 {}!", &ED25519_BLOB[1..]),
            "-----BEGIN OPENSSH PRIVATE KEY-----".into(),
        ] {
            assert!(normalize_public_key(&key).is_err(), "{key}");
        }
    }

    #[test]
    fn script_arguments_are_quoted_as_single_words() {
        assert_eq!(shell_quote("ssh-ed25519 AAAA"), "'ssh-ed25519 AAAA'");
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");

        let options = ProvisionOptions {
            port: Some(9420),
            install_dir: Some("/opt/hive".into()),
            data_dir: Some("/srv/hive".into()),
            network_mode: Some("tailnet".into()),
            tailnet_interface: Some("tailscale0".into()),
            ssh_public_key: Some(format!("ssh-ed25519 {ED25519_BLOB} lenny@box")),
            reset: true,
        };
        let command = remote_command(PrivilegeMode::Root, &args(&options, false));
        assert!(command.contains(&format!("'--ssh-public-key' 'ssh-ed25519 {ED25519_BLOB}'")));
        assert!(command.contains("'--port' '9420'"));
        assert!(command.contains("'--reset'"));
        assert!(!command.contains("lenny@box"));

        // Preflight records no step state, so --reset has nothing to discard.
        let preflight = args(&options, true);
        assert_eq!(preflight.first().map(String::as_str), Some("--preflight"));
        assert!(!preflight.contains(&"--reset".to_string()));
    }

    // ── privilege modes ──────────────────────────────────────────────────────

    #[test]
    fn privilege_mode_comes_from_the_preflight_finding() {
        let root = privilege_finding(&[check(
            "privilege",
            serde_json::json!({"root": true, "sudoNoPassword": true}),
        )])
        .expect("finding");
        assert_eq!(root.mode, PrivilegeMode::Root);

        let nopasswd = privilege_finding(&[check(
            "privilege",
            serde_json::json!({"root": false, "sudoNoPassword": true}),
        )])
        .expect("finding");
        assert_eq!(nopasswd.mode, PrivilegeMode::SudoNoPassword);

        let password = privilege_finding(&[check(
            "privilege",
            serde_json::json!({"root": false, "sudoNoPassword": false}),
        )])
        .expect("finding");
        assert_eq!(password.mode, PrivilegeMode::SudoPassword);

        // Never guessed: an absent or malformed finding yields nothing, and the
        // caller turns that into an error rather than picking a mode.
        assert!(privilege_finding(&[]).is_none());
        assert!(privilege_finding(&[check("os", serde_json::json!({"os": "debian"}))]).is_none());
        assert!(
            privilege_finding(&[check("privilege", serde_json::json!({"root": true}))]).is_none()
        );
    }

    #[test]
    fn each_mode_gets_its_own_escalation_prefix() {
        let args = vec!["--port".to_string(), "9420".to_string()];

        let root = remote_command(PrivilegeMode::Root, &args);
        assert_eq!(root, "bash -s -- '--port' '9420'");
        assert!(!root.contains("sudo"));

        let nopasswd = remote_command(PrivilegeMode::SudoNoPassword, &args);
        assert!(nopasswd.starts_with("sudo -n -- bash -s --"));
        assert!(!nopasswd.contains("-S"));

        // -k ignores any cached credential, so a still-valid ticket cannot make
        // sudo skip the read; -S takes the password from stdin; -p '' keeps the
        // prompt out of the output entirely.
        let with_password = remote_command(PrivilegeMode::SudoPassword, &args);
        assert!(with_password.starts_with("sudo -k -S -p '' -- bash -s --"));
    }

    #[test]
    fn the_password_line_is_sent_only_when_it_is_consumed() {
        let script = provision_script();
        let secret = Secret::from("hunter2");

        let without = stdin_payload(None);
        assert_eq!(without, script.as_bytes());

        let with = stdin_payload(Some(&secret));
        assert!(with.starts_with(b"hunter2\n"));
        assert_eq!(&with[8..], script.as_bytes());
        // One line, consumed by sudo whole, and the script that follows is
        // byte-identical to the one sent without a password.
        assert_eq!(
            with.iter().filter(|byte| **byte == b'\n').count(),
            script.matches('\n').count() + 1
        );
    }

    #[test]
    fn a_password_that_cannot_be_one_line_is_refused() {
        assert!(validate_password(&Secret::from("hunter2")).is_ok());
        assert!(validate_password(&Secret::from("with spaces and Ünicode")).is_ok());
        assert!(validate_password(&Secret::from("")).is_err());
        assert!(validate_password(&Secret::from("two\nlines")).is_err());
        assert!(validate_password(&Secret::from("carriage\rreturn")).is_err());
    }

    #[test]
    fn the_password_never_reaches_a_process_argument() {
        let options = ProvisionOptions {
            port: Some(9420),
            ..ProvisionOptions::default()
        };
        for mode in [
            PrivilegeMode::Root,
            PrivilegeMode::SudoNoPassword,
            PrivilegeMode::SudoPassword,
        ] {
            let command = remote_command(mode, &args(&options, false));
            assert!(!command.contains("hunter2"), "{command}");
        }
    }

    // ── redaction ────────────────────────────────────────────────────────────

    #[test]
    fn the_password_is_stripped_from_captured_output() {
        let secret = Secret::from("hunter2");

        // The exact shape of the leak the mode guards against: an unread
        // password line becomes the script's first line and bash echoes it.
        let leak = "bash: line 1: hunter2: command not found";
        assert_eq!(
            redact(leak, Some(&secret)),
            "bash: line 1: [redacted]: command not found"
        );
        assert_eq!(
            redact("hunter2 sudo: hunter2", Some(&secret)),
            "[redacted] sudo: [redacted]"
        );
        assert_eq!(redact(leak, None), leak);
        assert_eq!(redact(leak, Some(&Secret::from(""))), leak);
        assert_eq!(redact("nothing to hide", Some(&secret)), "nothing to hide");
    }

    #[test]
    fn a_secret_cannot_be_printed_by_accident() {
        let secret = Secret::from("hunter2");
        let printed = format!("{secret:?}");
        assert!(!printed.contains("hunter2"), "{printed}");
        assert_eq!(printed, "Secret([redacted])");
    }

    // ── streaming and terminal records ───────────────────────────────────────

    #[test]
    fn accepts_only_explicit_terminal_run_statuses() {
        assert!(is_run_end(
            &serde_json::json!({"event": "run_end", "status": "ok"})
        ));
        assert!(is_run_end(
            &serde_json::json!({"event": "run_end", "status": "error"})
        ));
        assert!(!is_run_end(
            &serde_json::json!({"event": "run_end", "status": "done"})
        ));
        assert!(!is_run_end(&serde_json::json!({"event": "run_end"})));
        assert!(!is_run_end(
            &serde_json::json!({"event": "preflight", "ok": true})
        ));
    }

    #[test]
    fn a_run_without_a_terminal_record_still_produces_a_typed_error() {
        let dead = RemoteOutcome {
            terminal: None,
            success: false,
            stderr: "kex_exchange_identification: Connection closed".into(),
        };
        let error = terminal_error(&dead);
        assert_eq!(error.code, "SSH_UNREACHABLE");
        assert!(error.detail.contains("kex_exchange_identification"));
        assert_eq!(error.as_run_end()["event"], "run_end");
        assert_eq!(error.as_run_end()["status"], "error");
        assert_eq!(error.as_run_end()["errorCode"], "SSH_UNREACHABLE");

        let silent = RemoteOutcome {
            terminal: None,
            success: true,
            stderr: String::new(),
        };
        assert_eq!(terminal_error(&silent).code, "UNKNOWN");

        let no_diagnostic = RemoteOutcome {
            terminal: None,
            success: false,
            stderr: "   \n".into(),
        };
        assert!(terminal_error(&no_diagnostic)
            .detail
            .contains("without a diagnostic"));
    }

    #[test]
    fn the_scripts_own_terminal_record_wins() {
        assert!(error_from_terminal(&serde_json::json!({"status": "ok"})).is_none());
        let error = error_from_terminal(&serde_json::json!({
            "status": "error",
            "errorCode": "APT_FAILURE",
            "detail": "apt-get exploded",
        }))
        .expect("error");
        assert_eq!(error.code, "APT_FAILURE");
        assert_eq!(error.detail, "apt-get exploded");

        let bare = error_from_terminal(&serde_json::json!({"status": "error"})).expect("error");
        assert_eq!(bare.code, "UNKNOWN");
    }

    #[test]
    fn maps_ssh_and_sudo_diagnostics_to_codes() {
        assert_eq!(
            ssh_error_code("WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"),
            "SSH_HOST_KEY_CHANGED"
        );
        // The unknown-host refusal also says "Host key verification failed",
        // and it means something entirely different.
        assert_eq!(
            ssh_error_code(
                "No ED25519 host key is known for server and you have requested strict checking.\n\
                 Host key verification failed."
            ),
            "SSH_HOST_KEY_UNKNOWN"
        );
        assert_eq!(
            ssh_error_code("Host key verification failed."),
            "SSH_HOST_KEY_CHANGED"
        );
        assert_eq!(
            ssh_error_code("sudo: 3 incorrect password attempts"),
            "SSH_ESCALATION_FAILED"
        );
        assert_eq!(
            ssh_error_code("sudo: a password is required"),
            "SSH_ESCALATION_FAILED"
        );
        assert_eq!(
            ssh_error_code("hive is not in the sudoers file."),
            "SSH_ESCALATION_FAILED"
        );
        assert_eq!(
            ssh_error_code("Permission denied (publickey)."),
            "SSH_AUTH_FAILED"
        );
        assert_eq!(
            ssh_error_code("ssh: connect to host: Connection timed out"),
            "SSH_UNREACHABLE"
        );
    }

    #[test]
    fn diagnostics_are_cut_on_a_character_boundary() {
        let text = "aé".repeat(400);
        let cut = tail(&text, 500);
        assert!(cut.len() <= 500);
        assert!(text.ends_with(cut));
        assert_eq!(tail("short", 500), "short");
    }

    // ── preflight report ─────────────────────────────────────────────────────

    #[test]
    fn preflight_records_become_a_structured_report() {
        let records = vec![
            serde_json::json!({"event": "preflight_start", "runId": "p-1234", "scriptVersion": "0.0.0-dev"}),
            serde_json::json!({"event": "preflight_check", "check": "os", "status": "ok", "detail": "debian 13 is supported", "data": {"os": "debian"}}),
            serde_json::json!({"event": "preflight_check", "check": "privilege", "status": "warn", "detail": "sudo needs a password", "data": {"root": false, "sudoNoPassword": false}}),
            serde_json::json!({"event": "preflight_check", "check": "port", "status": "fail", "detail": "port 9420 is in use", "data": {"port": 9420}, "errorCode": "PORT_IN_USE"}),
            serde_json::json!({"event": "preflight", "ok": false, "blockers": ["port"]}),
            serde_json::json!({"event": "run_end", "status": "ok"}),
        ];
        let report = build_preflight_report(&records).expect("report");
        assert!(!report.ok);
        assert_eq!(report.blockers, vec!["port".to_string()]);
        assert_eq!(report.checks.len(), 3);
        assert_eq!(report.checks[2].error_code.as_deref(), Some("PORT_IN_USE"));
        assert_eq!(report.privilege.mode, PrivilegeMode::SudoPassword);
        assert_eq!(report.run_id.as_deref(), Some("p-1234"));
        assert_eq!(report.script_version.as_deref(), Some("0.0.0-dev"));

        // A truncated stream is an error, not a verdict of "not ready".
        assert!(build_preflight_report(&records[..3]).is_err());
        // Findings without a privilege check are unusable: the mode must not be
        // inferred from anything else.
        let no_privilege = vec![
            records[1].clone(),
            serde_json::json!({"event": "preflight", "ok": true, "blockers": []}),
        ];
        assert!(build_preflight_report(&no_privilege).is_err());
    }

    // ── host keys ────────────────────────────────────────────────────────────

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
            select_host_key("# comment\nhost ssh-rsa RSA\nhost ecdsa-sha2-nistp256 ECDSA\n")
                .as_deref(),
            Some("host ecdsa-sha2-nistp256 ECDSA")
        );
        assert_eq!(select_host_key("host ssh-dss DSA_BLOB\n"), None);
    }

    #[test]
    fn compares_host_keys_by_algorithm_and_blob() {
        assert!(same_host_key(
            "203.0.113.10 ssh-ed25519 SAME",
            "server.example.com ssh-ed25519 SAME"
        ));
        assert!(!same_host_key(
            "203.0.113.10 ssh-ed25519 SAME",
            "203.0.113.10 ssh-ed25519 OTHER"
        ));
        assert!(!same_host_key(
            "203.0.113.10 ssh-ed25519 SAME",
            "203.0.113.10 ecdsa-sha2-nistp256 SAME"
        ));
    }

    #[test]
    fn replaces_only_the_matching_known_host_entry() {
        let existing = concat!(
            "server.example.com ssh-rsa OLD_KEY\n",
            "other.example.com ssh-ed25519 OTHER_KEY\n",
        );
        assert_eq!(
            known_host_entry(existing, "server.example.com").as_deref(),
            Some("server.example.com ssh-rsa OLD_KEY")
        );
        assert_eq!(known_host_entry(existing, "absent.example.com"), None);

        let replaced = replace_known_host(
            existing,
            "server.example.com",
            "server.example.com ssh-ed25519 NEW_KEY",
        )
        .expect("contents");
        assert_eq!(
            replaced,
            concat!(
                "other.example.com ssh-ed25519 OTHER_KEY\n",
                "server.example.com ssh-ed25519 NEW_KEY\n",
            )
        );
    }

    // ── key listing ──────────────────────────────────────────────────────────

    #[test]
    fn only_files_that_are_private_keys_are_listed() {
        assert!(looks_like_private_key(
            b"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz\n"
        ));
        assert!(looks_like_private_key(b"-----BEGIN RSA PRIVATE KEY-----\n"));
        assert!(!looks_like_private_key(
            b"server.example.com ssh-ed25519 AAAA\n"
        ));
        assert!(!looks_like_private_key(b"Host *\n  AddKeysToAgent yes\n"));
        assert!(!looks_like_private_key(b"ssh-ed25519 AAAA lenny@box\n"));
    }

    #[test]
    fn compares_agent_keys_without_comments() {
        assert_eq!(
            public_key_identity("ssh-ed25519 AAAATEST workstation").as_deref(),
            Some("ssh-ed25519 AAAATEST")
        );
        assert_eq!(public_key_identity("not-enough-fields"), None);
    }

    #[test]
    fn listing_keys_never_panics_and_marks_usability_consistently() {
        for key in list_keys_blocking() {
            assert_eq!(key.usable, !key.encrypted || key.agent_loaded);
            assert!(!key.label.ends_with(".pub"));
        }
    }

    // ── contracts ────────────────────────────────────────────────────────────

    #[test]
    fn the_streamed_script_is_bundled_like_build_sh() {
        let script = provision_script();
        assert!(script.starts_with(&format!(
            "#!/usr/bin/env bash\nSCRIPT_VERSION=\"{}\"\n__hive_provision() {{\n",
            version_for_build(cfg!(debug_assertions))
        )));
        // The wrapper is what makes a truncated stream a syntax error at EOF
        // that executes nothing.
        assert!(script.ends_with("}\n__hive_provision \"$@\"\n"));
        assert!(!script.contains("# shellcheck shell=bash"));
        assert!(script.contains("parse_args()"));
        assert!(script.contains("run_preflight()"));
        assert!(script.contains("main \"$@\""));
    }

    #[test]
    fn the_ssh_error_codes_are_mirrored_in_the_shared_taxonomy() {
        for code in SSH_ERROR_CODES {
            assert!(
                SHARED_SETUP_ERRORS.contains(&format!("\"{code}\"")),
                "{code} is missing from shared/setup-errors.ts"
            );
            assert!(
                SHARED_SETUP_ERRORS.contains(&format!("  {code}:")),
                "{code} has no hint in shared/setup-errors.ts"
            );
        }
    }
}

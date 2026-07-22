# Install flow

Zero-terminal setup of a Hive server from the desktop app. The wizard walks the
user from "I have nothing" to a provisioned VPS with the backend running, the
tools (GitHub CLI, Claude Code, Codex) installed and signed in, and the app
connected. This documents what is implemented; deferred work lives in the
README backlog.

## Flow

`SetupWizard` (frontend/src/pages/setup) is a nine-state resumable flow:

1. Welcome.
2. Tailscale auth key (`tskey-auth-...`, required in production); development
   builds also expose an explicit local-VM mode.
3. SSH key pick from the device's `~/.ssh` directory.
4. Server host and SSH user (`root` by default).
5. Host trust: TOFU displays one preferred fingerprint from `ssh-keyscan` and
   writes only that approved key to the app-owned `known_hosts`.
6. Provisioning with a live step checklist.
7. Tailnet handoff, including verification that the tailnet address presents
   the same host key that was approved initially.
8. Guided GitHub, Claude Code, and Codex setup.
9. Done, including the connection details used by another client such as iOS.

## Provisioning architecture

- The Tauri app ships a Rust sidecar (`frontend/src-tauri/src/provision.rs`)
  that shells out to the system OpenSSH binaries. The three provision script
  fragments are embedded with `include_str!`, assembled at runtime, and
  streamed to `bash -s` over SSH stdin.
- Progress is NDJSON on stdout (`run_start`, `step_*`, `run_end`), forwarded
  raw over a Tauri Channel and normalized once in
  `frontend/src/lib/provision-client.ts`.
- `provision.sh` is idempotent and resumable: name-keyed marker files under
  `/var/lib/hive/state` are the source of truth. Closing the app interrupts its
  SSH run; reopening it and pressing Retry starts a new run that rechecks and
  skips satisfied steps.
- Steps: OS/arch probe, pristine-server probe, removal of legacy helper
  privileges, Tailscale install + `up` (before slow package work so a dead auth
  key fails quickly), apt baseline, GitHub CLI, Node 22, service user, ufw
  restricted to `tailscale0`, versioned
  GitHub release download with SHA256 verification, service env, hardened
  systemd unit, service start, and health check. Client-pushed tarballs and LAN
  firewall rules exist only behind explicit development flags.
- A release is extracted into a version-and-checksum directory and its native
  modules are loaded as the `hive` user before the `current` symlink changes.
  Activation intent is persisted before the swap; the activated marker is
  updated only after `/health` returns `status: ok` and the expected release
  version. The previous target is restored if that verification fails.
- Errors are typed: the provision-emitted codes in `lib.sh` are a subset of
  `SETUP_ERROR_CODES` in `shared/setup-errors.ts`; the contract test enforces
  that relationship.

## Security model (v1)

- Token-less: API access is gated by network reachability (tailnet or LAN)
  plus the backend's Host-header allowlist (anti DNS-rebinding; `/health` is
  exempt). Legacy manual installs can still set `HIVE_AUTH_TOKEN` /
  `HIVE_AUTH_TOKEN_SHA256`.
- The Tailscale key arrives over SSH stdin, is copied to a root-only temporary
  file, removed from the shell variable, and consumed by `tailscale up` through
  its file-based auth-key input. The file is removed on success or failure.
- The Claude OAuth token is stored atomically as mode `0600` structured data
  below `DATA_DIR`; an explicit process environment token takes precedence.
- The backend has no sudo privilege or root-owned runtime helper.
- The unit runs hardened: `NoNewPrivileges`, `ProtectSystem=strict`,
  `PrivateTmp`, memory-capped.

## Guided setup (tools)

The backend exposes `/api/setup/*` (see README API table). Its small in-memory
operation registry runs authentication plus user-space Claude/Codex installer
steps; GitHub CLI itself is installed during root provisioning. Operations are
pollable for a short retention window and intentionally disappear on backend
restart, at which point Retry starts the same requested steps as a new run.
Device-code sign-ins (GitHub and Codex) use a PTY and surface
`open_url_with_code` actions. Claude sign-in runs `claude setup-token` locally
in the app's PTY sidecar and POSTs the captured token to the server.

## Server layout

- `/opt/hive/current` -> symlink into
  `/opt/hive/releases/<version>-<sha256>` (pruned to 3 directories only after a
  successful activation), data in `/home/hive/.hive` (survives reinstalls).
- `/etc/hive/hive.env` (0600) service env; `/etc/hive/.hive-install` marks a
  Hive-owned server so re-provisioning resumes instead of failing
  `EXISTING_INSTALL`.
- `/var/lib/hive` provision state + logs.

## Testing

- `make provision-docker` — full install + idempotency in a systemd container.
- `make provision-docker-chaos` — kill after representative steps, resume.
- `make provision-docker-rollback` — unhealthy release activation and rollback.
- `make provision-docker-download` — the GitHub-download branch against a local
  HTTP origin: missing asset, bad checksum, tampered tarball, good install.
- `make provision-docker-reprovision` — an install killed mid-release resumes
  across a version bump instead of dying `EXISTING_INSTALL`.
- `make provision-contract` — bash/TS error-taxonomy subset contract (also in CI,
  along with shellcheck via `scripts/provision/build.sh`).
- `docs/install-flow-orbstack.md` — end-to-end manual test against a local
  OrbStack VM.

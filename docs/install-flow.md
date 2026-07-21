# Install flow

Zero-terminal setup of a Hive server from the desktop app. The wizard walks the
user from "I have nothing" to a provisioned VPS with the backend running, the
tools (GitHub CLI, Claude Code, Codex) installed and signed in, and the app
connected. This documents what is implemented; deferred work lives in the
README backlog.

## Flow

`SetupWizard` (frontend/src/pages/setup) is a linear, resumable state machine
persisted to localStorage:

1. Welcome → Tailscale intro → Tailscale auth key (`tskey-auth-…`, validated).
2. Server info → SSH key pick (`~/.ssh` scan) → server IP (`user@host`
   supported; root is the default).
3. Host trust: TOFU dialog showing the SSH fingerprint from `ssh-keyscan`; the
   exact scanned keys the user approved are written to an app-owned
   `known_hosts` (never `~/.ssh/known_hosts`).
4. Provisioning: live step checklist streamed from the server.
5. Tailnet handoff: poll the new server's `/health` over the tailnet.
6. Guided setup: install/sign in GitHub CLI, Claude Code, Codex on the server.
7. iOS pairing (host/port shown for manual entry) → done; the app commits the
   new server URL and SSH details to its stores.

## Provisioning architecture

- The Tauri app ships a Rust sidecar (`frontend/src-tauri/src/provision.rs`)
  that shells out to the system OpenSSH binaries. `provision.sh` is embedded at
  compile time (build.rs concatenates `scripts/provision/{lib,steps,main}.sh`)
  and streamed to `bash -s` over SSH stdin together with an env prelude — the
  Tailscale key never appears in argv.
- Progress is NDJSON on stdout (`run_start`, `step_*`, `run_end`), forwarded
  raw over a Tauri Channel and normalized once in
  `frontend/src/lib/provision-client.ts`.
- `provision.sh` is idempotent and resumable: name-keyed marker files under
  `/var/lib/hive/state` are the source of truth; completed steps skip on
  re-run, so Retry after a crash or disconnect just re-streams the script.
- Steps: OS/arch probe, pristine-server probe, Tailscale install + `up` (first,
  so a dead auth key fails in seconds), apt baseline, Node 22, service user,
  ufw (tailnet-only unless `--skip-tailscale`), backend release install
  (client-pushed tarball or GitHub release download with SHA256 verification),
  service env, hardened systemd unit, privileged helpers + sudoers, service
  start, health check.
- Errors are typed: `SETUP_ERROR_CODES` in `shared/setup-errors.ts` mirrors
  `lib.sh`; `test/provision/contract.sh` (run in CI) asserts the two lists are
  identical. Each code maps to an actionable hint in the error panel.

## Security model (v1)

- Token-less: API access is gated by network reachability (tailnet or LAN)
  plus the backend's Host-header allowlist (anti DNS-rebinding; `/health` is
  exempt). Legacy manual installs can still set `HIVE_AUTH_TOKEN` /
  `HIVE_AUTH_TOKEN_SHA256`.
- Secrets travel over SSH stdin, never argv. The Claude OAuth token is written
  through a root-owned helper reading stdin (`write-claude-token.sh`).
- The `hive` service user can sudo exactly the fixed helper scripts under
  `/usr/lib/hive/helpers` (validated with `visudo -cf`).
- The unit runs hardened: `NoNewPrivileges`, `ProtectSystem=strict`,
  `PrivateTmp`, memory-capped.

## Guided setup (tools)

The backend exposes `/api/setup/*` (see README API table): a durable operation
engine (`backend/src/services/setup/operations.ts`) runs registered steps
(`install_gh`, `auth_gh`, `install_claude`, `install_codex`, `auth_codex`) with
per-step logs on disk and resume-on-retry. Device-code sign-ins (gh, codex) are
driven through a PTY and surface `open_url_with_code` actions the UI renders.
Claude sign-in runs `claude setup-token` locally in the app's PTY sidecar and
POSTs the captured token to the server.

## Server layout

- `/opt/hive/current` → symlink into `/opt/hive/releases/<version>` (3
  generations kept), data in `/home/hive/.hive` (survives reinstalls).
- `/etc/hive/hive.env` (0600) service env; `/etc/hive/.hive-install` marks a
  Hive-owned server so re-provisioning resumes instead of failing
  `EXISTING_INSTALL`.
- `/var/lib/hive` provision state + logs.

## Testing

- `make provision-docker` — full install + idempotency in a systemd container.
- `make provision-docker-chaos` — kill after representative steps, resume.
- `make provision-docker-reprovision` — version-bumped re-run over an existing
  install.
- `make provision-contract` — bash/TS error-taxonomy contract (also in CI,
  along with shellcheck via `scripts/provision/build.sh`).
- `docs/install-flow-orbstack.md` — end-to-end manual test against a local
  OrbStack VM.

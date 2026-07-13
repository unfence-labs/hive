# Install Flow — Implementation Plan

**Status: plan, nothing implemented.** Implements [docs/install-flow.md](install-flow.md)
exactly as designed (no variants). This is the working reference for development:
frozen contracts, per-step specs, per-PR test cases, and the feedback-loop
infrastructure that lets every piece be validated locally before touching real
infrastructure.

---

## 1. Ground rules

1. **Build order follows risk.** The four genuine unknowns (Tailscale tagged-key
   friction, Claude PTY auth behavior, Tailscale-in-CI, russh vs stock sshd) are
   resolved by timeboxed spikes in week 1 — before any contract is frozen.
2. **Everything is testable without a cloud account by default.** Real VPS +
   real tailnet appear only in the nightly E2E and the manual release checklist.
3. **`provision.sh` is safely re-runnable at any interruption point.** This is
   CI-enforced by a chaos harness (§7.2), not aspirational.
4. **Contracts are frozen at the end of week 1** (§3) and enforced by contract
   tests in all three languages (bash, Rust, TypeScript). After freezing,
   changing a contract requires bumping its `v` field and updating all three
   test suites in the same PR.
5. **Nothing in this plan touches the existing hub WS protocol**, so iOS is
   unaffected until Phase 5 (which only adds a QR scanner + Keychain move).

---

## 2. Runtime architecture and privilege model (recap, made precise)

| Component | Runs as | Where | Notes |
|---|---|---|---|
| `provision.sh` | root | VPS, launched detached over SSH | one-shot, idempotent, resumable |
| `hive.service` | `hive` user | VPS | hardened unit; owns `DATA_DIR=/home/hive/.hive` |
| Privileged helpers | root via sudoers | `/usr/lib/hive/helpers/*.sh` | fixed, argument-free wrappers (§5.6); the v1 substitute for a helper daemon |
| `hive-updater.service` | root (oneshot) | VPS, triggered by path unit | separate cgroup → survives hive restart |
| Agent CLIs (claude/codex/gh) + mise/uv | `hive` user | `/home/hive` | credentials live in the service user's home |
| Tauri app + embedded SSH | user | desktop | russh; app-owned or user-selected key |

The `hive` user model (vs. running as the login user like the manual setup)
is what allows unit hardening. All agent credentials, mise shims, and repos
live under `/home/hive`.

---

## 3. Frozen contracts (write these first, test them everywhere)

### 3.1 NDJSON provision protocol (script stdout + logfile)

One JSON object per line. Schema file: `scripts/provision/protocol.schema.json`
(validated in bats, Rust, and vitest contract tests).

```jsonc
// run lifecycle
{"v":1,"seq":0,"ts":"2026-07-12T10:00:00Z","event":"run_start","runId":"r-8f2a","scriptVersion":"0.3.0","resume":false,"stepsPlanned":["probe_os","apt_baseline","..."]}
{"v":1,"seq":41,"ts":"...","event":"run_end","status":"ok"}            // or "error"

// step lifecycle
{"v":1,"seq":7,"ts":"...","step":"install_node","status":"start"}
{"v":1,"seq":8,"ts":"...","step":"install_node","status":"log","line":"Setting up nodejs (22.x) ..."}
{"v":1,"seq":9,"ts":"...","step":"install_node","status":"ok","durationMs":41000,"data":{"nodeVersion":"22.17.0"}}
{"v":1,"seq":9,"ts":"...","step":"install_node","status":"skip","reason":"already-satisfied"}
{"v":1,"seq":9,"ts":"...","step":"tailscale_up","status":"error","exitCode":1,"errorCode":"TS_AUTHKEY_INVALID","detail":"backend error: invalid key"}
```

Rules: `seq` strictly monotonic within a run; `errorCode` comes from the shared
taxonomy (§10); `status:"log"` lines are throttled (max ~20/s) and truncated at
2 KB; the file is append-only at `/var/lib/hive/provision.log.ndjson`.

### 3.2 Provision state file

`/var/lib/hive/provision-state.json`, written atomically (`tmp` + `mv`):

```jsonc
{
  "schema": 1,
  "scriptVersion": "0.3.0",
  "runId": "r-8f2a",
  "runs": 2,
  "steps": {
    "probe_os":     {"status":"ok","attempts":1,"completedAt":"..."},
    "install_node": {"status":"ok","attempts":2,"completedAt":"..."},
    "tailscale_up": {"status":"error","attempts":1,"errorCode":"TS_AUTHKEY_INVALID"}
  }
}
```

Resume semantics: on start, steps with `status:"ok"` are skipped (each still
re-verifies its guard cheaply); the first non-ok step re-executes from its
beginning. `--reset` wipes the state file. A newer `scriptVersion` than the
state file's forces `--reset` behavior (a new script may change step semantics).

### 3.3 Secrets env file

Uploaded by the app via SFTP to `/var/lib/hive/provision.env` (0600, root),
**never argv**:

```
HIVE_VERSION=0.3.0
HIVE_AUTH_TOKEN_SHA256=<hex>       # backend stores/compares the hash only
HIVE_AUTH_TOKEN=<plaintext>        # written into hive.env for the service, then this file is shredded
TS_AUTHKEY=tskey-auth-...
HIVE_HOST_MODE=tailnet             # or "loopback" (tests)
HIVE_PORT=3000
```

`provision.sh` consumes it, writes `/etc/hive/hive.env` (0600) for the service,
and `shred -u`s the provision copy in its last step.

### 3.4 Setup REST API (backend)

```
GET  /api/version
     → {"version":"0.3.0","protocolVersion":1,"commit":"abc123"}

GET  /api/setup/status
     → {"detected":{"claude":{"installed":true,"version":"2.1.53"},
                    "codex":{"installed":false},"gh":{...},"tailscale":{...},
                    "mise":{...},"uv":{...},"docker":{...}},
        "operations":[SetupOperation, ...]}

POST /api/setup/run           body {"steps":["install_claude","auth_claude"],"options":{...}}
     → {"operationId":"op-1a2b"}

GET  /api/setup/operations/:id            → SetupOperation
GET  /api/setup/operations/:id/log?since=<seq>  → NDJSON lines (backfill)
POST /api/setup/operations/:id/retry      → re-runs from the failed step
POST /api/setup/auth/claude/token         body {"token":"sk-ant-oat01-..."}   // Mac-side fallback
POST /api/system/update                   → {"operationId":...}               // Phase 6
```

```ts
// shared/ types, used by backend + frontend
interface SetupOperation {
  id: string;
  kind: "guided-setup" | "self-update";
  status: "pending" | "running" | "succeeded" | "failed";
  steps: SetupStep[];
  startedAt: string; heartbeatAt: string; finishedAt?: string;
}
interface SetupStep {
  id: string; title: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  attempts: number; exitCode?: number;
  logRange?: [number, number];              // seq range in the op log
  error?: { code: SetupErrorCode; message: string; hint?: string };
}
```

### 3.5 Setup WS channel (`/ws/setup`)

Own mini-protocol (NOT part of `HubOutgoing` — the hub protocol and iOS stay
untouched). Auth: same bearer/`?token=` as other WS routes.

```jsonc
// client → server
{"type":"subscribe","operationId":"op-1a2b","sinceSeq":0}
{"type":"pty_input","data":"<base64>"}         // for interactive auth steps
// server → client
{"type":"op","op":{/* SetupOperation */}}                    // on every state change
{"type":"log","seq":17,"stepId":"install_claude","line":"..."}
{"type":"pty_data","data":"<base64>"}
{"type":"auth_action","stepId":"auth_codex","kind":"open_url_with_code",
 "url":"https://auth.openai.com/device","code":"ABCD-1234","expiresAt":"..."}
{"type":"auth_action","stepId":"auth_claude","kind":"open_url","url":"https://claude.ai/oauth/..."}
```

Reconnect: client re-subscribes with `sinceSeq`; server replays from the
operation's `log.jsonl` then streams live (same durable-log trick as the
provision script).

### 3.6 Release artifact layout (GitHub Releases)

```
hive-backend-<version>-linux-x64.tar.gz     # dist/ + prod node_modules + package.json
hive-backend-<version>-linux-arm64.tar.gz   # native deps (node-pty, sharp) are arch-specific
provision.sh                                # built from scripts/provision/
SHA256SUMS
latest.json                                 # {"version":"0.3.0","minProtocol":1}
```

Consumed by: `provision.sh` (`fetch_release`), the updater (Phase 6), and the
wizard's "update available" check. `provision.sh --release-file <path>` swaps
GitHub for a local tarball (the dev loop never waits on a release).

### 3.7 iOS pairing payload (QR)

`hive://pair?v=1&host=<tailnet-host-or-100.x>&port=3000&token=<HIVE_AUTH_TOKEN>&name=<server-name>`
Parser is a pure function with unit tests on both platforms (Swift + TS).

---

## 4. Repository layout (target)

```
scripts/provision/
  build.sh                  # concatenates lib.sh + steps/*.sh → dist/provision.sh (single curl-able file)
  lib.sh                    # framework: emit/run_step/state/locking/traps (§5.1)
  protocol.schema.json      # frozen contract 3.1
  steps/
    00-probe-os.sh          10-apt-baseline.sh      20-install-node.sh
    30-create-user.sh       40-install-tailscale.sh 41-tailscale-up.sh
    50-configure-ufw.sh     60-fetch-release.sh     61-install-release.sh
    70-write-secrets.sh     71-write-units.sh       72-install-helpers.sh
    80-enable-service.sh    90-health-check.sh      99-cleanup.sh
  uninstall.sh

backend/src/
  api/setup.ts                       # REST 3.4
  api/version.ts
  services/setup/operations.ts       # durable op engine (§8, PR 3.1)
  services/setup/detect.ts
  services/setup/installers/{claude,codex,gh,mise,uv,docker}.ts
  services/setup/auth-flows/{claude-setup-token,codex-device,gh-device}.ts
  services/setup/runner.ts           # detached child + line-buffered capture
  services/update/updater.ts
  ws/setup.ts                        # WS 3.5
  utils/auth.ts                      # extended: hashed-token compare (§5.5)

frontend/src-tauri/src/ssh/
  mod.rs  keys.rs  known_hosts.rs  provision.rs
  bin/hive-ssh.rs                    # CLI over the same crate; used by CI E2E only

frontend/src/pages/setup/            # wizard (state machine §9)
frontend/src/hooks/useAuthToken.ts

deploy/                              # templates; provision steps 71 embed these
  hive.service  hive.env.example     # (exist)
  hive-updater.service  hive-updater.path  hive-rollback.service

test/
  images/ubuntu-systemd.Dockerfile   # Tier-1
  images/sshd.Dockerfile             # Rust SSH integration target
  fixtures/fake-clis/{claude,codex,gh,tailscale}      # scenario-driven stubs (§7.4)
  fixtures/transcripts/*.txt         # recorded real-CLI output (Spike S2)
  tools/record-cli.sh                # PTY recorder used on the spike VM
  provision/*.bats
  e2e/{vm.sh,nightly.sh}

.github/workflows/{ci.yml,release.yml,e2e-nightly.yml}
Makefile                             # all targets in §7.6
```

---

## 5. `provision.sh` detailed specification

### 5.1 Framework (`lib.sh`)

```
emit <json>            # appends seq/ts, writes stdout + logfile
run_step <id>          # skip if state=ok; emit start; run step_<id>(); trap failure
step guards            # each step defines guard_<id>() → "satisfied" ⇒ emit skip
die <errorCode> <msg>  # emit step error + run_end error; exit 1
apt_install <pkgs…>    # DEBIAN_FRONTEND=noninteractive, -o DPkg::Lock::Timeout=300,
                       #   --force-confdef/--force-confold
require_root, acquire_lock (flock /var/lib/hive/provision.lock)
HIVE_TEST_DIE_AFTER=<step-id>   # test hook: exit 137 right after that step's "ok"
```

`set -euo pipefail` everywhere; every function shellcheck-clean (CI gate).
The built artifact wraps everything in `main "$@"` called on the last line
(truncated download executes nothing).

### 5.2 Step table (guard / action / verify)

| Step | Guard (skip if…) | Action | Verify (emit `data`) |
|---|---|---|---|
| `probe_os` | never skips | parse `/etc/os-release`, check systemd + arch (x64/arm64) | in matrix (Ubuntu 22.04/24.04, Debian 12) else `die UNSUPPORTED_OS` |
| `apt_baseline` | all pkgs `dpkg -s` ok | `apt_install build-essential python3 python-is-python3 pkg-config libssl-dev unzip xz-utils jq ripgrep fd-find sqlite3 git-delta fzf tree gnupg ca-certificates ufw` + `ln -sf $(command -v fdfind) /usr/local/bin/fd` | `fd --version`, `rg --version` |
| `install_node` | `node -v` ≥ 22 | NodeSource repo + `apt_install nodejs` | `node -v`, `npm -v` |
| `create_user` | `id hive` exists | `useradd -m -s /bin/bash hive`; `install -d -o hive /home/hive/.hive` | home exists, owned |
| `install_tailscale` | `tailscale version` ok | official apt repo + install; `systemctl enable --now tailscaled` | daemon active |
| `tailscale_up` | `tailscale status --json` → BackendState=Running & logged in | `tailscale up --auth-key=$TS_AUTHKEY` (key form per Spike S1) | has 100.x IP → `data:{tailnetIp}`; on auth error `die TS_AUTHKEY_INVALID` |
| `configure_ufw` | rules already present | `ufw default deny incoming; ufw allow in on tailscale0; ufw allow ssh; ufw --force enable` | `ufw status` matches (ssh stays open — repair channel) |
| `fetch_release` | tarball present + checksum ok | download `hive-backend-$HIVE_VERSION-linux-$ARCH.tar.gz` (or `--release-file`) | sha256 verified else `die CHECKSUM_MISMATCH` |
| `install_release` | `current` → this version | unpack `/opt/hive/releases/<v>`; link `shared/data` → `/home/hive/.hive`; scratch-symlink + `mv -T` swap | `readlink current` |
| `write_secrets` | `/etc/hive/hive.env` content identical | write env (HOST=tailnet IP or per `HIVE_HOST_MODE`, PORT, DATA_DIR, HIVE_AUTH_TOKEN, PATH incl. mise shims) 0600 | perms + owner |
| `write_units` | unit content identical | install `hive.service`, updater trio from embedded templates; `daemon-reload` | `systemd-analyze verify` |
| `install_helpers` | dir content identical | §5.6 helpers + sudoers drop-in | `visudo -c` |
| `enable_service` | active | `systemctl enable --now hive` | `systemctl is-active` |
| `health_check` | — | curl `--retry 10` health on bound IP with token | 200 + version matches |
| `cleanup` | — | `shred -u /var/lib/hive/provision.env`; print/emit pairing summary `data:{tailnetIp,port}` | — |

Every step is independently re-runnable; the chaos harness (§7.2) proves it for
every kill point.

### 5.3 `hive.service` (as installed by step 71 — production form)

```ini
[Unit]
Description=Hive backend
Wants=network-online.target
After=network-online.target tailscaled.service

[Service]
User=hive
WorkingDirectory=/opt/hive/current
ExecStart=/usr/bin/node --enable-source-maps dist/index.js
EnvironmentFile=/etc/hive/hive.env
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3
OnFailure=hive-rollback.service
MemoryMax=3G
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/hive /opt/hive/shared
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

(`deploy/hive.service` — the manual-install template — stays; step 71 embeds
this hardened variant. Single source: both generated from one template at
`build.sh` time to prevent drift.)

### 5.4 Updater units (installed in Phase 1, used in Phase 6)

- `hive-updater.path`: `PathExists=/opt/hive/shared/.update-requested`
- `hive-updater.service`: `Type=oneshot`, root; reads requested version, runs
  `helpers/update-hive.sh` (§5.6)
- `hive-rollback.service`: `Type=oneshot`, root; `mv -T` current → previous
  generation + restart + emit a marker file the API surfaces

### 5.5 Auth token at rest

`/etc/hive/hive.env` carries `HIVE_AUTH_TOKEN` (the service must compare
incoming bearers). Additionally `HIVE_AUTH_TOKEN_SHA256` is supported by
`utils/auth.ts`: if only the hash is present, the backend hashes incoming
tokens before `timingSafeEqual` (removes plaintext-at-rest; enabled by
provision, transparent to clients). Backend change lands in PR 0.3.

### 5.6 Privileged helpers (v1 substitute for a root helper daemon)

`/usr/lib/hive/helpers/` (root:root 0755, dir not writable by `hive`), all
**argument-free** (no injection surface):

```
install-claude.sh   install-codex.sh   install-gh.sh
install-docker.sh   install-mise-deps.sh
tailscale-up.sh     # reads key from a root-owned 0600 file, then deletes it
restart-hive.sh     update-hive.sh     rollback-hive.sh
```

Sudoers drop-in `/etc/sudoers.d/hive` (validated with `visudo -c`):

```
hive ALL=(root) NOPASSWD: /usr/lib/hive/helpers/install-claude.sh, /usr/lib/hive/helpers/install-codex.sh, ...
```

Explicit file list, **no wildcards, never `apt-get` or `tailscale` directly**
(GTFOBins). mise/uv/rustup run as `hive` directly — no helper needed.

### 5.7 Uninstall

`provision.sh --uninstall`: stop/disable units, remove units + helpers +
sudoers + `/opt/hive`, keep `/home/hive/.hive` and print its path.
`--uninstall --purge`: additionally delete data after typed confirmation
(non-interactive requires `--yes-delete-data`).

---

## 6. Backend setup engine specification

### 6.1 Operations engine (`operations.ts`)

- Storage: `DATA_DIR/setup/<opId>/state.json` (via existing `writeJsonAtomic`)
  + `log.jsonl` (append-only, monotonic seq — same discipline as the provision
  log).
- Steps run in a **detached child** (`spawn(…, {detached:true})` + `unref`)
  writing to the op log; the Fastify process only tails/serves it. A backend
  restart (including self-update) does not kill a running op.
- Heartbeat: runner touches `state.json.heartbeatAt` every 5 s. Boot reaper
  (extends the automation-scheduler recovery pattern): `running` op with dead
  pid or heartbeat > 30 s stale → mark `failed` with `error.code=INTERRUPTED`
  and expose `retry` (conservative default; steps are idempotent so retry is
  safe).
- Concurrency: one running op per kind (409 otherwise).

### 6.2 Detection (`detect.ts`)

Extends the preflight list. Each probe: `command -v` + `--version` parse, ~2 s
timeout, all run in parallel; result cached 30 s. Adds: tailscale (+
`status --json` state), mise, uv, docker (+ compose plugin), and per-CLI
`latestVersion` reuse from `agents-settings.ts`.

### 6.3 Installers

Each installer = ordered SetupSteps with the same guard/action/verify shape as
provision steps. Privileged actions call helpers (§5.6); user-space ones run as
`hive` (mise shims mode + `mise trust -a`; uv installer; corepack note for
Node ≥ 25). Docker installer ends with the rootless-vs-group decision encoded
per the design doc.

### 6.4 Auth-flow drivers (`auth-flows/*`)

Common shape: spawn CLI in a PTY (`spawnPtyProcess`), scan output with
**versioned regex sets keyed by CLI version** (from Spike S2 transcripts), emit
`auth_action` frames, handle: URL lift, code lift, paste-back injection,
**gh Enter-keystroke injection** (cli/cli #12925), 15-min code expiry →
auto-regenerate (max 3), and typed errors (`CODEX_DEVICE_AUTH_DISABLED`,
`CLAUDE_PASTEBACK_BROKEN` → surface the Mac fallback).
Post-auth: claude → write `CLAUDE_CODE_OAUTH_TOKEN` into `/etc/hive/hive.env`
via helper + pre-seed `~hive/.claude.json` (`hasCompletedOnboarding`,
per-project trust) + assert `ANTHROPIC_API_KEY` absent; codex → verify
`~hive/.codex/auth.json` exists 0600.

---

## 7. Test & feedback-loop infrastructure

### 7.1 Tier 1 — Docker + systemd (seconds; inner loop)

`test/images/ubuntu-systemd.Dockerfile` (Ubuntu 24.04, systemd PID 1), run
`--privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup`. Provision runs
with `--skip-tailscale --host 127.0.0.1` (first-class flags). Used by:
provision iteration, installer steps, unit behavior.

### 7.2 Chaos/resume harness (the "re-runnable" guarantee)

`test/e2e/chaos.sh`: for each step id **k** in the plan:
1. fresh container → run with `HIVE_TEST_DIE_AFTER=k` → assert exit 137 and
   state file shows k=ok, k+1 unstarted;
2. re-run normally → assert `run_end ok`;
3. diff against a clean single-run reference: same unit files (hash), same
   versions, same `systemctl is-active`, state.json all-ok, **no step executed
   twice with side effects** (each step's verify is also asserted).
Also: double-run convergence (2 clean runs → second is all-skip), concurrent-run
lock test, `--reset` test, and a mid-`apt` SIGKILL case (dpkg lock recovery via
`dpkg --configure -a` in `apt_install`).
PR CI runs 3 representative kill points (apt, release-swap, units); the full
matrix runs nightly.

### 7.3 Tier 2 — Multipass VM (1–2 min; realistic loop)

```
make vm-up          # multipass launch 24.04 --name hive-test; snapshot "pristine"
make vm-reset       # multipass restore hive-test.pristine    (~5 s "new VPS")
make vm-provision   # full provision incl. tailscale (real test tailnet key from .env.local)
make vm-setup-steps # drive /api/setup against the VM with fake or real CLIs
make vm-update-e2e  # Phase 6 scenario (local release server, good + broken release)
make vm-ssh-e2e     # Rust crate integration vs the VM's stock sshd
```

Snapshots make "fresh VPS" a 5-second operation — this is the everyday manual
loop for the wizard (`npm run tauri dev` pointed at the VM IP).

### 7.4 Fake CLI harness (deterministic PTY tests)

`test/fixtures/fake-clis/<tool>`: bash stubs replaying **recorded transcripts
of the real tools** (captured in Spike S2 with `test/tools/record-cli.sh`,
which wraps the CLI in `script -q` on the VM). Scenario selection via env:

```
FAKE_CLAUDE_SCENARIO=happy | paste_back_broken | slow_user | code_expired
FAKE_CODEX_SCENARIO=happy | device_auth_disabled | url_variant_2
FAKE_GH_SCENARIO=happy | waits_for_enter | timeout
```

Timing is embedded in the transcript files (per-line delays) so slow-user and
expiry paths are reproducible. Backend vitest prepends the fixture dir to PATH.
When a real CLI version bump changes output, re-record → parser snapshot tests
fail loudly → update regex set for that version.

### 7.5 Tier 3 — real infra (nightly + release)

Hetzner CX22 via API (create → flow → destroy, ≈ €0.01/run). Tailnet strategy
decided by Spike S3: dedicated test tailnet with **ephemeral** auth keys in CI
secrets (nodes self-clean), or Headscale container (hermetic, needs
/dev/net/tun on the runner — available on GitHub-hosted runners).

### 7.6 Makefile (developer entry points)

```
make provision-build            # scripts/provision/build.sh → dist/provision.sh + shellcheck
make provision-docker           # Tier-1 clean run + health assert
make provision-docker-chaos     # §7.2 (CHAOS_STEPS=all|fast)
make vm-up / vm-reset / vm-provision / vm-setup-steps / vm-update-e2e / vm-ssh-e2e
make record-transcripts         # Spike S2 tooling against the VM
make e2e-nightly-local          # run the nightly script against your own Hetzner token
```

### 7.7 CI wiring

- **PR CI (additions):** shellcheck + bats; Tier-1 provision run; chaos (3 kill
  points); Rust ssh tests vs sshd container; vitest incl. contract tests +
  fake-CLI driver tests; frontend tests.
- **Nightly:** full chaos matrix; Tier-3 E2E; fixture-drift job (installs
  latest real CLIs in a container, re-records `--help`/version banners, fails
  if parsers' version key is unknown → early warning of upstream changes).
- **Release (`release.yml`):** tag → build tarballs (x64 + arm64 matrix,
  native deps rebuilt per arch) + provision.sh + SHA256SUMS + latest.json →
  then the manual checklist (§11) gates announcing.

---

## 8. Spike protocols (week 1, timeboxed ~1 day each)

**S1 — Tailscale key form.** Fresh personal tailnet; attempt to create a
`tag:hive` auth key; document exactly which console edits are required (ACL
`tagOwners`?). Decide: tagged key vs plain reusable key + guided "Disable key
expiry" click. Output: decision recorded in install-flow.md + the exact wizard
deep-link URLs.

**S2 — CLI transcripts.** On a pristine Multipass VM: run
`claude setup-token`, `claude` first-run, `codex login --device-auth`,
`gh auth login --web` under `test/tools/record-cli.sh`; capture happy path +
every reachable error (wrong code, expiry, codex admin-gate). Verify the
claude paste-back state on the current CLI version (issues #42965/#48048).
Output: `test/fixtures/transcripts/*`, parser spec per CLI+version, and a
go/no-go on PTY-first vs Mac-fallback-first for Claude (plan assumes PTY-first
per the design doc; the fallback ships either way).

**S3 — tailnet in CI.** Throwaway workflow: (a) tailscale up with an ephemeral
key on a GitHub runner; (b) Headscale container + client. Assert a runner ↔ VM
tailnet connection both ways. Output: Tier-3 network choice.

**S4 — russh vs stock sshd.** `hive-ssh` prototype: connect/exec/sftp/tail
against Multipass (stock Ubuntu sshd) and a Hetzner default image, with
ed25519 + RSA + passphrase keys. Output: confirmed auth matrix + any sshd
config edge (e.g., `PubkeyAcceptedAlgorithms`) folded into error taxonomy.

---

## 9. Wizard state machine (desktop)

Persisted in localStorage (`hive-setup-state`, schema-versioned) so relaunch
resumes mid-flow. States and transitions:

```
welcome
 → tailscale_intro        (account + Mac app instructions; "I'm done" gate: detect
                           local tailnet membership via backend later, else trust user)
 → tailscale_key          (paste; validate format tskey-…)
 → server_choice          ("create a VPS (guided links)" | "I have a server")
 → ssh_key                (discovered keys list | file picker | passphrase prompt
                           | "no key" → generate + show pubkey copy screen)
 → server_ip              (IP/host input; basic reachability check port 22)
 → host_trust             (fingerprint dialog → known_hosts store)
 → provisioning           (checklist fed by Tauri events; on step error →
                           error panel with log tail + Retry (resume) button;
                           app relaunch → ssh_resume_provision re-attaches)
 → tailnet_handoff        (poll /health via tailnet; timeout → diagnostics screen:
                           is Mac on tailnet? is node visible? keep SSH available)
 → guided_setup           (sub-machine: detect → claude → stacks → codex? → gh? →
                           verify; each step = SetupOperation via /ws/setup)
 → ios_pairing            (QR render; "skip")
 → done                   (summary; where things live; how updates work)
```

Global affordances: every state has "back", a diagnostics drawer
(SSH-connected shell log tail — read-only), and a bail-out "continue later"
(state persists). Error screens always show: step, errorCode, hint from
taxonomy, log excerpt, Retry.

---

## 10. Error taxonomy (shared `shared/setup-errors.ts` + bash mirror)

`UNSUPPORTED_OS, UNSUPPORTED_ARCH, APT_LOCK_TIMEOUT, APT_FAILURE, NETWORK,
CHECKSUM_MISMATCH, TS_AUTHKEY_INVALID, TS_DAEMON_DOWN, UFW_FAILURE,
RELEASE_DOWNLOAD_FAILED, SERVICE_START_FAILED, HEALTH_TIMEOUT,
SSH_AUTH_FAILED, SSH_HOST_KEY_CHANGED, SSH_UNREACHABLE, SSH_NO_ROOT,
CLAUDE_PASTEBACK_BROKEN, DEVICE_CODE_EXPIRED, CODEX_DEVICE_AUTH_DISABLED,
GH_POLL_STUCK, INTERRUPTED, CONCURRENT_RUN, UNKNOWN`

Each code maps to a user-facing hint (i18n-ready) + a docs anchor. Contract
test asserts bash/TS lists are identical.

---

## 11. Phase / PR plan

Legend: **T** = test cases (named, non-exhaustive), **DoD** = definition of done,
**E** = estimate in person-days.

### Phase 0 — Foundations (parallel with spikes)

**PR 0.1 — Release pipeline** (`release.yml`, `scripts/provision/build.sh` stub).
T: workflow dry-run on `v0.0.1-test` tag produces all §3.6 artifacts; SHA256SUMS
verifies; arm64 tarball contains arm64 node-pty prebuilds.
DoD: `curl <release>/provision.sh | head` shows the built header. **E: 2**

**PR 0.2 — Version surface** (`api/version.ts`, `/health` version field).
T: vitest for both endpoints; latest.json comparison helper unit test.
DoD: wizard/updater have a comparison source. **E: 0.5**

**PR 0.3 — Runtime auth token + hashed-at-rest** (`useAuthToken.ts`, 5 call
sites, Settings field, `auth.ts` SHA-256 mode).
T: per-call-site vitest (REST bearer, hub WS, terminal WS, browser WS, img
URL); hashed-mode auth unit tests; manual: token entered at runtime reaches a
protected dev backend.
DoD: `VITE_HIVE_AUTH_TOKEN` no longer read; docs updated. **E: 2**

### Phase 1 — provision.sh

**PR 1.1 — Framework + protocol** (`lib.sh`, `build.sh`, schema, bats setup,
Tier-1 image).
T: bats: emit format/seq monotonicity/state atomicity/lock/`HIVE_TEST_DIE_AFTER`;
schema validation of a full synthetic run; shellcheck gate.
DoD: `make provision-docker` runs an empty-steps skeleton green. **E: 3**

**PR 1.2 — Core steps** (probe→health, minus tailscale/ufw; `--release-file`).
T: Tier-1 clean run; double-run all-skip; per-step bats guard tests; wrong-OS
container (debian:11) → `UNSUPPORTED_OS`; checksum-tamper → `CHECKSUM_MISMATCH`.
DoD: container serves authenticated /health on 127.0.0.1. **E: 3**

**PR 1.3 — Chaos harness** (`chaos.sh`, CI wiring).
T: §7.2 full matrix locally; 3 kill points in PR CI; dpkg-lock case.
DoD: re-runnability is CI-enforced. **E: 2**

**PR 1.4 — Tailscale + ufw + helpers + uninstall** (steps 40/41/50/72,
helpers + sudoers, uninstall.sh).
T (Tier-2): `make vm-provision` with real test-tailnet key → API answers on
100.x only (host-side probe asserts public port CLOSED, ssh OPEN); invalid key
→ `TS_AUTHKEY_INVALID` and re-run after fixing key succeeds; `visudo -c`;
helper smoke tests; uninstall keeps data / purge deletes with flag.
DoD: fresh VM → tailnet-only Hive, idempotent, uninstallable. **E: 3**

### Phase 2 — Tauri SSH

**PR 2.1 — russh core** (`mod.rs, keys.rs, known_hosts.rs`, sshd test image).
T (Rust, CI): auth ok (ed25519/RSA), encrypted key + passphrase, wrong key →
`SSH_AUTH_FAILED`, host-key change → `SSH_HOST_KEY_CHANGED`, exec exit codes,
sftp write + mode, timeout behavior; key discovery on the 3 OS dir layouts
(fixture homes).
DoD: matrix green in CI; `hive-ssh exec uname -a` works vs Tier-2 VM. **E: 4**

**PR 2.2 — Provision driver + Tauri commands** (`provision.rs`, events,
commands `ssh_list_keys/test_connection/start_provision/resume_provision`).
T: upload+detach+tail happy path vs VM; **kill the desktop process mid-run,
relaunch, resume re-attaches at correct seq and finishes**; network blip
during tail (drop VM NIC 10 s) → reconnect + no seq gap; secrets uploaded 0600
and absent from `ps`/history on the VM (asserted).
DoD: app-close-during-install provably safe. **E: 3**

### Phase 3 — Backend as installer

**PR 3.1 — Operations engine + REST** (`operations.ts`, `api/setup.ts` minus
auth flows).
T (vitest, injected dataDir): op lifecycle; log backfill `?since`; restart
mid-op → reaper marks INTERRUPTED + retry works; heartbeat staleness;
single-op-per-kind 409.
DoD: durable resumable ops with REST surface. **E: 3**

**PR 3.2 — `/ws/setup`** (channel, subscribe/replay, PTY bridge without
workspace guard).
T (injectWS): subscribe+replay from seq; live tail; pty_input round-trip
against a fake CLI; auth-rejected close 1008; hub protocol contract test
untouched (regression gate).
DoD: pre-project streaming works; iOS unaffected. **E: 2**

**PR 3.3 — Detection + installers** (`detect.ts`, 6 installers, helper calls).
T: detect matrix via fixture PATHs; each installer vs fake CLIs (logic) and on
Tier-2 VM twice (idempotency) via `make vm-setup-steps`; mise shims present in
service PATH after install (unit env asserted); docker group/rootless per
design flag.
DoD: pristine VM → all installers green twice. **E: 4**

**PR 3.4 — Auth-flow drivers** (3 drivers + regex sets keyed by CLI version +
Mac-fallback endpoint).
T: snapshot tests across every S2 transcript scenario (happy/broken/expired/
gated/slow); gh Enter-injection case; code-expiry regenerate (max 3);
`CLAUDE_PASTEBACK_BROKEN` → fallback surfaced; fallback endpoint validates
token format + writes env via helper + verifies with a `claude -p` smoke call.
DoD: every fixture variant → correct wizard instruction or typed error; real
flows deferred to §12. **E: 4**

### Phase 4 — Wizard UI

**PR 4.1 — Shell + resume** (first-run gate, state machine, TaskTracker-based
checklist, diagnostics drawer). T: state-machine unit tests (transitions,
persistence/restore, back-navigation); component tests. **E: 3**
**PR 4.2 — Network/server/SSH screens** (key picker, passphrase, TOFU dialog,
provisioning screen on Tauri events, error panel + Retry). T: mocked-Tauri
component tests per screen; scripted happy path vs Tier-2 VM. **E: 4**
**PR 4.3 — Guided setup + QR + finish** (detection UI, stack checkboxes, auth
screens rendering `auth_action` frames, QR render, finish summary).
T: component tests per auth scenario (driven by fake-CLI backend); full
scripted E2E: `vm-reset` → wizard → done with fake CLIs.
DoD: **a non-author completes the full wizard on a pristine VM without a
terminal.** **E: 4**

### Phase 5 — iOS

**PR 5.1 — QR + Keychain** (VisionKit scanner, camera permission,
`hive://pair` parser, token → Keychain migration, manual entry kept).
T: Swift parser unit tests (valid/invalid/versioned payloads); Keychain
migration test; manual device run.
DoD: scan → connected on a real iPhone on the tailnet. **E: 3**

### Phase 6 — Self-update

**PR 6.1 — Updater** (units live since 1.4; `updater.ts`, swap script, banner
UI, `/api/system/update`).
T (`make vm-update-e2e`, fully automated): local release server; update N→N+1
→ health ok, generations pruned to 3; **broken N+2 (exits at boot) → auto
rollback to N+1 + error surfaced via API + marker file**; update requested
while an op runs → 409; UI warns when agent sessions active.
DoD: success and rollback paths green in one make target. **E: 3**

### Phase 7 — E2E + release hardening

**PR 7.1 — Nightly E2E** (`e2e-nightly.yml`, `test/e2e/nightly.sh` driving
`hive-ssh` + REST with fake CLIs on a real Hetzner VM + S3-decided tailnet).
T: the script *is* the test; junit summary; VM always destroyed (trap).
DoD: nightly reproduces a full "new user" install on real infra. **E: 3**
**PR 7.2 — Docs + polish** (GETTING_STARTED rewrite around the wizard,
disk-space warning UI using existing /health metrics, fixture-drift CI job).
**E: 2**

**Total ≈ 55 person-days** (excl. spikes ~4). Two developers in parallel
(§13) ≈ 6–7 calendar weeks to the Phase-4 demo, ~9–10 weeks to ship.

---

## 12. Manual release checklist (the non-automatable)

1. Real Claude Pro/Max auth via wizard on a fresh VM — PTY path **and** Mac
   fallback; assert subscription (not API) billing in the Claude console.
2. Real Codex device-auth incl. the admin-gate error path.
3. Real gh device flow incl. Enter-poll behavior on the current gh version.
4. Brand-new Tailscale account onboarding following only wizard instructions
   (S1 form), on a machine with no prior Tailscale state.
5. iPhone QR pairing on a real device (fresh app install).
6. Windows: key discovery in `%USERPROFILE%\.ssh` + no-key generated path.
   Linux desktop: same.
7. Kill the app mid-provision → relaunch → resume completes.
8. Reboot the VPS → service and tailscale come back; clients reconnect.
9. `provision.sh --uninstall` leaves data; re-install over it works.

---

## 13. Parallelization & sequencing

```
Week 1: S1 S2 S3 S4  +  PR 0.1 0.2 0.3
Track A (script/backend): 1.1 → 1.2 → 1.3 → 1.4 → 3.1 → 3.2 → 3.3 → 3.4 → 6.1
Track B (Rust/wizard):    2.1 → 2.2 → 4.1 → 4.2 → 4.3 → 5.1
Join: 4.2 needs 1.x artifacts + 2.2; 4.3 needs 3.x; 7.x needs all.
```

Contracts (§3) are frozen end of week 1 after S1/S2 land their corrections;
both tracks code against the schemas + fake implementations from day one
(wizard against a fixture backend, backend against the `hive-ssh` CLI).

Critical path: **S2 → 0.1 → 1.1–1.3 → 2.2 → 4.2/4.3**. First full demo
(fake CLIs, Tier-2 VM): end of Phase 4. Ship gate: Phase 6 + nightly green +
checklist §12.

---

## 14. Risk register (implementation-level)

| Risk | Exposure | Mitigation |
|---|---|---|
| Claude PTY auth regresses upstream | wizard's flagship step fails | version-keyed regex sets; fixture-drift nightly job; Mac fallback is first-class (PR 3.4); CLI version pinned by installer |
| Tailscale-in-CI flaky | nightly noise | S3 decides strategy before Phase 1.4; ephemeral keys self-clean; retry-once policy on network steps only |
| russh edge cases on user sshd configs | support tickets | v1 scope = stock Ubuntu/Debian sshd, root+key (typed errors otherwise); S4 validates before 2.1 |
| Contract drift bash/Rust/TS | subtle integration bugs | single schema files + tri-language contract tests; `v` field bump policy |
| Chaos matrix too slow for PR CI | devs skip it | 3 kill points on PR, full matrix nightly; container layer caching |
| apt lock on fresh VPS (unattended-upgrades) | first-run failures in the wild | `DPkg::Lock::Timeout=300` in `apt_install` + dedicated chaos case |
| node-pty/sharp arch mismatches in tarball | arm64 installs broken | per-arch build matrix in release.yml + install-time `node -e "require('node-pty')"` smoke in health_check |
| Two-track integration slip | schedule | contracts frozen week 1; weekly integration run of the scripted E2E even before Phase 4 |

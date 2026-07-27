<div align="center">

<img src=".github/assets/hive-logo.svg" alt="Hive" width="120" height="120" />

# Hive

**Orchestrate AI coding agents across isolated git workspaces — from your desktop, browser, or phone.**

[![CI](https://github.com/unfence-labs/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/unfence-labs/hive/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-FF7048.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org)

[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-iOS-F05138?logo=swift&logoColor=white)](https://developer.apple.com/xcode/swiftui/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Features](#features) · [Quick Start](#quick-start) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

## What is Hive?

Hive is a control plane for AI coding agents. It manages your projects as **bare git repositories**, spins up **isolated workspaces** as git worktrees and branches, and keeps every agent conversation as a **resumable session** — so multiple agents can work in parallel without stepping on each other.

Run Hive as a **local web app**, a **Tauri desktop app** (pointed at a local or remote backend), or a **native SwiftUI iOS client** — all speaking the same REST and WebSocket protocols.

- 🧠 **Multi-agent** — run Claude and Codex sessions side by side, with provider-aware model selection and per-session provider locking.
- 🌳 **Isolated by design** — every workspace is its own worktree and branch; up to 6 concurrent sessions per workspace.
- 📡 **Live streaming** — assistant text, thinking, tool calls, file changes, diffs, tasks, plans, and images stream over a single multiplexed WebSocket hub.
- 🤖 **Automation** — reusable Team agents plus cron-scheduled runs with full run history and notifications.
- 📱 **Everywhere** — desktop, web, and iOS from one backend, with push notifications and Tailscale-friendly remote access.

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🌳 Agent workspaces
- Clone or create git-backed projects, then spin up isolated workspaces from them.
- Create workspaces from an existing branch, pull request, or issue: the workspace source is injected into the agent's git context (PR workspaces carry the base branch), and issue workspaces pre-fill the composer from the editable issue draft prompt.
- Run **Claude** and **Codex** sessions with provider-aware model selection and per-session provider locking.
- Up to **4 sessions per workspace**, with REST-fetched per-session history, queued follow-ups, unread indicators, and interrupt/stop handling.
- Stream live assistant text, thinking, tool calls, file changes, diagnostics, tasks, images, plan updates, branch info, and diff stats over the hub WebSocket.
- Attach images to messages; the backend resizes and stores them per session.
- Browse files, preview raw content, inspect inline diffs, paste diff comments into prompts, and use `#file`, `/command`, and `@agent` autocomplete.
- Open a conversation tab as a full-pane interactive **terminal** (login shell in the worktree) on desktop.

</td>
<td width="50%" valign="top">

### 🧠 Brain
- Maintain one normal git clone as a shared **knowledge base**.
- Create/connect/delete the Brain repo, edit Markdown notes, review working-tree changes, and **Save** by committing and pushing.
- Chat with the Brain through the same session stack as workspaces.

### 🔌 Providers
- **Claude** via streaming JSON from the Claude CLI.
- **Codex** interactive chat via `codex app-server`; automations via `codex exec --json`.
- **Kimi** (Moonshot K3 / Kimi for Coding) through the Claude CLI pointed at Moonshot's Anthropic-compatible Kimi Code subscription endpoint. Requires a [Kimi Code subscription](https://www.kimi.com/membership/pricing) API key (Settings → Models); models appear in the picker once the key is saved. The `k3-1m` 1M-context model needs the Allegretto tier or above.
- Command execution, file changes, plans, goals, diagnostics, image views, token usage, and collaborative tool calls normalized into Hive events.

### 🤖 Automation
- Define reusable **Team agents** (model, thinking level, system prompt, git-context injection, read-only mode).
- **Cron-schedule** agent runs for a project or standalone directory.
- Store run history, resolved prompts, summaries, status, duration, and errors; trigger manually and get completion/failure notifications.

</td>
</tr>
</table>

**Apps & integrations** — React 19 + Vite web UI with Tauri v2 desktop packaging · native SwiftUI iOS client (first-run onboarding, Brain, conversations, session switching, model selection, composer `#file`/`/command`/`@agent` autocomplete, read-only automations browser with run logs, PR status, scripts, push notifications, task tracker, connection status banner with tap-to-reconnect) · GitHub OAuth device flow via `gh`, PR status enrichment, `.env` management, global instructions, skills, subagents, Telegram/APNs notifications, Tailscale-friendly remote settings, external terminal & VS Code remote-SSH opening.

## Screenshots

> _Add screenshots or a short demo GIF here — e.g. the workspace chat, live diff view, and the iOS client. Drop images into `.github/assets/` and reference them below._

<!--
<p align="center">
  <img src=".github/assets/screenshot-workspace.png" alt="Workspace chat" width="80%" />
</p>
-->

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **Git** ≥ 2.17
- **Claude CLI** installed and authenticated (`claude`)
- **GitHub CLI** installed and authenticated for GitHub-backed flows (`gh`)
- _Optional:_ **Codex CLI** (`codex`) for OpenAI model support
- _Optional (desktop build):_ **Rust** ≥ 1.77 for Tauri
- _Optional (remote):_ a way to reach the server — a public address, or a private network you run
  yourself (Tailscale, WireGuard, ZeroTier, a cloud provider's private network)

> The backend preflight requires `git`, `claude`, and `gh`. `codex` is optional and only affects its provider features.

### Install

```bash
git clone https://github.com/unfence-labs/hive.git
cd hive
npm install
```

### Run (local dev)

Backend and frontend run in separate terminals:

```bash
cd backend && npm run dev      # → http://127.0.0.1:3000
```

```bash
cd frontend && npm run dev     # → http://localhost:5173
```

Desktop app:

```bash
cd frontend
npm run tauri dev              # develop
npm run tauri build           # package
```

Running Hive on a server, and connecting a client to it, is covered in
**[GETTING_STARTED.md](GETTING_STARTED.md)**.

### Install on a server

Check **[docs/prerequisites.md](docs/prerequisites.md)** first: supported systems, the access the
installer needs, and exactly what it does and does not change on a server that already runs other
software.

#### From the desktop app

The desktop app installs Hive on a server itself, over SSH, with no terminal. With no server
configured it opens on launch; otherwise it is under **Settings → Connection → Install Hive on a
server**.

It walks through giving the address and port, picking an SSH key from `~/.ssh`, approving the
server's host key fingerprint, running the installer's own read-only preflight over that same
connection and listing every finding while the form is still editable — and, only on a server that
already runs an active `ufw`, asking there how that one firewall rule should be written — restating
the settled plan, and then running the install as a live checklist. The private key never leaves the
machine — only its path is stored, and only its public half is sent, to be authorized on the service
account. An account that needs a `sudo` password is asked for one, which is used for that install
only and never written to disk.

The install itself cannot be cancelled — the script runs on the server, so stopping the local end
would not stop it — but it resumes: each completed step is recorded on the server, so closing the
app or pressing Retry continues from there. On success the app stores the connection, including the
generated access token and `hive` as the SSH user for editor and terminal sessions, and finishes on
a screen for signing in to Claude, Codex and GitHub.

The desktop shell embeds the same provisioning script described below and streams it over the SSH
connection, so both paths install exactly the same server. Screen-by-screen detail is in
[GETTING_STARTED.md](GETTING_STARTED.md#1-guided-installer-desktop).

#### From a terminal

Every release publishes `provision.sh` alongside the backend tarballs. Run it as root on
Ubuntu 22.04/24.04 or Debian 12/13 (x86-64 or arm64) with systemd:

```bash
curl -fsSL https://github.com/unfence-labs/hive/releases/latest/download/provision.sh | bash
```

It installs Hive's own pinned Node.js runtime and the agent CLIs **inside `/opt/hive` and the
`hive` service account** — the system runtime is never read, replaced, or upgraded, and no vendor
package repository is added to the machine. It downloads the backend release, verifies it against
its published checksum before extraction, activates it with an atomic symlink swap, and runs it
under systemd as an unprivileged, sandboxed unit on port 9420.

It also generates the server's access token, writes only its SHA-256 digest to root-owned
`/etc/hive/hive.env`, and prints the plaintext exactly once on its progress stream — never to a
log file. Every run rotates the token, so keep the value the run reports.

Progress is NDJSON, one record per line, so a client can render a live checklist; failures carry a
typed code from `shared/setup-errors.ts`. The run takes an exclusive lock and records each step, so
it is safe to interrupt and re-run. An existing Hive install is an update, not an error.

The guiding assumption is that **the server is already doing something else**. Check what the
installer would find, without changing anything, before you commit to it:

```bash
curl -fsSL <url>/provision.sh | bash -s -- --preflight
```

Preflight reports the operating system and architecture, whether the port is free, whether the
chosen directories are writable with room to spare, whether Hive is already installed, which host
firewall is present and whether it is active, what network interfaces the server has, and whether
privilege escalation needs a password. It writes nothing and always exits 0: findings are data, not
a verdict.

| Option | Environment variable | Default | What it sets |
|---|---|---|---|
| `--install-dir` | `HIVE_INSTALL_DIR` | `/opt/hive` | Hive, its private Node runtime and the uninstaller |
| `--data-dir` | `HIVE_DATA_DIR` | `/home/hive/.hive` | Projects, worktrees and sessions — the directory that grows |
| `--port` | `HIVE_PORT` | `9420` | Backend port |
| `--firewall-interface` | `HIVE_FIREWALL_INTERFACE` | — | Scope the one firewall rule to this interface instead of opening the port. Only consulted when a firewall is already active |
| `--ssh-public-key` | `HIVE_SSH_PUBLIC_KEY` | — | Authorize this key on the `hive` account |
| `--preflight` | — | — | Report and change nothing |

`/etc/hive` and `/var/lib/hive` stay fixed.

```bash
# Options are passed through `bash -s --`:
curl -fsSL <url>/provision.sh | bash -s -- --port 9420 --install-dir /srv/hive --data-dir /mnt/hive
```

**How the server is reached is the operator's business.** There is no network mode: the installer
takes the address that reaches the server, and a public address, a private network the operator
runs themselves (Tailscale, WireGuard, ZeroTier, a cloud provider's private network) or a second NIC
are all the same to it. Hive neither installs nor configures any of them. The backend binds every
interface and the access token is the security boundary either way.

**The firewall stays the operator's.** The installer never enables it and never changes its default
policy. If a firewall is already active it adds exactly one rule — the configured port, or inbound
on `--firewall-interface` when one is given — and nothing else. If none is active it does nothing
and reports that, so you know what is and is not open. Every outcome lands on the progress stream.
Only `ufw` is modified; `firewalld` and a raw `nftables` ruleset are detected and reported, never
edited.

Because the service account owns every repository and worktree, pass `--ssh-public-key` so an
editor or terminal session connects as `hive` rather than root. The key is appended to
`/home/hive/.ssh/authorized_keys` idempotently: a re-run neither duplicates it nor removes keys you
added by hand. Without this, files an editor saves become root-owned and the agent can no longer
write them.

Each install writes `<install-dir>/hive-uninstall.sh`, carrying the paths that run actually used:

```bash
sudo /opt/hive/hive-uninstall.sh            # remove Hive, keep your data
sudo /opt/hive/hive-uninstall.sh --purge    # remove your data as well
```

It removes the service unit, the install directory and private runtime, the configuration, the
provisioning state, the service account and the one firewall rule the install added. It never
removes system packages, package repositories, or your data.

### Scripts

```bash
# From the repository root
npm run lint
npm run typecheck
npm run test

# Build the backend release tarball for the host architecture into dist-release/.
# Requires a Linux host on Node 22 (native modules are compiled during the build).
npm run release:backend -- 0.0.0-dev

# Bundle scripts/provision/{lib,steps,main}.sh into scripts/provision/dist/provision.sh.
npm run release:provision -- 0.0.0-dev

# Provisioning checks: contracts run anywhere in a second; the end-to-end lane
# needs Docker and builds a real release tarball.
npm run test:provision
npm run test:provision:e2e            # install | guards | checksum | rollback | chaos
npm run test:provision:e2e neighbour  # install beside a live service and prove it survives
npm run test:provision:e2e preflight  # prove preflight changes nothing
npm run test:provision:e2e paths      # non-default install and data directories
npm run test:provision:e2e uninstall  # uninstall, and --purge
```

Per-package commands (`backend`, `frontend`, `ios`) are documented in **[AGENTS.md](AGENTS.md)**.

## Configuration

<details>
<summary><b>Backend environment variables</b></summary>

This table is the single source of truth for backend environment variables; the other documents
point at it rather than repeating it.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for projects, workspaces, sessions, prompts, Brain, config, and automations |
| `HIVE_AUTH_TOKEN` | unset | Access token in plaintext. Requires bearer/token auth for API and WS when set; `/health` stays public |
| `HIVE_AUTH_TOKEN_SHA256` | unset | The same token as a lowercase hex SHA-256 digest, so the plaintext never lands on the server. What `provision.sh` writes. A request authorizes if it matches either form |
| `HIVE_ALLOWED_HOSTS` | unset | Extra hostnames accepted by the `Host` guard, comma-separated. IP literals, `localhost` and `*.ts.net` are always accepted; anything else gets `403` until listed |
| `HIVE_ALLOWED_ORIGINS` | unset | Extra browser origins accepted for CORS and WebSocket upgrades, comma-separated. The desktop webview's origins are always accepted, plus `localhost:5173` outside production |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `HIVE_AUTOMATION_TIMEOUT_SEC` | `1800` | Per-run timeout for scheduled automations |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `HIVE_DEBUG_AGENT_LOGS` | unset | Verbose agent process logging when `1`/`true`/`yes`/`on` |
| `GITHUB_CLIENT_ID` | built in | Override GitHub OAuth app client id |

**With neither `HIVE_AUTH_TOKEN` nor `HIVE_AUTH_TOKEN_SHA256` set, the backend has no expectation to
check and accepts every request.** `ecosystem.config.cjs` sets neither, so a manually started
production server is unauthenticated until you configure one. `provision.sh` generates a token,
writes only its digest, and refuses to finish a run in which an unauthenticated request to
`/api/projects` does not return `401`.

</details>

<details>
<summary><b>Frontend environment variables</b></summary>

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | derived from browser location | Override WS base URL |

</details>

Connection host, port, access token, SSH user, Telegram, APNs, theme, accent color, CLI status, prompt settings, instructions, skills, Team agents, and subagents are configured **in the UI**.

Agent and GitHub accounts are connected **in the UI** too, with no terminal: Settings → CLI tools signs in Claude Code, Codex, and GitHub. Each is a browser confirmation — GitHub and Codex use device codes, Claude opens a page and takes an authorization code back. Connecting either Claude or Codex is enough to run sessions; nothing requires both.

<details>
<summary><b>Production backend (pm2)</b></summary>

The backend ships `backend/ecosystem.config.cjs` for pm2:

| Environment | Host | Port | Data dir |
|---|---:|---:|---|
| `production` | `0.0.0.0` | `9420` | `~/.hive` |
| `development` | `127.0.0.1` | `3000` | `~/.hive-dev` |

```bash
cd backend
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 logs hive-backend
```

</details>

## Architecture

Hive is a TypeScript monorepo with a native iOS client.

```
backend/    Fastify REST API, WebSocket hub, provider runners, git/worktree management,
            Brain, automation scheduler, notifications, file-backed state
frontend/   React 19 + Vite web UI and Tauri v2 desktop shell
ios/        SwiftUI client sharing the same REST and hub protocols
shared/     TypeScript helpers shared by backend and frontend
```

**Core model:** `Project → Workspace → Session`
- **Project** — a bare git repository.
- **Workspace** — a git worktree and branch under a project.
- **Session** — a persisted, resumable agent conversation.
- **Brain** — a singleton normal git clone addressed through the synthetic workspace id `brain`.

<details>
<summary><b>Data layout (<code>$DATA_DIR</code>)</b></summary>

```text
$DATA_DIR/
|-- config.json
|-- ui-preferences.json
|-- automations.json
|-- agents.json
|-- prompts/
|   |-- base.md
|   |-- brain.md
|   |-- issue-draft.md
|   `-- <template-id>.md
|-- brain/
|   |-- state.json
|   |-- repo/
|   `-- sessions/
|-- automations/
|   `-- <automation-id>/
|       |-- runs/
|       |   `-- <run-id>/
|       |       |-- messages.jsonl
|       |       `-- system-prompt.md
|       `-- workspace/
`-- proj-<id>/
    |-- state.json
    |-- env/
    |   `-- .env
    |-- repo.git/
    |-- workspaces/
    |   `-- <workspace-name>/
    |-- sessions/
    |   `-- <session-id>/
    |       |-- metadata.json
    |       |-- messages.jsonl
    |       `-- attachments/
    |-- archive/
    `-- logs/
```

</details>

<details>
<summary><b>HTTP API</b></summary>

Public backend surface exposed by route modules under `backend/src/api/`.

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Projects | `GET/POST /api/projects`, `GET/DELETE /api/projects/:id`, `POST /api/projects/:id/fetch`, `GET /api/projects/:id/favicon`, `GET/PUT /api/projects/:id/env` |
| Workspaces | `GET/POST /api/projects/:id/workspaces` (POST accepts an optional `source`: branch, PR, or issue), `GET /api/projects/:id/branches`, `GET /api/projects/:id/pulls`, `GET /api/projects/:id/issues`, `GET/DELETE /api/workspaces/:wsId`, `GET /api/workspaces/:wsId/files`, `GET /api/workspaces/:wsId/file`, `GET /api/workspaces/:wsId/file/raw`, `GET /api/workspaces/:wsId/file-completions`, `GET /api/workspaces/:wsId/diff`, `GET /api/workspaces/:wsId/diff/stat`, `POST /api/workspaces/:wsId/merge`, `POST /api/workspaces/:wsId/archive` |
| Sessions | `GET/POST/DELETE /api/workspaces/:wsId/session`, `GET /api/workspaces/:wsId/session/messages`, `GET/POST /api/workspaces/:wsId/sessions`, `POST /api/workspaces/:wsId/sessions/:sessionId/convert-to-terminal`, `DELETE /api/workspaces/:wsId/sessions/:sessionId`, `GET /api/workspaces/:wsId/sessions/:sessionId/messages`, `GET /api/workspaces/:wsId/sessions/:sessionId/attachments/:filename` |
| Brain | `GET/POST/DELETE /api/brain`, `GET /api/brain/files`, `GET/PUT /api/brain/file`, `GET /api/brain/file/raw`, `GET /api/brain/status`, `GET /api/brain/diff`, `POST /api/brain/save` |
| Models & usage | `GET /api/models`, `GET /api/provider-usage` |
| Completions | `GET /api/workspaces/:wsId/completions?provider=claude\|codex` |
| Automations | `GET/POST /api/automations`, `GET/PUT/DELETE /api/automations/:id`, `POST /api/automations/:id/trigger`, `GET /api/automations/:id/runs`, `GET /api/automations/:id/runs/:runId/messages` |
| Team agents | `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` |
| Prompts | `GET/POST /api/prompt-templates`, `PUT/DELETE /api/prompt-templates/:id`, `GET/PUT/DELETE /api/prompts/base`, `GET/PUT/DELETE /api/prompts/brain`, `GET/PUT/DELETE /api/prompts/issue-draft` |
| Settings | `GET/PUT /api/settings/defaults`, `GET/PUT /api/settings/notifications`, `POST /api/settings/notifications/test`, `POST /api/settings/notifications/test-apns`, `POST /api/devices/apns`, `GET/PUT/DELETE /api/settings/instructions`, `POST /api/settings/instructions/sync`, `GET/POST /api/settings/skills`, `GET/PUT/DELETE /api/settings/skills/:id`, `POST /api/settings/skills/:id/sync`, `POST /api/settings/skills/sync-missing`, `GET/POST /api/settings/subagents`, `GET /api/settings/subagents/:id`, `PUT/DELETE /api/settings/subagents/:id/providers/:provider`, `POST /api/settings/subagents/:id/providers/:provider/counterpart` |
| Account | `GET /api/account/status`, `POST /api/account/disconnect` |
| Tool setup | `GET /api/setup/tools`, `GET /api/setup/status`, `POST /api/setup/tools/:tool/:kind` (`kind` = `install` \| `update`) |
| Tool sign-in | `POST /api/setup/auth/:tool/start` (`tool` = `claude` \| `codex` \| `gh`), `POST /api/setup/auth/:tool/code`, `POST /api/setup/auth/:tool/cancel`, `POST /api/setup/auth/claude/token` |
| Scripts & prefs | `GET /api/workspaces/:wsId/scripts`, `POST /api/workspaces/:wsId/scripts/:type/start`, `POST /api/workspaces/:wsId/scripts/:type/stop`, `POST /api/workspaces/:wsId/terminal/start`, `POST /api/workspaces/:wsId/terminal/stop`, `POST /api/workspaces/:wsId/terminal-tabs/:sessionId/start`, `POST /api/workspaces/:wsId/terminal-tabs/:sessionId/stop`, `GET/PUT /api/ui-preferences` |

`wsId=brain` is valid for session and hub routes through the shared session dispatcher.

</details>

<details>
<summary><b>WebSocket API</b></summary>

**Hub** — `ws://<host>/ws/hub`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`.
- Clients send hub-level `sync_workspaces` and `ping`; workspace events include `switch_session`, `user_message`, `stop`, `tool_input_response`.
- Finalized history is fetched over REST for every client; the hub bootstrap sends only `status` and live stream snapshots and never a WS `history` frame.
- Server workspace events: `status`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `agent_activity`, `stream_snapshot`, `tool_input_required`, `tool_input_resolved`, `done`, `cancelled`, `error`, `branch_info`, `diff_stats`, `pr_status`, `script_status`, `browser_status`, `plan_mode_changed`, and legacy `history`.

**Script stream** — `ws://<host>/ws/script/:wsId?type=<scriptType>` · binary frames are PTY bytes; JSON control messages are `ready`, `exit`, `error`.

**Terminal stream** — `ws://<host>/ws/terminal/:wsId?sessionId=<sessionId>` · same PTY protocol, keyed by terminal-tab session id.

**Browser stream** — `ws://<host>/ws/browser/:wsId/:sessionId` · proxies `agent-browser` screencast output and viewport resize messages.

</details>

## Testing & CI

- Backend/frontend tests use **Vitest**; iOS uses **Swift Testing**.
- Tests live next to source: `backend/src/**/*.test.ts`, `frontend/tests/**`, `ios/Tests/**`.
- CI runs Node lint, typecheck, build, and tests, plus iOS Swift package tests and an iOS app compile on every push/PR to `main`.
- Provisioning has two lanes. `test/provision/contract.sh` (`npm run test:provision`, in CI) asserts the shell and TypeScript error taxonomies stay in sync, that the deliberate departures from the reference install flow stay departed, that the token never reaches a log file, and that shellcheck is clean. `test/provision/e2e-docker.sh` (`npm run test:provision:e2e`) is the Docker lane: it builds a real backend tarball, provisions a bare Ubuntu 24.04 systemd container from it, and proves the backend comes up healthy, rejects a request with no token, and accepts one with the right token. Its `neighbour` mode installs onto a server already running a web server on port 80 and a service on 5432 and proves an outside peer can still reach them afterwards — first with `ufw` installed but inactive, then with `ufw` active under the operator's own policy, where exactly one rule is added and the default policy is untouched. `preflight` compares a filesystem and service-table snapshot before and after, `paths` drives a non-default install and data directory end to end, and `uninstall` proves the generated script removes the install, keeps the data, and removes that too under `--purge`. All modes run on demand via `.github/workflows/provision-e2e.yml`.
- Pushing a `v<version>` tag runs `.github/workflows/release.yml`, which builds the backend tarball on native linux-x64 and linux-arm64 runners and attaches `hive-backend-<version>-linux-<arch>.tar.gz` plus its `.sha256`, and the generated `provision.sh`, to the GitHub release. The tag must match the version in `frontend/src-tauri/Cargo.toml`.

Run the narrowest relevant checks during development, then the root checks before considering broad changes done. For iOS changes, also run `cd ios && swift test`.

## Roadmap

> This is the single approved place for documented remaining work. Do not add TODO / roadmap / "future" notes to `AGENTS.md`, `GETTING_STARTED.md`, or standalone docs.

**Workspace & git UX**
- Structure merge-conflict API responses instead of returning generic merge errors.
- Expose project fetch and workspace merge actions in the frontend.
- Add manual workspace rename/alias support.

**Provider & protocol polish**
- Harden Codex App Server resume verification after process loss or forced interruption.
- Continue promoting useful Codex App Server diagnostics into richer UI when a product surface is clear.
- Profile long reasoning streams and, if they show meaningful CPU or WebSocket overhead, avoid reparsing and retransmitting the full accumulated reasoning block on every delta.
- Support Claude Code session-scoped scheduling (`/loop` dynamic mode, `ScheduleWakeup`, `Monitor`, `CronCreate/List/Delete`) and background-task tools (`run_in_background` Bash/Agent). These depend on a persistent, idle harness process that fires wakeups between turns and listens for `task_notification` `system` events — neither exists in Hive's one-shot `claude --print` per-turn model. These tools are currently suppressed at the provider (`--disallowedTools` plus `CLAUDE_CODE_DISABLE_CRON=1` and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`) so the model stays synchronous; `CLAUDE_CODE_ENABLE_TASKS=true` keeps synchronous subagents working. Full support requires a per-session scheduler that persists wakeups, re-invokes `claude --resume -p` at the deadline, forwards `task_notification` to the UI, and surfaces background tasks — likely reusing the automation-scheduler timer infrastructure.

**Automation**
- Add GitHub event automations with webhook validation, PR/issue context enrichment, prompt variables, and GitHub comment/review output.
- Add script automations that run configured commands and capture output for notifications.
- Add automation chaining, concurrency limits, retry policy, and live hub streaming for automation runs.

**iOS**
- Add iOS UI for prompt template management.
- Add repository file browsing and richer diff inspection beyond dashboard summaries and chat-rendered diffs.

## Contributing

Contributions are welcome! Before opening a PR:

1. Read **[AGENTS.md](AGENTS.md)** — it covers commands, the repository map, coding rules, and architecture guardrails.
2. Run the relevant `lint`, `typecheck`, and targeted tests for the packages you touched (root checks for cross-cutting changes).
3. Keep the WebSocket protocol types aligned across `backend`, `frontend`, and `ios`.
4. Use English for all code, comments, UI copy, and commit messages.

Found a bug or have an idea? [Open an issue](https://github.com/unfence-labs/hive/issues).

## License

Released under the [GNU General Public License v3.0](LICENSE).

Copyright (C) 2026 419Labs. This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

---

<div align="center">
<sub>Built with 🧡 for people who run many agents at once.</sub>
</div>

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
- Up to **6 sessions per workspace**, with REST-fetched per-session history, queued follow-ups, unread indicators, and interrupt/stop handling.
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
- _Optional (remote):_ **Tailscale**

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

Remote backend + Tauri setup lives in **[GETTING_STARTED.md](GETTING_STARTED.md)**.

### Scripts

```bash
# From the repository root
npm run lint
npm run typecheck
npm run test
```

Per-package commands (`backend`, `frontend`, `ios`) are documented in **[AGENTS.md](AGENTS.md)**.

## Configuration

<details>
<summary><b>Backend environment variables</b></summary>

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for projects, workspaces, sessions, prompts, Brain, config, and automations |
| `HIVE_AUTH_TOKEN` | unset | Requires bearer/token auth for API and WS when set; `/health` stays public |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `GITHUB_CLIENT_ID` | built in | Override GitHub OAuth app client id |

</details>

<details>
<summary><b>Frontend environment variables</b></summary>

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | derived from browser location | Override WS base URL |
| `VITE_HIVE_AUTH_TOKEN` | unset | Bearer token for API and `token` query for WS |

</details>

Connection host/port, Telegram, APNs, theme, accent color, CLI status, prompt settings, instructions, skills, Team agents, and subagents are configured **in the UI**.

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
website/    Public marketing site + product docs (Markdown in website/docs/)
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
| Settings | `GET/PUT /api/settings/defaults`, `GET/PUT /api/settings/notifications`, `POST /api/settings/notifications/test`, `POST /api/settings/notifications/test-apns`, `POST /api/devices/apns`, `GET /api/settings/cli`, `GET/PUT/DELETE /api/settings/instructions`, `POST /api/settings/instructions/sync`, `GET/POST /api/settings/skills`, `GET/PUT/DELETE /api/settings/skills/:id`, `POST /api/settings/skills/:id/sync`, `POST /api/settings/skills/sync-missing`, `GET/POST /api/settings/subagents`, `GET /api/settings/subagents/:id`, `PUT/DELETE /api/settings/subagents/:id/providers/:provider`, `POST /api/settings/subagents/:id/providers/:provider/counterpart` |
| Account | `GET /api/account/status`, `POST /api/account/connect`, `POST /api/account/connect/poll`, `POST /api/account/disconnect` |
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

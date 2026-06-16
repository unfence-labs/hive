# Hive

Hive orchestrates AI coding agents across isolated git workspaces. It manages projects as bare repositories, creates workspaces as worktrees and branches, and stores each agent conversation as a resumable session.

Hive can run as a local web app, a Tauri desktop app connected to a local or remote backend, and a SwiftUI iOS client connected to the same backend.

## Current Capabilities

**Agent workspaces**
- Clone or create git-backed projects, then create isolated workspaces from them.
- Run Claude and Codex sessions with provider-aware model selection and per-session provider locking.
- Keep up to 4 sessions per workspace, with history replay, queued follow-up messages, unread indicators, and interrupt/stop handling.
- Stream assistant text, thinking, tool calls, file changes, diagnostics, tasks, images, plan updates, branch info, diff stats, and script status over the multiplexed hub WebSocket.
- Attach images to chat messages; backend resizes and stores attachments per session.
- Browse workspace files, preview raw files, inspect inline diffs, paste selected diff comments into prompts, and use `#file`, `/command`, and `@agent` autocomplete.

**Brain**
- Maintain one normal git clone as the Brain knowledge base.
- Create/connect/delete the Brain repository, edit Markdown notes, review working-tree changes, and Save by committing and pushing.
- Chat with the Brain through the same session stack as workspaces using the synthetic workspace id `brain`.
- Refresh Brain files, status, and open notes after agent writes.

**Providers**
- Claude uses streaming JSON from the Claude CLI.
- Interactive Codex chat uses `codex app-server`; Codex automations use `codex exec --json`.
- Codex App Server command execution, file changes, plan updates, goals, diagnostics, image views/generations, token usage, and collaborative agent tool calls are normalized into Hive events.

**Automation**
- Schedule cron-based agent runs for a project or a standalone directory.
- Build automation prompts from prompt templates, inline prompts, base prompts, and git context.
- Store run history, messages, resolved system prompts, summaries, status, duration, and errors.
- Trigger runs manually and send completion/failure notifications.

**Apps and integrations**
- React 19 + Vite frontend with Tauri v2 desktop packaging.
- Native SwiftUI iOS client with Brain, workspace conversations, session switching, chat, model selection, PR status, scripts, push notifications, task tracker, and Codex activity rendering.
- GitHub OAuth device flow through `gh`, PR status enrichment, project `.env` management, global instructions, skills, custom agents, prompt resources, theme/accent settings, Telegram notifications, APNs, Tailscale-friendly connection settings, external terminal opening, and VS Code remote SSH opening from Tauri.

## Prerequisites

- Node.js >= 20
- Git >= 2.17
- Claude CLI installed and authenticated (`claude`)
- GitHub CLI installed and authenticated when using GitHub-backed flows (`gh`)
- Optional: Codex CLI (`codex`) for OpenAI model support
- Optional desktop build: Rust >= 1.77 for Tauri
- Optional remote setup: Tailscale

The backend preflight requires `git`, `claude`, and `gh`. `codex` is optional and only affects its provider features.

## Installation

```bash
git clone <repo-url> hive
cd hive
npm install
```

## Local Development

Run backend and frontend in separate terminals:

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

Defaults:

- Backend: `http://127.0.0.1:3000`
- Frontend: `http://localhost:5173`

Run the desktop app:

```bash
cd frontend
npm run tauri dev
```

Build the desktop app:

```bash
cd frontend
npm run tauri build
```

Remote backend and Tauri setup lives in [GETTING_STARTED.md](GETTING_STARTED.md).

## Scripts

From the repository root:

```bash
npm run lint
npm run typecheck
npm run test
```

Per package:

```bash
cd backend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test

cd ../frontend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run tauri dev
npm run tauri build

cd ../ios
swift test
```

## Production Backend

The backend includes `backend/ecosystem.config.cjs` for pm2:

| Environment | Host | Port | Data dir |
|---|---:|---:|---|
| `production` | `0.0.0.0` | `9420` | `~/.hive` |
| `development` | `127.0.0.1` | `3000` | `~/.hive-dev` |

```bash
cd backend
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 logs hive-backend
pm2 restart hive-backend
pm2 stop hive-backend
```

## Configuration

Backend:

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for projects, workspaces, sessions, prompts, Brain, config, and automations |
| `HIVE_AUTH_TOKEN` | unset | Requires bearer/token auth for API and WS when set; `/health` remains public |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `GITHUB_CLIENT_ID` | built in | Override GitHub OAuth app client id |

Frontend:

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | derived from browser location | Override WS base URL |
| `VITE_HIVE_AUTH_TOKEN` | unset | Bearer token for API and `token` query for WS |

Connection host/port, Telegram, APNs, theme, accent color, prompt resources, instructions, skills, and custom agents are configured in the UI.

## Architecture

Monorepo layout:

- `backend/`: Fastify REST API, WebSocket hub, provider runners, git/worktree management, Brain, automation scheduler, notifications, and state persistence.
- `frontend/`: React app, Vite build, Tauri shell, shared chat/file/diff components, settings, and hooks.
- `ios/`: SwiftUI app using the same REST and hub protocols.
- `shared/`: TypeScript helpers shared by backend and frontend.

Core domain:

- **Project**: a bare git repository.
- **Workspace**: a git worktree and branch under a project.
- **Session**: a persisted agent conversation for a workspace.
- **Brain**: a singleton normal git clone addressed through workspace id `brain`.

Important backend areas:

- `backend/src/index.ts`: app wiring, auth/rate limiting, route registration, startup checks, git sync, scheduler, shutdown.
- `backend/src/api/`: REST route groups.
- `backend/src/ws/`: hub, script, and browser WebSockets.
- `backend/src/agents/`: session lifecycle, providers, runners, stream normalization, system prompts, session dispatch.
- `backend/src/brain/`: Brain repository, file, git, and Save operations.
- `backend/src/workspaces/`: project workspace lifecycle, diffs, merge/archive, file reads.
- `backend/src/services/`: git sync, automation scheduling, script runner, provider usage, browser session support.
- `backend/src/state/`: JSON and file-backed persisted state.
- `backend/src/utils/`: git wrapper, path safety, raw-file serving, GitHub integration, preflight, prompt/config parsing.

Important frontend areas:

- `frontend/src/App.tsx`: routing and global hub subscription.
- `frontend/src/pages/WorkspaceView.tsx`: workspace chat, file tabs, diffs, scripts, browser panel, PR status.
- `frontend/src/pages/BrainView.tsx`: Brain chat, notes tree, file tabs, modified list, Save flow.
- `frontend/src/pages/settings/`: settings surfaces.
- `frontend/src/components/chat/`: shared conversation, provider, task, question, plan, image, and activity rendering.
- `frontend/src/hooks/`: API, WS, conversation, sessions, files, Brain, automations, provider usage, preferences, and settings hooks.
- `frontend/src/lib/ws-transport.ts`: single multiplexed hub transport.

Important iOS areas:

- `ios/HiveMobile/HiveApp.swift`: app entry, tabs, navigation stacks.
- `ios/HiveMobile/Services/APIClient.swift`: REST client.
- `ios/HiveMobile/Stores/HubStatusMonitor.swift`: single hub WebSocket, workspace subscriptions, PR status polling, unread/streaming state.
- `ios/HiveMobile/Stores/ConversationStore.swift`: chat state and WS event handling.
- `ios/HiveMobile/Views/Brain/` and `ios/HiveMobile/Views/Chat/`: Brain, workspace, conversation, dashboard, task, tool, image, and activity UI.

## Data Layout

```text
$DATA_DIR/
|-- config.json
|-- ui-preferences.json
|-- automations.json
|-- agents.json
|-- prompts/
|   |-- base.md
|   |-- brain.md
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

## HTTP API

This is the public backend surface exposed by route modules under `backend/src/api/`.

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Projects | `GET/POST /api/projects`, `GET/DELETE /api/projects/:id`, `POST /api/projects/:id/fetch`, `GET /api/projects/:id/favicon`, `GET/PUT /api/projects/:id/env` |
| Workspaces | `GET/POST /api/projects/:id/workspaces`, `GET/DELETE /api/workspaces/:wsId`, `GET /api/workspaces/:wsId/files`, `GET /api/workspaces/:wsId/file`, `GET /api/workspaces/:wsId/file/raw`, `GET /api/workspaces/:wsId/file-completions`, `GET /api/workspaces/:wsId/diff`, `GET /api/workspaces/:wsId/diff/stat`, `POST /api/workspaces/:wsId/merge`, `POST /api/workspaces/:wsId/archive`, `GET /api/workspaces/:wsId/pr-status`, `POST /api/workspaces/pr-status/bulk` |
| Sessions | `GET/POST/DELETE /api/workspaces/:wsId/session`, `GET /api/workspaces/:wsId/session/messages`, `GET/POST /api/workspaces/:wsId/sessions`, `DELETE /api/workspaces/:wsId/sessions/:sessionId`, `GET /api/workspaces/:wsId/sessions/:sessionId/messages`, `GET /api/workspaces/:wsId/sessions/:sessionId/attachments/:filename` |
| Brain | `GET/POST/DELETE /api/brain`, `GET /api/brain/files`, `GET/PUT /api/brain/file`, `GET /api/brain/file/raw`, `GET /api/brain/status`, `GET /api/brain/diff`, `POST /api/brain/save` |
| Models and provider usage | `GET /api/models`, `GET /api/provider-usage` |
| Completions | `GET /api/workspaces/:wsId/completions?provider=claude\|codex` |
| Automations | `GET/POST /api/automations`, `GET/PUT/DELETE /api/automations/:id`, `POST /api/automations/:id/trigger`, `GET /api/automations/:id/runs`, `GET /api/automations/:id/runs/:runId/messages` |
| Task agents | `GET/POST /api/agents`, `GET/PUT/DELETE /api/agents/:id` |
| Prompts | `GET/POST /api/prompt-templates`, `PUT/DELETE /api/prompt-templates/:id`, `GET/PUT/DELETE /api/prompts/base`, `GET/PUT/DELETE /api/prompts/brain` |
| Settings | `GET/PUT /api/settings/notifications`, `POST /api/settings/notifications/test`, `POST /api/settings/notifications/test-apns`, `POST /api/devices/apns`, `GET /api/settings/agents`, `GET/PUT/DELETE /api/settings/instructions`, `POST /api/settings/instructions/sync`, `GET/POST /api/settings/skills`, `GET/PUT/DELETE /api/settings/skills/:id`, `POST /api/settings/skills/:id/sync`, `POST /api/settings/skills/sync-missing`, `GET/POST /api/settings/custom-agents`, `GET /api/settings/custom-agents/:id`, `PUT/DELETE /api/settings/custom-agents/:id/providers/:provider`, `POST /api/settings/custom-agents/:id/providers/:provider/counterpart` |
| Account | `GET /api/account/status`, `POST /api/account/connect`, `POST /api/account/connect/poll`, `POST /api/account/disconnect` |
| Scripts and preferences | `GET /api/workspaces/:wsId/scripts`, `POST /api/workspaces/:wsId/scripts/:type/start`, `POST /api/workspaces/:wsId/scripts/:type/stop`, `POST /api/workspaces/:wsId/terminal/start`, `POST /api/workspaces/:wsId/terminal/stop`, `GET/PUT /api/ui-preferences` |

`wsId=brain` is valid for session and hub routes through the shared session dispatcher.

## WebSocket API

Hub:

- Endpoint: `ws://<host>/ws/hub`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`
- Client sends `sync_workspaces`, `user_message`, `stop`, and `tool_input_response`.
- Server wraps events as `{ workspaceId, event }`.
- Current server events include `status`, `history`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `agent_activity`, `tool_input_required`, `tool_input_resolved`, `done`, `cancelled`, `error`, `branch_info`, `diff_stats`, `script_status`, and `plan_mode_changed`.

Script stream:

- Endpoint: `ws://<host>/ws/script/:wsId?type=<scriptType>`
- Binary frames are PTY bytes; JSON control messages include `ready`, `exit`, and `error`.

Browser stream:

- Endpoint: `ws://<host>/ws/browser/:wsId/:sessionId`
- Proxies `agent-browser` screencast output and viewport resize messages.

## Testing and CI

- Backend tests: `backend/src/**/*.test.ts`
- Frontend tests: `frontend/tests/**/*.test.ts(x)`
- iOS tests: `ios/Tests/**/*.swift`
- Backend/frontend use Vitest.
- iOS uses Swift Testing.
- CI runs Node lint, typecheck, build, tests, iOS Swift package tests, and an iOS app compile on push/PR to `main`.
- CI sets `NODE_ENV=test` so React 19 exports `act()` from the development bundle.

Run the narrowest relevant checks during development, then run the root checks before broad changes are considered done. For iOS changes, also run `cd ios && swift test` and an Xcode simulator build when available.

## Backlog

This section is the single approved place for documented remaining work. Do not add TODO, roadmap, "future", or "not yet" notes to `AGENTS.md`, `GETTING_STARTED.md`, or standalone docs.

**Workspace and git UX**
- Structure merge-conflict API responses instead of returning generic merge errors.
- Expose project fetch and workspace merge actions in the frontend.
- Add manual workspace rename/alias support.

**Provider and protocol polish**
- Visually distinguish `redacted_thinking` from normal thinking blocks.
- Harden Codex App Server resume verification after process loss or forced interruption.
- Continue promoting useful Codex App Server diagnostics into richer UI when a product surface is clear.

**Automation**
- Add GitHub event automations with webhook validation, PR/issue context enrichment, prompt variables, and GitHub comment/review output.
- Add script automations that run configured commands and capture output for notifications.
- Add automation chaining, concurrency limits, retry policy, and live hub streaming for automation runs.

**iOS**
- Add iOS UI for automations and prompt template management.
- Add repository file browsing and richer diff inspection on iOS beyond dashboard summaries and chat-rendered diffs.

## License

Private.

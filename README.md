# Hive

Hive is an orchestrator for running multiple Claude Code conversations in parallel across isolated Git workspaces. It can run locally or as a remote backend with a Tauri desktop client connected over Tailscale.

It manages:
- projects as bare repositories,
- workspaces as Git worktrees/branches,
- sessions as persistent Claude conversations with WebSocket streaming.

## Current Capabilities

**Core**
- Project import (`git clone --bare`) with repository URL validation and remote fetch.
- Workspace lifecycle (create, list, delete, archive, merge) with auto-naming via dedicated Claude subprocess.
- Multi-session support per workspace (create, list, activate, delete, switch, replay history).
- Conversation WebSocket with session focus, history replay, buffered event replay, and per-session streaming status.
- Interactive Claude tool loop for `AskUserQuestion` and `ExitPlanMode` with plan proposal cards.
- Image attachments persisted per session (paste, drag-drop, file picker).
- Per-workspace PTY terminal (`/ws/terminal/:wsId`) with resize and binary I/O.
- File tree + file content viewer with Shiki syntax highlighting.
- Unified diff + committed/uncommitted/untracked diff stats.

**Live sync**
- Real-time branch name, PR status, and diff-stat snapshots via background git polling over WebSocket.
- Script execution status broadcasting (`script_status` WS messages).

**Automation**
- Workspace setup/run scripts via `hive.json` with PTY execution and live terminal output.
- Slash-command / agent autocomplete scanning from user and project `.claude` directories.

**Integrations**
- GitHub OAuth device flow for `gh` CLI authentication and git credential setup.
- Telegram notifications on agent turn completion (UI-configurable bot token + chat ID).
- Preflight dependency checks on startup (git, claude, gh).

**Settings**
- Tailscale connection config (IP + port) with health check indicator.
- Appearance settings (accent color picker).
- Account settings (GitHub connect/disconnect with profile display).
- Notification settings (Telegram enable/disable, test message).
- Per-repository detail view with deletion controls.

**Desktop**
- Tauri v2 desktop app (macOS `.dmg`, Windows `.exe`) with native titlebar integration.
- macOS traffic light positioning, drag regions, and App Transport Security exceptions for Tailscale HTTP.

**Security**
- Optional auth token + in-memory request rate limiting.
- File content API with path traversal protection and 1 MB size cap.

## Prerequisites

- Node.js >= 20
- Git >= 2.20
- Claude CLI installed and authenticated (`claude` command)
- Optional: GitHub CLI (`gh`) for PR status in the UI
- Optional (desktop app): Rust >= 1.77 for Tauri builds
- Optional (remote setup): Tailscale for secure backend connectivity

## Installation

```bash
git clone <repo-url> hive
cd hive
npm install
```

## Local Development

Run in two terminals.

Terminal 1 (backend):

```bash
cd backend
npm run dev
```

Terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

Defaults:
- Backend: `http://127.0.0.1:3000`
- Frontend: `http://localhost:5173`

### Tauri Desktop App

The frontend can be run as a native desktop app using Tauri:

```bash
cd frontend
npm run tauri dev
```

To build a distributable `.dmg` / `.exe`:

```bash
cd frontend
npm run tauri build
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for remote backend setup with Tailscale.

### Production Deployment (pm2)

The backend includes a pm2 ecosystem config at `backend/ecosystem.config.cjs` with two environments:

| Environment | Host | Port | Data Dir |
|---|---|---|---|
| `production` | `0.0.0.0` | `69420` | `~/.hive` |
| `development` | `127.0.0.1` | `3000` | `~/.hive-dev` |

```bash
cd backend
npm run build

# Start
pm2 start ecosystem.config.cjs --env production
pm2 start ecosystem.config.cjs --env development

# Manage
pm2 logs hive-backend        # stream logs
pm2 restart hive-backend     # restart
pm2 stop hive-backend        # stop
pm2 delete hive-backend      # remove from pm2

# Persist across reboots
pm2 save
pm2 startup
```

## Scripts

From repo root:

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
```

## Environment Variables

### Backend

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for prompts/projects/workspaces/sessions |
| `HIVE_AUTH_TOKEN` | _(unset)_ | If set, requires auth for API + WS (`/health` stays public) |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP within one window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `GITHUB_CLIENT_ID` | _(built-in)_ | Override GitHub OAuth App client ID |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | _(derived from browser location)_ | Override WS base URL |
| `VITE_HIVE_AUTH_TOKEN` | _(unset)_ | Bearer token for API and `token` query for WS |

## HTTP API

### Projects

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | Create project (clone bare repo) |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:id` | Get project |
| `DELETE` | `/api/projects/:id` | Delete project (must have zero active workspaces) |
| `POST` | `/api/projects/:id/fetch` | Fetch remote updates |

### Workspaces

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/:id/workspaces` | Create workspace |
| `GET` | `/api/projects/:id/workspaces` | List project workspaces |
| `GET` | `/api/workspaces/:wsId` | Get workspace details + default branch |
| `DELETE` | `/api/workspaces/:wsId` | Delete workspace |
| `GET` | `/api/workspaces/:wsId/diff` | Unified diff (committed + uncommitted + untracked) |
| `GET` | `/api/workspaces/:wsId/diff/stat` | Diff stats (`committed` + `uncommitted`) |
| `GET` | `/api/workspaces/:wsId/files` | Workspace file tree |
| `GET` | `/api/workspaces/:wsId/file?path=<file>` | Read workspace file content |
| `POST` | `/api/workspaces/:wsId/merge` | Merge workspace branch into default branch |
| `POST` | `/api/workspaces/:wsId/archive` | Archive workspace and remove worktree |
| `GET` | `/api/workspaces/:wsId/completions` | Completion items for `/` and `@` autocomplete |

### Sessions

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workspaces/:wsId/session` | Get or create active session |
| `GET` | `/api/workspaces/:wsId/session` | Get active session metadata |
| `GET` | `/api/workspaces/:wsId/session/messages` | Get latest persisted messages |
| `DELETE` | `/api/workspaces/:wsId/session` | End active session |
| `GET` | `/api/workspaces/:wsId/sessions` | List all workspace sessions |
| `POST` | `/api/workspaces/:wsId/sessions` | Create new session |
| `POST` | `/api/workspaces/:wsId/sessions/:sessionId/activate` | Activate specific session |
| `DELETE` | `/api/workspaces/:wsId/sessions/:sessionId` | Hard-delete a session |
| `GET` | `/api/workspaces/:wsId/sessions/:sessionId/messages` | Get messages for a specific session |

### Settings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/notifications` | Get notification config (Telegram) |
| `PUT` | `/api/settings/notifications` | Update notification config |
| `POST` | `/api/settings/notifications/test` | Send a test Telegram message |

### Account

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/account/status` | GitHub CLI install + auth status + user profile |
| `POST` | `/api/account/connect` | Start GitHub OAuth device flow |
| `POST` | `/api/account/connect/poll` | Poll for device flow completion |
| `POST` | `/api/account/disconnect` | Logout from GitHub CLI |

### Scripts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/workspaces/:wsId/scripts` | Get `hive.json` config + script statuses |
| `POST` | `/api/workspaces/:wsId/scripts/:type/start` | Start setup or run script |
| `POST` | `/api/workspaces/:wsId/scripts/:type/stop` | Stop a running script |

## WebSocket API

### Conversation stream

- Endpoint: `ws://<host>/ws/session/:wsId`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`

Client -> server:
- `{ "type": "switch_session", "sessionId": "..." }`
- `{ "type": "user_message", "content": "...", "images": [...], "options": { "planMode": boolean, "thinkingEnabled": boolean }, "sessionId": "..." }`
- `{ "type": "stop", "sessionId": "..." }`
- `{ "type": "tool_input_response", "requestId": "...", "toolName": "AskUserQuestion|ExitPlanMode", "result": ... , "sessionId": "..." }`

Server -> client (main types):
- `status`, `history`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `tool_input_required`, `done`, `cancelled`, `error`, `branch_info`, `diff_stats`, `script_status`

### Script stream

- Endpoint: `ws://<host>/ws/script/:wsId/:type`
- Binary frames: PTY output bytes from the running script
- Server control messages: `ready`, `exit`, `error`

### Terminal stream

- Endpoint: `ws://<host>/ws/terminal/:wsId`
- Binary frames: PTY input/output bytes
- JSON control frames: `{ "type": "resize", "cols": number, "rows": number }`
- Server control messages: `ready`, `exit`, `error`

## Architecture

Hierarchy:
- **Project**: bare Git repo
- **Workspace**: worktree + branch (`workspace/<city-name>`)
- **Session**: Claude conversation persisted under the project

Backend key modules:
- `backend/src/api/projects.ts` project CRUD + fetch
- `backend/src/api/workspaces.ts` workspace CRUD + diff/stat + files + merge + archive
- `backend/src/api/agents.ts` session routes (single + multi-session)
- `backend/src/api/completions.ts` completion scanning endpoint
- `backend/src/api/settings.ts` notification config CRUD
- `backend/src/api/account.ts` GitHub OAuth device flow + CLI integration
- `backend/src/api/scripts.ts` setup/run script lifecycle
- `backend/src/ws/stream.ts` conversation WebSocket protocol
- `backend/src/ws/terminal.ts` PTY terminal WebSocket
- `backend/src/ws/script.ts` script execution WebSocket
- `backend/src/agents/agent-manager.ts` in-memory session registry, persistence, switching
- `backend/src/agents/conversation-session.ts` Claude process lifecycle per turn
- `backend/src/agents/naming.ts` branch + session auto-naming via dedicated Claude subprocess
- `backend/src/services/git-sync.ts` branch/PR/diff polling and workspace broadcasts
- `backend/src/services/script-runner.ts` PTY-based script execution with status broadcasting
- `backend/src/notifications/` Telegram notification channel + event dispatcher
- `backend/src/state/state.ts` JSON persistence + per-project locks
- `backend/src/state/config.ts` file-based app config (`config.json`)
- `backend/src/utils/preflight.ts` startup dependency checks (git, claude, gh)
- `backend/src/utils/hive-config.ts` `hive.json` parser for workspace scripts

Frontend key modules:
- `frontend/src/pages/WorkspaceView.tsx` main chat/terminal/file tree/diff/scripts UI
- `frontend/src/pages/settings/` settings pages (Appearance, Connection, Account, Notifications, ProjectDetail)
- `frontend/src/hooks/useConversation.ts` reducer-driven conversation state + tool responses
- `frontend/src/hooks/useSessions.ts` multi-session operations
- `frontend/src/hooks/useWorkspaceLiveData.ts` live status/branch/diff/script data from WS
- `frontend/src/hooks/useProjects.ts` project/workspace state
- `frontend/src/hooks/useScripts.ts` script start/stop/status
- `frontend/src/hooks/useConnectionStatus.ts` backend health check
- `frontend/src/hooks/useTailscaleConfig.ts` Tailscale connection config
- `frontend/src/hooks/useServerUrl.ts` configurable backend URL resolution
- `frontend/src/lib/ws-transport.ts` resilient WS transport + replay buffer
- `frontend/src/components/Sidebar.tsx` project/workspace nav + archive/delete
- `frontend/src/components/Terminal.tsx` xterm + `/ws/terminal/:wsId`
- `frontend/src-tauri/` Tauri v2 desktop app (Rust shell, config, icons)

## Data Layout

```text
$DATA_DIR/
├── config.json
├── prompts/
│   └── base.md
└── proj-<id>/
    ├── state.json
    ├── repo.git/
    ├── workspaces/
    │   └── <workspace-name>/
    ├── sessions/
    │   └── <session-id>/
    │       ├── metadata.json
    │       ├── messages.jsonl
    │       └── attachments/
    ├── archive/
    │   └── <ws-id>/
    │       ├── workspace.json
    │       └── sessions/
    └── logs/
```

## Testing and CI

- Backend tests: `backend/src/**/*.test.ts`
- Frontend tests: `frontend/tests/**/*.test.ts(x)`
- Framework: Vitest
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, and tests on push/PR to `main`

## License

Private.

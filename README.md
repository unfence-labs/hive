# Hive

Hive is a local web orchestrator for running multiple Claude Code conversations in parallel across isolated Git workspaces.

It manages:
- projects as bare repositories,
- workspaces as Git worktrees/branches,
- sessions as persistent Claude conversations with WebSocket streaming.

## Current Capabilities

- Project import (`git clone --bare`) with repository URL validation.
- Workspace lifecycle (create, list, delete, archive, merge).
- File tree + file content APIs per workspace.
- Unified diff + committed/uncommitted diff stats.
- Multi-session support per workspace (create, list, activate, delete, replay history).
- Conversation WebSocket with session focus, history replay, and buffered event replay.
- Interactive Claude tool loop for `AskUserQuestion` and `ExitPlanMode`.
- Image attachments persisted per session.
- Per-workspace PTY terminal (`/ws/terminal/:wsId`) with resize and binary I/O.
- Live branch + PR + diff-stat snapshots via background git sync over WebSocket.
- Slash-command / agent autocomplete scanning from user and project `.claude` directories.
- Optional auth token + in-memory request rate limiting.

## Prerequisites

- Node.js >= 20
- Git >= 2.20
- Claude CLI installed and authenticated (`claude` command)
- Optional: GitHub CLI (`gh`) for PR status in the UI

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
- `status`, `history`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `tool_input_required`, `done`, `cancelled`, `error`, `branch_info`, `diff_stats`

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
- `backend/src/projects/` project lifecycle
- `backend/src/workspaces/` worktree lifecycle, diff, merge, archive, file APIs
- `backend/src/agents/` session lifecycle, stream parser, session switching
- `backend/src/ws/` WebSocket routes (`session`, `terminal`)
- `backend/src/services/git-sync.ts` branch/PR/diff sync snapshots + broadcasts
- `backend/src/state/` JSON persistence + project-level locking

Frontend key modules:
- `frontend/src/hooks/useProjects.ts` project/workspace state
- `frontend/src/hooks/useConversation.ts` session message state + interactive tool responses
- `frontend/src/hooks/useSessions.ts` multi-session operations
- `frontend/src/hooks/useWorkspaceLiveData.ts` live status/branch/diff data
- `frontend/src/lib/ws-transport.ts` resilient WS transport + replay buffer
- `frontend/src/pages/WorkspaceView.tsx` main chat/terminal/file tree/diff UI

## Data Layout

```text
$DATA_DIR/
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
- CI runs lint, typecheck, and tests on push/PR to `main`

## License

Private.

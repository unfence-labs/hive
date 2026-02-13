# Hive

Hive is a local web orchestrator for running multiple Claude Code conversations in parallel across isolated Git workspaces.

It manages:
- projects as bare repositories,
- workspaces as Git worktrees/branches,
- conversations as persistent Claude sessions with WebSocket streaming.

## What Works Today

- Project import (`git clone --bare`) with URL validation.
- Workspace lifecycle (create, list, delete, merge).
- Conversation streaming over WebSocket with persisted message history.
- Multi-session support per workspace (create, activate, delete, replay messages).
- Interactive Claude tool-input loop (`AskUserQuestion`, `ExitPlanMode`) from UI.
- Workspace file tree API + diff + diff stats + rich diff modal in UI.
- Per-workspace terminal via PTY (`/ws/terminal/:wsId`).
- Optional token auth + request rate limiting.

## Prerequisites

- Node.js >= 20
- Git >= 2.20
- Claude CLI installed and authenticated

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
| `HIVE_AUTH_TOKEN` | _(unset)_ | If set, requires auth for API + WS (`/health` remains public) |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP in one window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | _(derived from browser location)_ | Override WS base URL |
| `VITE_HIVE_AUTH_TOKEN` | _(unset)_ | Bearer token for API and `token` query for WS |

## API

### Projects

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | Create project (clone bare repo) |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:id` | Get project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `POST` | `/api/projects/:id/fetch` | Fetch remote updates |

### Workspaces

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/:id/workspaces` | Create workspace |
| `GET` | `/api/projects/:id/workspaces` | List project workspaces |
| `GET` | `/api/workspaces/:wsId` | Get workspace details |
| `DELETE` | `/api/workspaces/:wsId` | Delete workspace |
| `GET` | `/api/workspaces/:wsId/diff` | Unified diff (committed + uncommitted) |
| `GET` | `/api/workspaces/:wsId/diff/stat` | Diff stats (`committed` + `uncommitted`) |
| `GET` | `/api/workspaces/:wsId/files` | Workspace file tree |
| `POST` | `/api/workspaces/:wsId/merge` | Merge workspace branch into default branch |

### Sessions

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workspaces/:wsId/session` | Get or create active session |
| `GET` | `/api/workspaces/:wsId/session` | Get active session metadata |
| `GET` | `/api/workspaces/:wsId/session/messages` | Get latest persisted messages |
| `DELETE` | `/api/workspaces/:wsId/session` | End active session |
| `GET` | `/api/workspaces/:wsId/sessions` | List all workspace sessions |
| `POST` | `/api/workspaces/:wsId/sessions` | Create new session (parks current) |
| `POST` | `/api/workspaces/:wsId/sessions/:sessionId/activate` | Activate specific session |
| `DELETE` | `/api/workspaces/:wsId/sessions/:sessionId` | Hard-delete a session |
| `GET` | `/api/workspaces/:wsId/sessions/:sessionId/messages` | Get messages for a specific session |

## WebSocket

### Conversation stream

- Endpoint: `ws://<host>/ws/session/:wsId`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`

Client -> server:
- `{ "type": "user_message", "content": "...", "options": { "planMode": boolean, "thinkingEnabled": boolean } }`
- `{ "type": "stop" }`
- `{ "type": "tool_input_response", "requestId": "...", "toolName": "AskUserQuestion|ExitPlanMode", "result": ... }`

Server -> client:
- `status`, `history`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `tool_input_required`, `done`, `cancelled`, `error`

### Terminal stream

- Endpoint: `ws://<host>/ws/terminal/:wsId`
- Binary frames: PTY input/output bytes
- JSON control frames: `{ "type": "resize", "cols": number, "rows": number }`, plus server `ready|exit|error`

## Architecture

Hierarchy:
- **Project**: bare Git repo
- **Workspace**: worktree + branch
- **Session**: Claude conversation persisted under the project

Backend key modules:
- `backend/src/projects/` project lifecycle
- `backend/src/workspaces/` worktree lifecycle, diff, merge, file tree
- `backend/src/agents/` conversation sessions, stream parser, session manager
- `backend/src/ws/` WebSocket routes (`session`, `terminal`)
- `backend/src/state/` JSON persistence + project-level locking

Frontend key modules:
- `frontend/src/hooks/useProjects.ts` project/workspace state
- `frontend/src/hooks/useConversation.ts` chat/session state
- `frontend/src/hooks/useSessions.ts` session list/create/activate/delete
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
    │       └── messages.jsonl
    └── logs/
```

## Testing

- Backend tests: `backend/src/**/*.test.ts`
- Frontend tests: `frontend/tests/**/*.test.ts(x)`
- Framework: Vitest

## License

Private.

# Hive

Hive is a web orchestrator for running multiple Claude Code conversations in parallel across isolated git workspaces.

It clones repositories as bare repos, creates per-workspace git worktrees, and streams Claude CLI output to the UI via WebSocket.

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

## Quick Start

Open two terminals.

Terminal 1 (backend):

```bash
cd backend
DATA_DIR=/path/to/data npm run dev
```

Terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

- Backend default: `http://127.0.0.1:3000`
- Frontend default: `http://localhost:5173`

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
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `3000` | HTTP server port |
| `DATA_DIR` | `/data/projects` | Storage root for projects/workspaces/sessions |
| `HIVE_AUTH_TOKEN` | _(unset)_ | If set, requires auth for API and WS (`/health` stays public) |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP in one window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | _(derived from browser location)_ | Override WebSocket base URL |
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
| `GET` | `/api/projects/:id/workspaces` | List workspaces |
| `GET` | `/api/workspaces/:wsId` | Get workspace |
| `DELETE` | `/api/workspaces/:wsId` | Delete workspace |
| `GET` | `/api/workspaces/:wsId/diff` | Diff workspace branch vs base |
| `POST` | `/api/workspaces/:wsId/merge` | Merge workspace branch |

### Sessions

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workspaces/:wsId/session` | Create/resume session |
| `GET` | `/api/workspaces/:wsId/session` | Get active session metadata |
| `GET` | `/api/workspaces/:wsId/session/messages` | Get persisted chat messages |
| `DELETE` | `/api/workspaces/:wsId/session` | End session |

### WebSocket

- Endpoint: `ws://<host>/ws/session/:wsId`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`

Client -> server messages:
- `{ "type": "user_message", "content": "..." }`
- `{ "type": "stop" }`

Server -> client messages:
- `status`, `history`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `done`, `cancelled`, `error`

## Architecture

Hierarchy:
- Project: bare git repo
- Workspace: git worktree + branch
- Session: Claude CLI conversation linked to one workspace

Key backend modules:
- `backend/src/projects/` project lifecycle
- `backend/src/workspaces/` worktree lifecycle + diff + merge
- `backend/src/agents/` session manager + conversation process + stream parsing
- `backend/src/api/` REST routes
- `backend/src/ws/` WebSocket streaming
- `backend/src/state/` JSON persistence with per-project locking

Key frontend modules:
- `frontend/src/hooks/useApi.ts` REST client
- `frontend/src/hooks/useConversation.ts` chat/session state
- `frontend/src/lib/ws-transport.ts` reconnecting WS transport

## Data Layout

```text
$DATA_DIR/
└── proj-<id>/
    ├── state.json
    ├── repo.git/
    ├── workspaces/
    │   └── <workspace-name>/
    └── sessions/
        └── <session-id>/
            ├── metadata.json
            └── messages.jsonl
```

## Tech Stack

- Backend: Node.js, Fastify, @fastify/websocket, nanoid, Vitest
- Frontend: React 19, React Router 7, Vite 7, Tailwind CSS 4, shadcn/ui, Vitest

## License

Private.

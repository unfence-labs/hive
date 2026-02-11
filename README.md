# Hive

A web-based orchestrator for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents in parallel across isolated git workspaces.

Hive clones your repositories, creates git worktrees as isolated workspaces (each named after a city), and lets you launch Claude agents that work independently — with real-time output streaming via WebSocket.

## Prerequisites

- **Node.js** >= 20 (tested on v25)
- **Git** >= 2.20
- **Build tools** for native modules: `make`, `gcc`/`g++`, `binutils` (needed by `node-pty`)
- **Claude CLI** installed and authenticated (`claude -p` must work)

### Installing build tools

```bash
# Ubuntu/Debian
sudo apt install build-essential

# macOS (with Homebrew)
xcode-select --install
```

## Installation

```bash
git clone <repo-url> hive
cd hive
npm install
```

This installs dependencies for both `backend/` and `frontend/` via npm workspaces.

## Quick Start

Open two terminals:

**Terminal 1 — Backend:**

```bash
cd backend
DATA_DIR=/path/to/your/data npm run dev
```

The backend starts on `http://localhost:3000`. `DATA_DIR` is where Hive stores bare repos, worktrees, state files, and agent logs. Defaults to `/data/projects` if not set.

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

The frontend starts on `http://localhost:5173` and proxies API/WebSocket requests to the backend.

Open http://localhost:5173 in your browser.

## Usage

1. **Add a project** — Paste a git repository URL. Hive clones it as a bare repo.
2. **Create a workspace** — Each workspace is a git worktree with its own branch, named after a city.
3. **Launch an agent** — Enter a prompt. Hive runs `claude -p "<prompt>"` inside the workspace's worktree.
4. **Watch output** — Agent stdout streams to the terminal in real-time via WebSocket.
5. **Review & merge** — View the diff, optionally launch a review agent, then merge changes back to main.

## Running Tests

```bash
cd backend
npm test
```

Runs the full test suite (80 tests across 11 files). Tests create temporary git repos and clean up after themselves — no external dependencies needed.

Run a single test file:

```bash
cd backend
npx vitest run src/agents/agent-manager.test.ts
```

Type-check without emitting:

```bash
cd backend
npx tsc --noEmit
```

## Environment Variables

| Variable   | Default           | Description                                |
|------------|-------------------|--------------------------------------------|
| `HOST`     | `127.0.0.1`      | Backend bind address                       |
| `PORT`     | `3000`            | Backend port                               |
| `DATA_DIR` | `/data/projects`  | Root directory for repos, worktrees, logs  |
| `HIVE_AUTH_TOKEN` | _(unset)_ | If set, requires auth for API/WS (except `/health`) |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP within `HIVE_RATE_LIMIT_WINDOW_MS` |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls `--dangerously-skip-permissions` in Claude CLI |
| `VITE_HIVE_AUTH_TOKEN` | _(unset)_ | Frontend token sent as Bearer auth (HTTP) and `token` query (WS) |

## API

### Projects

| Method | Endpoint                      | Description              |
|--------|-------------------------------|--------------------------|
| POST   | `/api/projects`               | Clone repo (bare)        |
| GET    | `/api/projects`               | List all projects        |
| GET    | `/api/projects/:id`           | Get project details      |
| DELETE | `/api/projects/:id`           | Delete project           |
| POST   | `/api/projects/:id/fetch`     | Git fetch from remote    |

### Workspaces

| Method | Endpoint                            | Description              |
|--------|-------------------------------------|--------------------------|
| POST   | `/api/projects/:id/workspaces`      | Create workspace         |
| GET    | `/api/projects/:id/workspaces`      | List workspaces          |
| GET    | `/api/workspaces/:wsId`             | Get workspace details    |
| DELETE | `/api/workspaces/:wsId`             | Delete workspace         |
| GET    | `/api/workspaces/:wsId/diff`        | Git diff vs main         |
| POST   | `/api/workspaces/:wsId/merge`       | Merge workspace to main  |

### Agents

| Method | Endpoint                            | Description                        |
|--------|-------------------------------------|------------------------------------|
| POST   | `/api/workspaces/:wsId/agents`      | Launch agent (409 if workspace busy) |
| GET    | `/api/workspaces/:wsId/agents`      | Agent history for workspace        |
| GET    | `/api/agents/:agentId`              | Get agent status                   |
| DELETE | `/api/agents/:agentId`              | Stop running agent                 |

### WebSocket

| Endpoint                            | Description                      |
|-------------------------------------|----------------------------------|
| `ws://.../ws/agents/:agentId/stream` | Real-time agent output stream   |

Messages are JSON with format: `{ type: "stdout" | "exit" | "status", data?: string, code?: number, ts: number }`

## Project Structure

```
hive/
├── backend/
│   └── src/
│       ├── index.ts              # Fastify server entry point
│       ├── types.ts              # Shared TypeScript types
│       ├── state/                # JSON persistence (atomic writes)
│       ├── projects/             # Bare repo management
│       ├── workspaces/           # Git worktree lifecycle
│       ├── agents/               # Agent process (node-pty) + manager
│       ├── api/                  # REST route handlers
│       ├── ws/                   # WebSocket streaming
│       ├── utils/                # Git wrapper, city names, test helpers
│       └── __tests__/            # E2E integration tests
├── frontend/
│   └── src/
│       ├── pages/                # Route-level views
│       ├── components/           # UI components (+ shadcn/ui in ui/)
│       └── hooks/                # API & WebSocket hooks
├── package.json                  # Monorepo root (npm workspaces)
└── tsconfig.json                 # Shared TypeScript config
```

## Data Directory Layout

```
$DATA_DIR/
└── proj-abc123/
    ├── state.json                # Project state (workspaces, agents)
    ├── repo.git/                 # Bare clone
    ├── workspaces/
    │   ├── tokyo/                # Git worktree (branch: workspace/tokyo)
    │   └── berlin/               # Git worktree (branch: workspace/berlin)
    └── logs/
        ├── agent-xyz.log         # Full agent output
        └── agent-def.log
```

## Tech Stack

**Backend:** Node.js, Fastify, node-pty, @fastify/websocket, nanoid

**Frontend:** React 19, Vite, Tailwind CSS v4, shadcn/ui, xterm.js, diff2html, React Router v7

## License

Private.

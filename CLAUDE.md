# Hive

Multi-agent Claude Code orchestrator. Backend (Fastify) + Frontend (React) monorepo using npm workspaces.

## Commands

```bash
# Install (from repo root)
npm install

# Backend
cd backend
npm run dev          # tsx watch src/index.ts (hot reload, port 3000)
npm run build        # tsc
npm test             # vitest run (80 tests, ~5s)
npm run test:watch   # vitest in watch mode

# Frontend
cd frontend
npm run dev          # vite dev server (port 5173, proxies /api + /ws to :3000)
npm run build        # tsc -b && vite build
```

## Architecture

Project -> Workspace -> Agent hierarchy:
- **Project** = bare-cloned git repo (`git clone --bare`)
- **Workspace** = git worktree with a city name, branched from main
- **Agent** = `claude -p` process spawned via node-pty in a workspace's worktree

One active agent per workspace at a time (sequential, not parallel). Parallelism is between workspaces. Attempting to launch a second agent in a busy workspace returns 409.

State is persisted as JSON (`{dataDir}/{projectId}/state.json`) with atomic writes (tmp + rename).

### Key directories in code

- `backend/src/state/` - JSON persistence with atomic writes
- `backend/src/projects/` - Bare repo clone, fetch, CRUD
- `backend/src/workspaces/` - Git worktree lifecycle, diff, merge
- `backend/src/agents/` - Agent process (node-pty) + manager (lifecycle, 1-per-ws enforcement)
- `backend/src/api/` - Fastify REST routes
- `backend/src/ws/` - WebSocket streaming (agent output -> connected clients)
- `frontend/src/hooks/` - API and WebSocket hooks
- `frontend/src/pages/` - Route-level views
- `frontend/src/components/` - UI components (shadcn/ui primitives in `ui/`)

## Code Style

- ES modules everywhere (`import`/`export`, `.js` extensions in imports)
- Strict TypeScript (`strict: true`), no `any` unless unavoidable
- All code, comments, variable names in English
- Shared types in `backend/src/types.ts` and `frontend/src/types.ts`
- Backend route plugins accept optional `dataDir` param for testability (defaults to `DATA_DIR` env or `/data/projects`)
- Agent routes also accept `LaunchOptions` so tests can substitute `echo`/`bash` for `claude`
- Tests co-located with source files (`*.test.ts` next to `*.ts`), except e2e in `__tests__/`

## Testing

- Framework: vitest
- ALWAYS run `npm test` from `backend/` after changes to verify no regressions
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Tests create temp dirs and fixture git repos via `test-helpers.ts` — cleanup is in `afterEach`
- Agent manager tests use `LaunchOptions` with `echo` or `bash -c` to avoid requiring actual `claude` CLI
- WebSocket tests use slow commands (`sleep 0.3; echo ...`) to handle connection timing

## Environment Variables

- `HOST` - Backend bind address (default: `127.0.0.1`)
- `PORT` - Backend port (default: `3000`)
- `DATA_DIR` - Where projects/worktrees/logs live (default: `/data/projects`)

## Important

- NEVER use `child_process.spawn` directly for agents — use `node-pty` (it provides a proper PTY)
- NEVER shell-execute git commands — use the `git()` wrapper in `utils/git.ts` (uses `execFile`, no shell injection)
- The merge strategy uses a temp worktree: checkout main in temp dir, merge branch, update bare repo HEAD, cleanup. Do not try to merge directly in a bare repo
- `_clearActiveAgents()` in agent-manager is for test cleanup only
- Frontend proxies `/api` and `/ws` to the backend in dev mode via `vite.config.ts`

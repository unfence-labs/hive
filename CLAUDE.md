# Hive

Claude Code chat interface. Backend (Fastify) + Frontend (React) monorepo using npm workspaces.

## Commands

```bash
# Install (from repo root)
npm install
npm run lint
npm run typecheck
npm run test

# Backend
cd backend
npm run dev          # tsx watch src/index.ts (hot reload, port 3000)
npm run build        # tsc
npm run lint
npm run typecheck
npm test             # vitest run
npm run test:watch   # vitest in watch mode

# Frontend
cd frontend
npm run dev          # vite dev server (port 5173, proxies /api + /ws to :3000)
npm run build        # tsc -b && vite build
npm run lint
npm run typecheck
```

## Architecture

Project -> Workspace -> Session hierarchy:
- **Project** = bare-cloned git repo (`git clone --bare`)
- **Workspace** = git worktree with a city name, branched from main
- **Session** = conversation with Claude CLI (`--print --output-format stream-json --verbose`)

One active session per workspace at a time. Workspace status: `idle` or `busy`. Session auto-creates on first message via WebSocket.

State is persisted as JSON (`{dataDir}/{projectId}/state.json`) with atomic writes (tmp + rename). Session messages are persisted to `{dataDir}/{projectId}/sessions/{sessionId}/messages.jsonl`.

### Key directories in code

- `backend/src/state/` - JSON persistence with atomic writes
- `backend/src/projects/` - Bare repo clone, fetch, CRUD
- `backend/src/workspaces/` - Git worktree lifecycle, diff, merge
- `backend/src/agents/` - ConversationSession (Claude CLI), StreamParser (NDJSON), session manager
- `backend/src/api/` - Fastify REST routes (session CRUD)
- `backend/src/ws/` - WebSocket streaming (bidirectional chat, auto-creates sessions)
- `frontend/src/hooks/` - API and WebSocket hooks (useConversation, useProjects, useWorkspaces)
- `frontend/src/pages/` - Route-level views
- `frontend/src/components/` - UI components (shadcn/ui primitives in `ui/`)

### Claude CLI Integration

Uses `claude --print --output-format stream-json --verbose` (optionally with `--dangerously-skip-permissions`) which outputs NDJSON with:
- `type: "assistant"` — text, tool_use, thinking blocks
- `type: "user"` — tool_result blocks (tool outputs)
- `type: "result"` — session_id, cost, usage
- `type: "system"` — compaction markers

Session continuity via `--resume <claudeSessionId>` after first message.

## Code Style

- ES modules everywhere (`import`/`export`, `.js` extensions in imports)
- Strict TypeScript (`strict: true`), no `any` unless unavoidable
- All code, comments, variable names in English
- Shared types in `backend/src/types.ts` and `frontend/src/types.ts`
- Backend route plugins accept optional `dataDir` param for testability (defaults to `DATA_DIR` env or `/data/projects`)
- Session routes accept `SessionOptions` so tests can substitute `bash` for `claude`
- Tests co-located with source files (`*.test.ts` next to `*.ts`), except e2e in `__tests__/`

## Testing

- Framework: vitest
- ALWAYS run `npm test` from `backend/` after changes to verify no regressions
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Tests create temp dirs and fixture git repos via `test-helpers.ts` — cleanup is in `afterEach`
- Session manager tests use `SessionOptions` with `bash` to avoid requiring actual `claude` CLI
- ConversationSession tests mock `child_process.spawn` for unit isolation

## Environment Variables

- `HOST` - Backend bind address (default: `127.0.0.1`)
- `PORT` - Backend port (default: `3000`)
- `DATA_DIR` - Where projects/worktrees/sessions live (default: `/data/projects`)
- `HIVE_AUTH_TOKEN` - Optional API/WS bearer token (health endpoint stays public)
- `HIVE_RATE_LIMIT_MAX` - Max requests per IP per window (default: `120`)
- `HIVE_RATE_LIMIT_WINDOW_MS` - Rate-limit window in milliseconds (default: `60000`)
- `HIVE_CLAUDE_SKIP_PERMISSIONS` - Enables/disables Claude `--dangerously-skip-permissions` (default: `true`)
- `VITE_HIVE_AUTH_TOKEN` - Optional frontend token used for API and WS auth
- `VITE_WS_URL` - Optional frontend WS base URL override

## Important

- NEVER shell-execute git commands — use the `git()` wrapper in `utils/git.ts` (uses `execFile`, no shell injection)
- The merge strategy uses a temp worktree: checkout main in temp dir, merge branch, update bare repo HEAD, cleanup. Do not try to merge directly in a bare repo
- `_clearActiveSessions()` in agent-manager is for test cleanup only
- Frontend proxies `/api` and `/ws` to the backend in dev mode via `vite.config.ts`
- WebSocket at `/ws/session/:wsId` auto-creates sessions on first `user_message` — no need to POST first

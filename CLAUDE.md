# Hive Developer Notes

This repository is a monorepo:
- `backend/`: Fastify API + WebSocket server
- `frontend/`: React + Vite UI + Tauri desktop app (`frontend/src-tauri/`)

Hive runs Claude conversations in isolated Git workspaces (worktrees) created from a project's bare repo.

## Commands

From repo root:

```bash
npm install
npm run lint
npm run typecheck
npm run test
```

Backend:

```bash
cd backend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

Frontend:

```bash
cd frontend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run tauri dev    # run as desktop app
npm run tauri build  # build distributable
```

## Core Model

Project -> Workspace -> Session

- **Project**: bare-cloned Git repo (`git clone --bare`)
- **Workspace**: Git worktree + branch (`workspace/<city-name>`)
- **Session**: persisted Claude conversation for one workspace

One session is active per workspace, but multiple sessions can coexist and be switched/loaded from disk.

## Backend Architecture

- `backend/src/index.ts`: app wiring, auth/rate-limit hooks, route registration, git sync bootstrap
- `backend/src/api/projects.ts`: project CRUD + fetch
- `backend/src/api/workspaces.ts`: workspace CRUD + diff/stat + files/file + merge + archive
- `backend/src/api/agents.ts`: session routes (single + multi-session)
- `backend/src/api/completions.ts`: completion scanning endpoint
- `backend/src/ws/stream.ts`: conversation WebSocket protocol
- `backend/src/ws/terminal.ts`: PTY terminal WebSocket
- `backend/src/services/git-sync.ts`: branch/PR/diff polling and workspace broadcasts
- `backend/src/agents/conversation-session.ts`: Claude process lifecycle per turn
- `backend/src/agents/agent-manager.ts`: in-memory session registry, persistence, switching
- `backend/src/state/state.ts`: JSON persistence + per-project locks

### Important backend behavior

- Conversation turns use Claude CLI streaming mode (`--print --output-format stream-json -p`).
- Session continuity uses Claude `--session-id` and `--resume`.
- Blocking tools (`AskUserQuestion`, `ExitPlanMode`) are intercepted and surfaced as `tool_input_required`.
- Session tool responses are session-scoped; dismiss/approve/reject are routed back to the correct session.
- `getOrCreateSession()` recovers stale `busy` workspaces lazily (on access).
- Workspace merge is executed in a temporary worktree on default branch, then default-branch ref is updated.
- `archiveWorkspace()` removes worktree and moves matching session folders under `archive/<ws-id>/sessions`.
- Git sync pushes cached `branch_info` + `diff_stats` snapshots to new WS clients.

## Frontend Architecture

- `frontend/src/App.tsx`: routing and global workspace WS syncing
- `frontend/src/pages/WorkspaceView.tsx`: chat + terminal + file tree + modified files + diff modal
- `frontend/src/hooks/useConversation.ts`: reducer-driven WS conversation state
- `frontend/src/hooks/useSessions.ts`: list/create/activate/delete sessions
- `frontend/src/hooks/useWorkspaceLiveData.ts`: status/branch/diff live map
- `frontend/src/lib/ws-transport.ts`: reconnecting WS transport + replay buffer
- `frontend/src/components/Sidebar.tsx`: project/workspace nav + archive/delete actions
- `frontend/src/components/Terminal.tsx`: xterm + `/ws/terminal/:wsId`
- `frontend/src-tauri/`: Tauri v2 desktop app (Rust shell, config, icons)

### Important frontend behavior

- The frontend supports a configurable server URL (Settings > Server URL) for remote backend connectivity. All API calls (`useApi.ts`) and WebSockets (`ws-transport.ts`, `Terminal.tsx`) resolve the base URL via `getServerUrl()` from `useServerUrl.ts`.
- The app keeps WS channels synced for all known workspace IDs (`wsTransport.syncWorkspaces`).
- `useConversation` hydrates from REST history and resolves stale replay races with request tokens.
- Terminal instances are tracked in context; hidden terminals stay alive until explicitly closed.
- Session tabs support create/switch/delete with live message replay.
- Chat input supports image attachments, thinking toggle, plan mode, and `/` + `@` autocomplete.

## Coding Rules

- TypeScript strict mode, ES modules.
- Use English for code/comments/UI copy.
- Keep backend routes testable by preserving optional `dataDir` injection.
- Keep state mutations serialized via workspace/project lock helpers.

## Critical Guardrails

- **Do not execute raw shell git strings**. Use `git(args, cwd)` from `backend/src/utils/git.ts`.
- Validate repository URLs with `validateRepositoryUrl()` before cloning.
- Keep WebSocket protocol types in sync between:
  - `backend/src/types.ts`
  - `frontend/src/types.ts`
- When adding new WS message types, update:
  - backend stream dispatch,
  - frontend reducers/hooks (`useConversation`, `useWorkspaceLiveData`, `ws-transport` cache),
  - corresponding tests.

## Testing

- Backend tests live next to source (`backend/src/**/*.test.ts`).
- Frontend tests live in `frontend/tests/**`.
- Use `SessionOptions.command = "bash"` in backend tests to avoid local Claude CLI dependency.

## Tauri Desktop App

- Tauri v2 config: `frontend/src-tauri/tauri.conf.json`
- Icons: `frontend/src-tauri/icons/` (generated via `npx tauri icon <source.png>`)
- macOS icons require pre-baked squircle corners (macOS does not auto-mask like iOS).
- Icons are compiled into the Rust binary; after changing icons run `cargo clean` in `src-tauri/` then rebuild.
- Vite config (`frontend/vite.config.ts`) includes Tauri-specific settings (fixed port, HMR, build targets).

## Known Gaps (Current)

- Merge conflict API payload is not structured yet (merge failures still return generic errors).
- Fetch and merge actions are available in API but not exposed in frontend controls.
- No global React error boundary yet.
- No toast/notification system yet.
- No startup reconciliation sweep for all persisted workspaces on backend boot.
- No graceful SIGTERM/SIGINT shutdown flow that drains active sessions.
- Completion scanner does not yet include plugin commands (`~/.claude/plugins`).

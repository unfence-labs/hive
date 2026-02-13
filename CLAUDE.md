# Hive Developer Notes

This repository is a monorepo:
- `backend/`: Fastify API + WebSocket server
- `frontend/`: React + Vite UI

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
```

## Core Model

Project -> Workspace -> Session

- **Project**: bare-cloned Git repo (`git clone --bare`)
- **Workspace**: Git worktree + branch (`workspace/<city>`)
- **Session**: persisted Claude conversation for one workspace

One session is active in memory per workspace. Multiple sessions are supported on disk and can be activated/switched.

## Backend Architecture

- `backend/src/api/projects.ts`: project CRUD + fetch
- `backend/src/api/workspaces.ts`: workspace CRUD + diff/diff-stat/files + merge
- `backend/src/api/agents.ts`: session routes (single + multi-session)
- `backend/src/ws/stream.ts`: conversation WebSocket protocol
- `backend/src/ws/terminal.ts`: PTY terminal WebSocket
- `backend/src/agents/conversation-session.ts`: Claude process lifecycle per turn
- `backend/src/agents/agent-manager.ts`: session registry, persistence, switching
- `backend/src/state/state.ts`: JSON persistence + per-project locks

### Important backend behavior

- Conversation mode uses Claude CLI in print/stream mode per message (`--print --output-format stream-json -p`).
- Session continuity is preserved with Claude `--session-id` / `--resume`.
- Blocking tools (`AskUserQuestion`, `ExitPlanMode`) are intercepted and surfaced to UI as `tool_input_required`.
- `getOrCreateSession()` auto-recovers stale `busy` workspaces after backend restart.
- Merges happen in a **temporary worktree** on the default branch, then refs are updated in the bare repo.

## Frontend Architecture

- `frontend/src/pages/WorkspaceView.tsx`: chat + terminal toggle + file tree + diff UI
- `frontend/src/hooks/useConversation.ts`: reducer for WS messages + session switching
- `frontend/src/hooks/useSessions.ts`: list/create/activate/delete sessions
- `frontend/src/lib/ws-transport.ts`: reconnecting WS transport with replay buffer
- `frontend/src/components/Terminal.tsx`: xterm + `/ws/terminal/:wsId`

### Important frontend behavior

- App keeps WS session channels synced for all known workspace IDs (`wsTransport.syncWorkspaces`).
- `useConversation` resets state on workspace switch, then hydrates from REST history.
- Session selector supports create/switch/delete with confirmation dialog.
- Diff UI uses `@pierre/diffs` and supports line annotations to send context back into chat.

## Coding Rules

- TypeScript strict mode, ES modules.
- Use English for code/comments/UI copy.
- Keep backend routes testable by preserving optional `dataDir` injection.
- Keep session creation/switching serialized with workspace locks.

## Critical Guardrails

- **Do not execute raw shell git strings**. Use `git(args, cwd)` from `backend/src/utils/git.ts`.
- Validate repository URLs with `validateRepositoryUrl()` before cloning.
- Keep WebSocket protocol types in sync between:
  - `backend/src/types.ts`
  - `frontend/src/types.ts`
- When adding WS message types, update:
  - backend stream route dispatch,
  - frontend reducer in `useConversation`,
  - corresponding tests.

## Testing

- Backend tests live next to source (`backend/src/**/*.test.ts`).
- Frontend tests live in `frontend/tests/**`.
- Use `SessionOptions.command = "bash"` in backend tests to avoid depending on local Claude CLI.

## Known Gaps (Current)

- No global error boundary in frontend yet.
- No toast/notification system yet.
- No dedicated terminal log replay endpoint yet.
- Merge conflict UX is still generic (server returns an error, no structured conflict payload).

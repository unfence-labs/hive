# Hive — TODO

## Completed Recently

- [x] Multi-session API + UI (create, list, activate, delete, per-session messages)
- [x] Conversation history replay on WebSocket connect (`history` events)
- [x] Workspace status live updates through WS status messages (no manual refresh needed)
- [x] Workspace file tree endpoint + UI explorer (`/api/workspaces/:wsId/files`)
- [x] Diff stats endpoint + modified files panel (`/api/workspaces/:wsId/diff/stat`)
- [x] Rich diff modal with split/unified modes and line annotations
- [x] PTY terminal WebSocket (`/ws/terminal/:wsId`) with resize + input support
- [x] Interactive Claude tool flow for `AskUserQuestion` and `ExitPlanMode`
- [x] Repo URL sanitization (`file://` + local path protections in non-test mode)
- [x] Optional auth token + API/WS rate limiting

## Next (High Priority)

- [ ] **Merge conflicts: structured API response**
  Return a clear `409` payload (conflicting files, conflict type, suggested actions) instead of a generic merge failure.

- [ ] **Add fetch action in UI**
  Wire `POST /api/projects/:id/fetch` in frontend and expose it in project/workspace controls.

- [ ] **Add merge action in UI**
  Expose merge from workspace view with proper success/failure UX and post-merge navigation.

- [ ] **Terminal continuity across navigation**
  Preserve terminal output when switching pages/workspaces (or provide explicit replay behavior).

- [ ] **Global error boundaries**
  Add React error boundaries so a single component crash does not blank the entire app.

- [ ] **User-facing notifications**
  Add toasts for create/delete/fetch/merge/session actions and backend errors.

- [ ] **Startup reconciliation sweep**
  On backend boot, scan all projects and reset orphaned `busy` workspaces to `idle` when no active process exists.

- [ ] **Graceful shutdown for active sessions**
  On SIGTERM/SIGINT, stop active sessions cleanly and persist final workspace/session state.

## Product / UX

- [ ] Home/dashboard view at `/projects` (projects, active workspaces, recent sessions)
- [ ] Light/dark mode toggle (currently dark-by-default)
- [ ] Mobile-friendly sidebar behavior (collapse/drawer)
- [ ] Workspace rename/alias support
- [ ] Better empty states and loading feedback on all async paths

## Infra / Ops

- [ ] Add `.env.example` documenting all env vars
- [ ] Add production reverse proxy config (Caddy or Nginx)
- [ ] Add process manager config (systemd or pm2)
- [ ] Add data retention policy (session/log cleanup + optional rotation)
- [ ] Add system status endpoint (disk usage, project/workspace counts)

## Security / Hardening

- [ ] Optional per-user auth model (current token is shared/global)
- [ ] Session/terminal access audit trail (who connected, when)
- [ ] Optional sandbox policy for agent execution beyond CLI permissions

## Later Ideas

- [ ] Cost/token tracking per session/workspace/project
- [ ] Notifications/webhooks on session completion
- [ ] Agent chaining/presets/templates
- [ ] Workspace snapshots and restore points
- [ ] Git graph / branch visualization
- [ ] Optional PR creation workflow after merge

## Obsolete / Replaced Items

- [x] "Merge fix branch into main" — obsolete housekeeping item
- [x] "AgentHistory View placeholder" — replaced by session selector + persisted message history
- [x] "Diff viewer untested end-to-end" — now covered by dedicated frontend tests and backend route tests
- [x] "Interactive mode via stdin to Claude process" — replaced by current conversation WS architecture + dedicated terminal WS

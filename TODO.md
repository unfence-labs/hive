# Hive — TODO

_Last cleanup: February 16, 2026._

This list only contains open items. Completed and obsolete items were removed.

## P0 (Product + Reliability)

- [ ] **Structured merge conflict response**
  Return `409` with a typed payload (`conflictingFiles`, conflict kind, suggested next actions) from `POST /api/workspaces/:wsId/merge`.

- [ ] **Expose fetch in frontend**
  Add UI controls for `POST /api/projects/:id/fetch` with clear success/failure feedback.

- [ ] **Expose merge in frontend**
  Add UI flow for `POST /api/workspaces/:wsId/merge` with post-merge navigation and error handling.

- [ ] **Startup reconciliation sweep**
  On backend boot, scan persisted workspaces and reset orphaned `busy` states to `idle` when no process/session is active.

- [ ] **Graceful shutdown**
  On `SIGTERM` / `SIGINT`, stop active sessions cleanly and persist final workspace/session state before exit.

## P1 (UX)

- [ ] **Global error boundary**
  Add a top-level React error boundary so one crashing subtree does not blank the app.

- [ ] **User-facing notifications**
  Add toasts for create/delete/fetch/merge/archive/session actions and API errors.

- [ ] **Real `/projects` dashboard**
  Replace the current placeholder with project/workspace/session overview.

- [ ] **Mobile sidebar behavior**
  Add collapse/drawer behavior for smaller viewports.

- [ ] **Theme mode toggle**
  Provide explicit light/dark switching in settings.

- [ ] **Workspace rename/alias**
  Allow naming/renaming workspaces independently from generated city name.

## P2 (Infra + Platform)

- [ ] Add `.env.example` for backend/frontend env vars.
- [ ] Add deployment references (reverse proxy + process manager examples).
- [ ] Add retention/cleanup policy for old sessions/logs/archives.
- [ ] Add system status endpoint (disk usage, project/workspace/session counts).

## P3 (Security + Extensibility)

- [ ] Add optional per-user auth model (current token is global/shared).
- [ ] Add session/terminal access audit trail.
- [ ] Add optional execution sandbox policy beyond CLI permission flags.
- [ ] Add plugin command scanning in completions (`~/.claude/plugins/installed_plugins.json`).

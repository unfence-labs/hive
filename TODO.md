# Hive — TODO

_Last cleanup: March 1, 2026._

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
  On `SIGTERM` / `SIGINT`, stop active sessions and running scripts cleanly, persist final workspace/session state before exit.

## P1 (UX)

- [ ] **Global error boundary**
  Add a top-level React error boundary so one crashing subtree does not blank the app.

- [ ] **Toast notifications**
  Add toasts for create/delete/fetch/merge/archive/session actions and API errors.

- [ ] **Theme mode toggle**
  Provide explicit light/dark switching in settings (AppearanceSettings currently only has accent color).

- [ ] **Workspace rename/alias**
  Allow manual naming/renaming of workspaces. Auto-naming via `naming.ts` exists but there is no UI to override it.

- [ ] **Codex session resume verification**
  Verify that Codex thread IDs are correctly persisted and resumed across session reloads. Currently best-effort.

- [ ] **Distinguish redacted thinking in UI**
  `redacted_thinking` blocks are logged as `[redacted]` but rendered identically to regular thinking. Add visual distinction.

- [ ] **iOS file viewer/diff viewer**
  Currently tool output is shown as raw text. Add proper file viewing and inline diff support.

- [ ] **iOS automations & prompt templates UI**
  Swift model types exist but there is no UI for managing automations or prompt templates on iOS.

- [ ] **Live WS streaming for automation runs**
  Frontend currently uses REST polling only. Add `sync_automations` hub subscription for real-time run output.

## P2 (Infra + Platform)

- [ ] Add `.env.example` for backend/frontend env vars.
- [ ] Add retention/cleanup policy for old sessions/logs/archives.
- [ ] Add system status endpoint (disk usage, project/workspace/session counts).
- [ ] Gemini provider hardening — less battle-tested than Claude/Codex, stream adapter edge cases may surface.

## P3 (Security + Extensibility)

- [ ] Add optional per-user auth model (current token is global/shared).
- [ ] Add session access audit trail.
- [ ] Add optional execution sandbox policy beyond CLI permission flags.
- [ ] Add plugin command scanning in completions (`~/.claude/plugins/installed_plugins.json`).

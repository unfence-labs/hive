# Hive Agent Instructions

This file is for coding agents. Keep it short and operational.

For the product overview, read `README.md`. Architecture notes and the API surface live in `docs/architecture.md`, environment variables in `docs/configuration.md`, and setup in `docs/getting-started.md`. Do not duplicate that material here. `CLAUDE.md` intentionally points at this file.

## Commands

- Root: `npm install`, `npm run lint`, `npm run typecheck`, `npm run test` (covers backend + frontend; never iOS).
- Each package (`backend/`, `frontend/`) has its own `dev`, `build`, `lint`, `typecheck`, `test` scripts; frontend adds `npm run tauri dev` / `npm run tauri build`.
- iOS: `cd ios && swift test` — run for Swift changes when the toolchain is available.

## Tech Stack

Fastify backend (`backend/`), React 19 + Vite web UI with Tauri v2 desktop shell (`frontend/`), SwiftUI iOS client (`ios/`) sharing the same REST and hub protocols, shared TypeScript helpers (`shared/`).

Core model: Project -> Workspace -> Session. Projects are bare repositories; workspaces are git worktrees and branches; sessions are persisted agent conversations. The Brain uses the synthetic workspace id `brain` for shared session and hub plumbing.

## Coding Rules

- Use English for code, comments, UI copy, docs, variables, and commit text.
- Do not add abstractions unless they remove real duplication or match an existing local pattern.
- Use `rg` / `rg --files` for repository searches.
- Do not commit unless explicitly asked.
- Do not revert unrelated user changes in a dirty worktree.
- Keep docs factual and current. Do not document unfinished work.

## Architecture Guardrails

- V1 client traffic assumes an operator-managed encrypted private network; never document direct public HTTP as supported.
- Provisioning resumes only an exact incomplete install identity and rejects completed installs.
- `ServerConnection.setupPending` gates the ordinary app until Accounts setup finishes.
- Use `git(args, cwd)` from `backend/src/utils/git.ts`; do not execute raw shell git strings in backend code.
- Validate repository URLs with `validateRepositoryUrl()` before cloning.
- Keep WebSocket protocol types aligned across `backend/src/types.ts`, `frontend/src/types.ts`, and `ios/HiveMobile/Models/WebSocketTypes.swift`.
- When adding a WS event, update backend dispatch, frontend reducers/cache invalidation, iOS stores, and tests.
- Conversation history is REST-owned unconditionally for web and iOS. Keep session message endpoints, frontend React Query history, iOS per-session history cache, and WS live bootstrap (`status`, `stream_snapshot`) aligned. The backend never sends a WS `history` frame; keep the `history` event only as a legacy inbound clients tolerate.
- When adding a provider, implement `AgentProvider`, register it in `providers/registry.ts`, expose capabilities, and add a stream adapter when the CLI format differs from Claude.
- Keep provider capability fields synchronized across backend, frontend, and iOS models.
- Automation actions reference Team agents by `agentId`; keep model, thinking level, system prompt, git-context injection, and read-only settings on the agent definition, not on each automation.
- Prompt templates are run/user prompts only. System prompts live in the base/Brain prompts or Team agent definitions. The issue draft prompt (`prompts/issue-draft.md`) is a composer pre-fill for issue-sourced workspaces, not a system prompt.
- Keep prompt variables synchronized between the backend interpolators (`backend/src/agents/system-prompt.ts`, `backend/src/agents/issue-draft-prompt.ts`) and `frontend/src/lib/prompt-variables.ts`.
- Keep notification event variants synchronized between `backend/src/notifications/types.ts` and notification channels.
- Keep backend routes testable by preserving optional `dataDir` injection where existing modules use it.
- Keep file access behind the shared path-safety helpers in `backend/src/utils/repo-files.ts`.
- Tauri in-app drag and drop depends on `dragDropEnabled: false` in `frontend/src-tauri/tauri.conf.json`.

## Testing Expectations

- For backend or frontend changes, run the relevant package `lint`, `typecheck`, and targeted tests. For cross-cutting TypeScript changes, run the root checks.
- For iOS changes, run `cd ios && swift test` and mention if Swift/Xcode is unavailable.
- Backend tests live next to source under `backend/src/**/*.test.ts`; frontend tests under `frontend/tests/**`; iOS tests under `ios/Tests/**`.
- WS tests should use Fastify `injectWS()` patterns already present in the suite.

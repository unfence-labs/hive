# Architecture

Hive is a TypeScript monorepo with a native iOS client.

```
backend/    Fastify REST API, WebSocket hub, provider runners, git/worktree management,
            Brain, automation scheduler, notifications, file-backed state
frontend/   React 19 + Vite web UI and Tauri v2 desktop shell
ios/        SwiftUI client sharing the same REST and hub protocols
shared/     TypeScript helpers shared by backend and frontend
```

**Core model:** `Project → Workspace → Session`

- **Project** — a bare git repository.
- **Workspace** — a git worktree and branch under a project.
- **Session** — a persisted, resumable agent conversation.
- **Brain** — a singleton normal git clone addressed through the synthetic workspace id `brain`.

## Data layout (`$DATA_DIR`)

```text
$DATA_DIR/
|-- config.json
|-- ui-preferences.json
|-- automations.json
|-- agents.json
|-- prompts/
|   |-- base.md
|   |-- brain.md
|   |-- issue-draft.md
|   `-- <template-id>.md
|-- brain/
|   |-- state.json
|   |-- repo/
|   `-- sessions/
|-- automations/
|   `-- <automation-id>/
|       |-- runs/
|       |   `-- <run-id>/
|       |       |-- messages.jsonl
|       |       `-- system-prompt.md
|       `-- workspace/
`-- proj-<id>/
    |-- state.json
    |-- env/
    |   `-- .env
    |-- repo.git/
    |-- workspaces/
    |   `-- <workspace-name>/
    |-- sessions/
    |   `-- <session-id>/
    |       |-- metadata.json
    |       |-- messages.jsonl
    |       `-- attachments/
    |-- archive/
    `-- logs/
```

## HTTP API

Public backend surface exposed by route modules under `backend/src/api/`.

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Projects | `GET/POST /api/projects`, `GET/DELETE /api/projects/:id`, `POST /api/projects/:id/fetch`, `GET /api/projects/:id/favicon`, `GET/PUT /api/projects/:id/env` |
| Workspaces | `GET/POST /api/projects/:id/workspaces` (POST accepts an optional `source`: branch, PR, or issue), `GET /api/projects/:id/branches`, `GET /api/projects/:id/pulls`, `GET /api/projects/:id/issues`, `GET/DELETE /api/workspaces/:wsId`, `GET /api/workspaces/:wsId/files`, `GET /api/workspaces/:wsId/file`, `GET /api/workspaces/:wsId/file/raw`, `GET /api/workspaces/:wsId/file-completions`, `GET /api/workspaces/:wsId/diff`, `GET /api/workspaces/:wsId/diff/stat`, `POST /api/workspaces/:wsId/merge`, `POST /api/workspaces/:wsId/archive` |
| Sessions | `GET/POST/DELETE /api/workspaces/:wsId/session`, `GET /api/workspaces/:wsId/session/messages`, `GET/POST /api/workspaces/:wsId/sessions`, `POST /api/workspaces/:wsId/sessions/:sessionId/convert-to-terminal`, `DELETE /api/workspaces/:wsId/sessions/:sessionId`, `GET /api/workspaces/:wsId/sessions/:sessionId/messages`, `GET /api/workspaces/:wsId/sessions/:sessionId/attachments/:filename` |
| Brain | `GET/POST/DELETE /api/brain`, `GET /api/brain/files`, `GET/PUT /api/brain/file`, `GET /api/brain/file/raw`, `GET /api/brain/status`, `GET /api/brain/diff`, `POST /api/brain/save` |
| Models & usage | `GET /api/models`, `GET /api/provider-usage` |
| Completions | `GET /api/workspaces/:wsId/completions?provider=claude\|codex` |
| Automations | `GET/POST /api/automations`, `GET/PUT/DELETE /api/automations/:id`, `POST /api/automations/:id/trigger`, `GET /api/automations/:id/runs`, `GET /api/automations/:id/runs/:runId/messages` |
| Team agents | `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` |
| Prompts | `GET/POST /api/prompt-templates`, `PUT/DELETE /api/prompt-templates/:id`, `GET/PUT/DELETE /api/prompts/base`, `GET/PUT/DELETE /api/prompts/brain`, `GET/PUT/DELETE /api/prompts/issue-draft` |
| Settings | `GET/PUT /api/settings/defaults`, `GET/PUT /api/settings/notifications`, `POST /api/settings/notifications/test`, `GET/PUT/DELETE /api/settings/instructions`, `POST /api/settings/instructions/sync`, `GET/POST /api/settings/skills`, `GET/PUT/DELETE /api/settings/skills/:id`, `POST /api/settings/skills/:id/sync`, `POST /api/settings/skills/sync-missing`, `GET/POST /api/settings/subagents`, `GET /api/settings/subagents/:id`, `PUT/DELETE /api/settings/subagents/:id/providers/:provider`, `POST /api/settings/subagents/:id/providers/:provider/counterpart` |
| Account | `GET /api/account/status`, `POST /api/account/disconnect` |
| Tool setup | `GET /api/setup/tools`, `GET /api/setup/status`, `POST /api/setup/tools/:tool/:kind` (`kind` = `install` \| `update`) |
| Tool sign-in | `POST /api/setup/auth/:tool/start` (`tool` = `claude` \| `codex` \| `gh`), `POST /api/setup/auth/:tool/code`, `POST /api/setup/auth/:tool/cancel`, `POST /api/setup/auth/claude/token` |
| Scripts & prefs | `GET /api/workspaces/:wsId/scripts`, `POST /api/workspaces/:wsId/scripts/:type/start`, `POST /api/workspaces/:wsId/scripts/:type/stop`, `POST /api/workspaces/:wsId/terminal/start`, `POST /api/workspaces/:wsId/terminal/stop`, `POST /api/workspaces/:wsId/terminal-tabs/:sessionId/start`, `POST /api/workspaces/:wsId/terminal-tabs/:sessionId/stop`, `GET/PUT /api/ui-preferences` |

`wsId=brain` is valid for session and hub routes through the shared session dispatcher.

## WebSocket API

**Hub** — `ws://<host>/ws/hub`

- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`.
- Clients send hub-level `sync_workspaces` and `ping`; workspace events include `switch_session`, `user_message`, `stop`, `tool_input_response`.
- Finalized history is fetched over REST for every client; the hub bootstrap sends only `status` and live stream snapshots and never a WS `history` frame.
- Server workspace events: `status`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `agent_activity`, `stream_snapshot`, `tool_input_required`, `tool_input_resolved`, `done`, `cancelled`, `error`, `branch_info`, `diff_stats`, `pr_status`, `script_status`, `browser_status`, `plan_mode_changed`, and legacy `history`.

**Script stream** — `ws://<host>/ws/script/:wsId?type=<scriptType>` · binary frames are PTY bytes; JSON control messages are `ready`, `exit`, `error`.

**Terminal stream** — `ws://<host>/ws/terminal/:wsId?sessionId=<sessionId>` · same PTY protocol, keyed by terminal-tab session id.

**Browser stream** — `ws://<host>/ws/browser/:wsId/:sessionId` · proxies `agent-browser` screencast output and viewport resize messages.

## Testing & CI

- Backend/frontend tests use **Vitest**; iOS uses **Swift Testing**.
- Tests live next to source: `backend/src/**/*.test.ts`, `frontend/tests/**`, `ios/Tests/**`.
- CI runs Node lint, typecheck, build, and tests on pushes and pull requests to `main`. The iOS CI
  job is currently disabled.
- Provisioning has two lanes. `test/provision/contract.sh` (`npm run test:provision`, in CI) asserts the shell and TypeScript error taxonomies stay in sync, that the deliberate departures from the reference install flow stay departed, that the token never reaches a log file, and that shellcheck is clean. `test/provision/e2e-docker.sh` (`npm run test:provision:e2e`) is the Docker lane: it builds a real backend tarball, provisions a bare Ubuntu 24.04 systemd container from it, and proves the backend comes up healthy, rejects a request with no token, and accepts one with the right token. Its `neighbour` mode installs onto a server already running a web server on port 80 and a service on 5432 and proves an outside peer can still reach them afterwards — first with `ufw` installed but inactive, then with `ufw` active under the operator's own policy, where exactly one rule is added and the default policy is untouched. `preflight` compares a filesystem and service-table snapshot before and after, `paths` drives a non-default install and data directory end to end, and `uninstall` proves the generated script removes the install, keeps the data, and removes that too under `--purge`. All modes run on demand via `.github/workflows/provision-e2e.yml`.
- Pushing a `v<version>` tag runs `.github/workflows/release.yml`, which builds the backend tarball on native linux-x64 and linux-arm64 runners and attaches `hive-backend-<version>-linux-<arch>.tar.gz` plus its `.sha256`, and the generated `provision.sh`, to the GitHub release. The tag must match the version in `frontend/src-tauri/Cargo.toml`.

Run the narrowest relevant checks during development, then the root checks before considering broad
changes done. For iOS changes, also run `cd ios && swift test`.

## Release scripts

```bash
# Build the backend release tarball for the host architecture into dist-release/.
# Requires a Linux host on Node 22 (native modules are compiled during the build).
npm run release:backend -- 0.0.0-dev

# Bundle scripts/provision/{lib,steps,main}.sh into scripts/provision/dist/provision.sh.
npm run release:provision -- 0.0.0-dev

# Provisioning checks: contracts run anywhere in a second; the end-to-end lane
# needs Docker and builds a real release tarball.
npm run test:provision
npm run test:provision:e2e            # install | guards | checksum | rollback | chaos
npm run test:provision:e2e neighbour  # install beside a live service and prove it survives
npm run test:provision:e2e preflight  # prove preflight changes nothing
npm run test:provision:e2e paths      # non-default install and data directories
npm run test:provision:e2e uninstall  # uninstall, and --purge
```

Per-package commands (`backend`, `frontend`, `ios`) are documented in **[AGENTS.md](../AGENTS.md)**.

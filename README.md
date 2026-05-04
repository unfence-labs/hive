# Hive

Hive is an orchestrator for running multiple AI agent conversations (Claude, Codex, Gemini) in parallel across isolated Git workspaces. It can run locally or as a remote backend with a Tauri desktop client connected over Tailscale.

It manages:
- projects as bare repositories,
- workspaces as Git worktrees/branches,
- sessions as persistent agent conversations with WebSocket streaming.

## Current Capabilities

**Core**
- Project import (`git clone --bare`) with repository URL validation and remote fetch.
- Workspace lifecycle (create, list, delete, archive, merge) with auto-naming via dedicated Claude subprocess.
- Multi-session support per workspace (create, list, activate, delete, switch, replay history; max 4 sessions).
- Conversation WebSocket with session focus, history replay, buffered event replay, and per-session streaming status.
- Interactive Claude tool loop for `AskUserQuestion` and `ExitPlanMode` with plan proposal cards, floating action bar, and hand-off to new session.
- Image attachments resized via sharp (max 1568px, JPEG q80) and persisted per session.
- SSH terminal access via external terminal apps (replaces previous in-app terminal).
- Interactive terminal tab (PTY shell) in workspace panel, no `hive.json` config needed.
- File tree + file content viewer with Shiki syntax highlighting.
- Inline diff viewer (`@pierre/diffs/react`) with split/unified modes, line selection, diff comments, and paste-to-prompt.
- Context window usage ring (green/yellow/red thresholds) in chat input footer.
- Sub-agent tracking: Task tool calls rendered as collapsible nodes with nested child tools, background agents tracked in status bar.
- Task tracker: collapsible bar showing task progress from Claude task tools and Codex native todo lists.
- Unread badges per-session in sidebar and session tabs.
- Message queue: type and submit one follow-up while the agent is streaming.
- `#file` mention autocomplete with fuzzy matching in chat input.
- Commit & Push quick-action button in chat input.

**Multi-provider support**
- Provider abstraction layer: `AgentProvider` interface with CLI arg building, env config, and stream adapters.
- Claude provider (streaming JSON), Codex provider (JSONL with stream adapter), Gemini provider (NDJSON with tool name mapping).
- Codex stream normalization for native todo lists, file-change summaries, cached token usage, and non-fatal diagnostic events.
- Model catalog API (`GET /api/models`) for frontend/iOS model discovery, grouped by provider.
- Model selector UI with provider icons, default badges, and NEW indicators.
- Provider locked per session after first message — prevents mid-conversation provider switches.
- Provider-aware controls: thinking toggle (Claude) vs thinking level cycling (Codex), plan mode gating, completions gating.
- Agent settings page: per-provider version display with npm update check.

**Live sync**
- Real-time branch name and diff-stat snapshots via background git polling over WebSocket.
- PR status via bulk REST endpoint (`POST /api/workspaces/bulk-pr-status`) seeding per-workspace cache, eliminating duplicate polling.
- Enriched PR display: review state (approved/changes_requested), checks counts (passed/total), mergeable state (13-state priority ladder including draft, closed, blocked, unstable).
- Script execution status broadcasting (`script_status` WS messages).

**Automation**
- Scheduled agent automations with cron expressions (croner), per-project or global.
- Prompt template library: CRUD with YAML frontmatter `.md` files, system/user types, deletion guard when referenced by automation.
- Base prompt editor: customizable system prompt with `{PROJECT}`, `{DIR}`, `{DEFAULT_BRANCH}` template variables (CodeMirror 6 with variable highlighting).
- Prompt flow explainer: interactive diagram showing how system prompt is assembled.
- Automation run log viewer: slide-over sheet with full agent conversation + system prompt banner.
- Automation editing: inline config modification via creation dialog in edit mode.
- Git context injection into automation system prompts for project-linked automations.
- Cron preview (next 3 runs) and next-run countdown in sidebar and detail view.
- Workspace setup/run scripts via `hive.json` with PTY execution and live terminal output.
- Slash-command / agent autocomplete scanning from user and project `.claude` directories.

**Integrations**
- GitHub OAuth device flow for `gh` CLI authentication and git credential setup.
- Telegram notifications: turn complete (with duration + summary), needs input, proposed plan, agent failed, automation run complete.
- Apple Push Notifications (APNs): zero-dependency HTTP/2 + ES256 JWT channel with auto token pruning. Suppressed in foreground.
- Preflight dependency checks on startup (git, claude, gh required; codex, gemini optional).

**Settings**
- Tailscale connection config (IP + port) with health check indicator.
- Appearance settings (accent color picker).
- Account settings (GitHub connect/disconnect with profile display).
- Notification settings (Telegram + APNs, instant-apply toggles, test message).
- Agent settings (installed providers, versions, update availability).
- Prompt settings (base prompt editor, template library, prompt flow explainer).
- Per-repository detail view with deletion controls.

**Desktop**
- Tauri v2 desktop app (macOS `.dmg`, Windows `.exe`) with native titlebar integration.
- macOS traffic light positioning, drag regions, and App Transport Security exceptions for Tailscale HTTP.
- Sidebar collapse toggle (Cmd/Ctrl+B) with CSS transition and fullscreen detection.
- VS Code remote SSH workspace opening via `vscode://vscode-remote/ssh-remote+` URIs.
- Workspace header action for copying the current worktree path.

**iOS**
- Native SwiftUI app with chat, model selection, session switching (max 4), and push notifications (APNs).
- Dynamic model catalog from API with provider-grouped picker and session locking.
- PR status bulk polling with enriched display matching the web frontend.
- Push notifications with foreground suppression and cold-start bridging via `CompletedWorkspacesStore`.
- Foreground reconnect (2s debounce) with background stream catchup.
- Context window usage ring matching frontend thresholds.
- Task tracker with collapsible task list, including Codex native todo lists.
- `#file` and `@agent` mention highlighting in messages.
- Copy-to-clipboard on agent messages.
- Per-session plan mode state and CANCELLED badge for dismissed questions.

**Security**
- Optional auth token + in-memory request rate limiting.
- File content API with path traversal protection and 1 MB size cap.

## Prerequisites

- Node.js >= 20
- Git >= 2.20
- Claude CLI installed and authenticated (`claude` command)
- Optional: GitHub CLI (`gh`) for PR status in the UI
- Optional: Codex CLI (`codex`) for OpenAI model support
- Optional: Gemini CLI (`gemini`) for Google model support
- Optional (desktop app): Rust >= 1.77 for Tauri builds
- Optional (remote setup): Tailscale for secure backend connectivity

## Installation

```bash
git clone <repo-url> hive
cd hive
npm install
```

## Local Development

Run in two terminals.

Terminal 1 (backend):

```bash
cd backend
npm run dev
```

Terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

Defaults:
- Backend: `http://127.0.0.1:3000`
- Frontend: `http://localhost:5173`

### Tauri Desktop App

The frontend can be run as a native desktop app using Tauri:

```bash
cd frontend
npm run tauri dev
```

To build a distributable `.dmg` / `.exe`:

```bash
cd frontend
npm run tauri build
```

See [GETTING_STARTED.md](GETTING_STARTED.md) for remote backend setup with Tailscale.

### Production Deployment (pm2)

The backend includes a pm2 ecosystem config at `backend/ecosystem.config.cjs` with two environments:

| Environment | Host | Port | Data Dir |
|---|---|---|---|
| `production` | `0.0.0.0` | `9420` | `~/.hive` |
| `development` | `127.0.0.1` | `3000` | `~/.hive-dev` |

```bash
cd backend
npm run build

# Start
pm2 start ecosystem.config.cjs --env production
pm2 start ecosystem.config.cjs --env development

# Manage
pm2 logs hive-backend        # stream logs
pm2 restart hive-backend     # restart
pm2 stop hive-backend        # stop
pm2 delete hive-backend      # remove from pm2

# Persist across reboots
pm2 save
pm2 startup
```

## Scripts

From repo root:

```bash
npm run lint
npm run typecheck
npm run test
```

Per package:

```bash
cd backend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test

cd ../frontend
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

## Environment Variables

### Backend

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for prompts/projects/workspaces/sessions |
| `HIVE_AUTH_TOKEN` | _(unset)_ | If set, requires auth for API + WS (`/health` stays public) |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP within one window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `GITHUB_CLIENT_ID` | _(built-in)_ | Override GitHub OAuth App client ID |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | _(derived from browser location)_ | Override WS base URL |
| `VITE_HIVE_AUTH_TOKEN` | _(unset)_ | Bearer token for API and `token` query for WS |

## HTTP API

### Projects

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | Create project (clone bare repo) |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:id` | Get project |
| `DELETE` | `/api/projects/:id` | Delete project (must have zero active workspaces) |
| `POST` | `/api/projects/:id/fetch` | Fetch remote updates |

### Workspaces

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/:id/workspaces` | Create workspace |
| `GET` | `/api/projects/:id/workspaces` | List project workspaces |
| `GET` | `/api/workspaces/:wsId` | Get workspace details + default branch |
| `DELETE` | `/api/workspaces/:wsId` | Delete workspace |
| `GET` | `/api/workspaces/:wsId/diff?scope=combined\|committed\|uncommitted` | Unified diff; defaults to combined committed + uncommitted + untracked |
| `GET` | `/api/workspaces/:wsId/diff/stat` | Diff stats (`committed` + `uncommitted`) |
| `GET` | `/api/workspaces/:wsId/files` | Workspace file tree |
| `GET` | `/api/workspaces/:wsId/file?path=<file>` | Read workspace file content |
| `GET` | `/api/workspaces/:wsId/file-completions` | File paths for `#` mention autocomplete |
| `POST` | `/api/workspaces/:wsId/merge` | Merge workspace branch into default branch |
| `POST` | `/api/workspaces/:wsId/archive` | Archive workspace and remove worktree |
| `GET` | `/api/workspaces/:wsId/completions` | Completion items for `/` and `@` autocomplete |
| `GET` | `/api/workspaces/:wsId/pr-status` | PR status (state, checks, reviews, mergeable) with 15s cache |
| `POST` | `/api/workspaces/bulk-pr-status` | Bulk PR status for multiple workspaces |
| `POST` | `/api/workspaces/:wsId/terminal/start` | Start interactive terminal PTY |
| `DELETE` | `/api/workspaces/:wsId/terminal/stop` | Stop interactive terminal |

### Models

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/models` | Model catalog (providers, capabilities, contextWindow, defaults) |

### Sessions

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workspaces/:wsId/session` | Get or create active session |
| `GET` | `/api/workspaces/:wsId/session` | Get active session metadata |
| `GET` | `/api/workspaces/:wsId/session/messages` | Get latest persisted messages |
| `DELETE` | `/api/workspaces/:wsId/session` | End active session |
| `GET` | `/api/workspaces/:wsId/sessions` | List all workspace sessions |
| `POST` | `/api/workspaces/:wsId/sessions` | Create new session |
| `POST` | `/api/workspaces/:wsId/sessions/:sessionId/activate` | Activate specific session |
| `DELETE` | `/api/workspaces/:wsId/sessions/:sessionId` | Hard-delete a session |
| `GET` | `/api/workspaces/:wsId/sessions/:sessionId/messages` | Get messages for a specific session |

### Automations

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/automations` | List automations |
| `POST` | `/api/automations` | Create automation |
| `GET` | `/api/automations/:id` | Get automation |
| `PUT` | `/api/automations/:id` | Update automation |
| `DELETE` | `/api/automations/:id` | Delete automation |
| `POST` | `/api/automations/:id/trigger` | Manually trigger automation |
| `GET` | `/api/automations/:id/runs` | List automation runs |
| `GET` | `/api/automations/:id/runs/:runId/messages` | Get run messages + system prompt |

### Prompt Templates

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/prompts/templates` | List templates |
| `POST` | `/api/prompts/templates` | Create template |
| `GET` | `/api/prompts/templates/:id` | Get template |
| `PUT` | `/api/prompts/templates/:id` | Update template |
| `DELETE` | `/api/prompts/templates/:id` | Delete template (blocked if referenced by automation) |

### Base Prompt

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/prompts/base` | Get base prompt (content, isDefault, defaultContent) |
| `PUT` | `/api/prompts/base` | Update base prompt |
| `DELETE` | `/api/prompts/base` | Reset base prompt to default |

### Settings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/notifications` | Get notification config (Telegram + APNs) |
| `PUT` | `/api/settings/notifications` | Update notification config |
| `POST` | `/api/settings/notifications/test` | Send a test notification |
| `POST` | `/api/settings/apns-token` | Register APNs device token |
| `GET` | `/api/settings/agents` | Provider versions + update availability |

### Account

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/account/status` | GitHub CLI install + auth status + user profile |
| `POST` | `/api/account/connect` | Start GitHub OAuth device flow |
| `POST` | `/api/account/connect/poll` | Poll for device flow completion |
| `POST` | `/api/account/disconnect` | Logout from GitHub CLI |

### Scripts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/workspaces/:wsId/scripts` | Get `hive.json` config + script statuses |
| `POST` | `/api/workspaces/:wsId/scripts/:type/start` | Start setup or run script |
| `POST` | `/api/workspaces/:wsId/scripts/:type/stop` | Stop a running script |

## WebSocket API

### Hub (multiplexed)

- Endpoint: `ws://<host>/ws/hub`
- Auth: `Authorization: Bearer <token>`, `x-hive-token`, or `?token=<token>`

Client -> server:
- `{ "type": "sync_workspaces", "workspaceIds": ["..."] }`
- `{ "type": "user_message", "content": "...", "images": [...], "options": { "planMode": boolean, "thinkingEnabled": boolean, "thinkingLevel": "low"|"medium"|"high"|"xhigh", "modelId": "provider:model" }, "sessionId": "...", "workspaceId": "..." }`
- `{ "type": "stop", "sessionId": "...", "workspaceId": "..." }`
- `{ "type": "tool_input_response", "requestId": "...", "toolName": "AskUserQuestion|ExitPlanMode", "result": ..., "sessionId": "...", "workspaceId": "..." }`

Server -> client (wrapped in `HubOutgoing` envelopes `{ workspaceId, event }`):
- `status` (includes `lockedProvider`), `history`, `user_message`, `text_delta`, `thinking`, `tool_use`, `tool_result`, `tool_input_required`, `done` (with `durationMs`, `pendingToolName`), `cancelled` (with `errorDetail`, `userInitiated`), `error`, `branch_info`, `diff_stats`, `script_status`, `plan_mode_changed`

### Script stream

- Endpoint: `ws://<host>/ws/script/:wsId/:type`
- Binary frames: PTY output bytes from the running script
- Server control messages: `ready`, `exit`, `error`

## Architecture

Hierarchy:
- **Project**: bare Git repo
- **Workspace**: worktree + branch (`workspace/<city-name>`)
- **Session**: agent conversation persisted under the project

Backend key modules:
- `backend/src/api/projects.ts` project CRUD + fetch
- `backend/src/api/workspaces.ts` workspace CRUD + diff/stat + files + merge + archive + PR status + file-completions + terminal
- `backend/src/api/agents.ts` session routes (single + multi-session)
- `backend/src/api/completions.ts` completion scanning endpoint
- `backend/src/api/models.ts` model catalog endpoint
- `backend/src/api/settings.ts` notification config CRUD + APNs token registration
- `backend/src/api/account.ts` GitHub OAuth device flow + CLI integration
- `backend/src/api/scripts.ts` setup/run script lifecycle
- `backend/src/api/agents-settings.ts` provider version check + npm update detection
- `backend/src/api/base-prompt.ts` base system prompt CRUD
- `backend/src/api/automations.ts` automation CRUD + trigger + run history + run messages
- `backend/src/api/prompt-templates.ts` prompt template CRUD
- `backend/src/ws/stream.ts` multiplexed hub WebSocket protocol
- `backend/src/ws/script.ts` script execution WebSocket
- `backend/src/agents/agent-manager.ts` in-memory session registry, persistence, switching
- `backend/src/agents/conversation-session.ts` agent process lifecycle per turn (provider-aware)
- `backend/src/agents/system-prompt.ts` system prompt construction (base prompt loading, template vars, git context)
- `backend/src/agents/naming.ts` branch + session auto-naming via dedicated Claude subprocess
- `backend/src/agents/providers/` provider abstraction (types, registry, claude, codex, codex-stream-adapter, gemini, gemini-stream-adapter)
- `backend/src/services/git-sync.ts` branch/diff polling and workspace broadcasts
- `backend/src/services/script-runner.ts` PTY-based script execution + interactive terminal
- `backend/src/services/automation-scheduler.ts` cron scheduling, ConversationSession execution, git context injection
- `backend/src/notifications/` notification channels (Telegram, APNs) + event dispatcher + types
- `backend/src/state/state.ts` JSON persistence + per-project locks
- `backend/src/state/config.ts` file-based app config (`config.json`)
- `backend/src/state/automations.ts` automation + run persistence
- `backend/src/state/prompt-templates.ts` template persistence
- `backend/src/state/base-prompt.ts` base prompt persistence
- `backend/src/utils/preflight.ts` startup dependency checks (git, claude, gh; codex/gemini optional)
- `backend/src/utils/github.ts` GitHub URL parsing, `gh` CLI wrapper, PR status fetching
- `backend/src/utils/hive-config.ts` `hive.json` parser for workspace scripts

Frontend key modules:
- `frontend/src/pages/WorkspaceView.tsx` main chat/inline diff/file tree/scripts/PR status UI
- `frontend/src/pages/AutomationDetail.tsx` automation config + run history + run log
- `frontend/src/pages/settings/` settings pages (Appearance, Connection, Account, Notifications, Agents, Prompts, ProjectDetail)
- `frontend/src/contexts/WorkspaceLiveDataContext.tsx` WS live data context + unread tracking
- `frontend/src/hooks/useConversation.ts` reducer-driven conversation state + tool responses + lockedProvider
- `frontend/src/hooks/useSessions.ts` multi-session operations (max 4)
- `frontend/src/hooks/useWorkspaceLiveData.ts` live status/branch/diff/script data + unread tracking
- `frontend/src/hooks/useModels.ts` model catalog fetch + selection + provider lock
- `frontend/src/hooks/usePrStatus.ts` PR status (reads from bulk-seeded cache, no independent timer)
- `frontend/src/hooks/useTabs.ts` multi-tab state with workspace snapshot cache, source/diff modes
- `frontend/src/hooks/useTasks.ts` task progress from TaskCreate/TaskUpdate tool calls and Codex TodoList events
- `frontend/src/hooks/useBackgroundAgents.ts` background Task agent tracking
- `frontend/src/hooks/useContextUsage.ts` context window usage calculation
- `frontend/src/hooks/useBasePrompt.ts` base prompt CRUD
- `frontend/src/hooks/useDiff.ts` diff fetching for inline viewer
- `frontend/src/hooks/useFileCompletions.ts` `#` file mention completions
- `frontend/src/hooks/useSidebarCollapsed.ts` sidebar collapse state + keyboard shortcut
- `frontend/src/hooks/useWsCacheInvalidation.ts` centralized WS-driven query invalidation
- `frontend/src/hooks/useProjects.ts` project/workspace state
- `frontend/src/hooks/useScripts.ts` script start/stop/status + terminal
- `frontend/src/hooks/useAutomations.ts` automation CRUD + trigger + run history + run messages
- `frontend/src/hooks/usePromptTemplates.ts` prompt template CRUD
- `frontend/src/lib/ws-transport.ts` resilient WS transport + replay buffer
- `frontend/src/lib/plan-state.ts` plan mode logic (detection, content extraction)
- `frontend/src/lib/sub-agent.ts` Task tool parsing + children map
- `frontend/src/lib/pr-display.ts` PR state -> icon/color/label mapping
- `frontend/src/lib/cron.ts` cron utilities (next runs, countdown formatting)
- `frontend/src/lib/format-usage.ts` token count formatting + usage colors
- `frontend/src/lib/file-mentions.ts` `#file`/`@agent` mention parsing
- `frontend/src/lib/fuzzy-match.ts` fuzzy file matching for autocomplete
- `frontend/src/components/Sidebar.tsx` project/workspace nav + build/automation tabs + collapse + unread + PR status
- `frontend/src/components/ChatInput.tsx` message input + file autocomplete + context ring + quick actions
- `frontend/src/components/TaskTracker.tsx` task list + background agents status bar
- `frontend/src/components/diff/InlineDiffViewer.tsx` inline diff with split/unified + comments + paste-to-prompt
- `frontend/src/components/chat/SubAgentNode.tsx` collapsible Task tool rendering
- `frontend/src/components/chat/PlanActionBar.tsx` plan approval floating bar
- `frontend/src/components/chat/ContextRing.tsx` SVG usage ring
- `frontend/src/components/chat/ModelSelector.tsx` provider-grouped model picker
- `frontend/src/components/PromptEditor.tsx` CodeMirror 6 editor with template variable highlighting
- `frontend/src-tauri/` Tauri v2 desktop app (Rust shell, config, icons)

## Data Layout

```text
$DATA_DIR/
├── config.json
├── automations.json
├── prompts/
│   ├── base.md
│   └── <template-id>.md
├── automations/
│   └── <auto-id>/
│       ├── runs/
│       │   └── <run-id>/
│       │       ├── messages.jsonl
│       │       └── system-prompt.md
│       └── workspace/
└── proj-<id>/
    ├── state.json
    ├── repo.git/
    ├── workspaces/
    │   └── <workspace-name>/
    ├── sessions/
    │   └── <session-id>/
    │       ├── metadata.json
    │       ├── messages.jsonl
    │       └── attachments/
    ├── archive/
    │   └── <ws-id>/
    │       ├── workspace.json
    │       └── sessions/
    └── logs/
```

## Testing and CI

- Backend tests: `backend/src/**/*.test.ts`
- Frontend tests: `frontend/tests/**/*.test.ts(x)`
- Framework: Vitest
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, and tests on push/PR to `main`
- CI sets `NODE_ENV=test` explicitly (React 19 only exports `act()` in development bundle)

## License

Private.

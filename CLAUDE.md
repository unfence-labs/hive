# Hive Developer Notes

This repository is a monorepo:
- `backend/`: Fastify API + WebSocket server
- `frontend/`: React + Vite UI + Tauri desktop app (`frontend/src-tauri/`)
- `ios/`: SwiftUI iOS app

Hive runs AI agent conversations (Claude, Codex) in isolated Git workspaces (worktrees) created from a project's bare repo.

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
- **Session**: persisted agent conversation for one workspace

One session is active per workspace, but multiple sessions can coexist and be switched/loaded from disk.

## Backend Architecture

- `backend/src/index.ts`: app wiring, auth/rate-limit hooks, route registration, git sync + notifier bootstrap, preflight checks
- `backend/src/api/projects.ts`: project CRUD + fetch
- `backend/src/api/workspaces.ts`: workspace CRUD + diff/stat + files/file + merge + archive + PR status endpoint
- `backend/src/api/agents.ts`: session routes (single + multi-session)
- `backend/src/api/completions.ts`: completion scanning endpoint
- `backend/src/api/models.ts`: model catalog endpoint (`GET /api/models`)
- `backend/src/api/settings.ts`: notification config CRUD + test message
- `backend/src/api/account.ts`: GitHub OAuth device flow + `gh` CLI integration
- `backend/src/api/scripts.ts`: workspace setup/run script lifecycle (start/stop/status)
- `backend/src/ws/stream.ts`: multiplexed hub WebSocket protocol (`/ws/hub`; `sync_workspaces` subscription, `HubOutgoing` envelopes)
- `backend/src/ws/script.ts`: script execution WebSocket (PTY output streaming)
- `backend/src/services/git-sync.ts`: branch/diff polling and workspace broadcasts (PR status moved to REST)
- `backend/src/services/script-runner.ts`: PTY-based script execution with status broadcasting
- `backend/src/agents/conversation-session.ts`: agent process lifecycle per turn (provider-aware)
- `backend/src/agents/stream-parser.ts`: NDJSON parser for Claude CLI `--output-format stream-json --verbose`
- `backend/src/agents/agent-manager.ts`: in-memory session registry, persistence, switching, notification dispatch
- `backend/src/agents/naming.ts`: branch + session auto-naming via dedicated Claude subprocess
- `backend/src/agents/providers/types.ts`: `AgentProvider` interface, `ProviderCapabilities`, `ModelDefinition`, `StreamAdapter`
- `backend/src/agents/providers/registry.ts`: CLI detection, model ID resolution (`"claude:opus-4-6"`), model catalog builder
- `backend/src/agents/providers/claude.ts`: Claude provider (CLI args, env, thinking tokens)
- `backend/src/agents/providers/codex.ts`: Codex provider (`codex exec` CLI args, thread resume)
- `backend/src/agents/providers/codex-stream-adapter.ts`: Codex JSONL→StreamParserEvent normalizer
- `backend/src/notifications/notifier.ts`: event dispatcher for notification channels
- `backend/src/notifications/telegram.ts`: Telegram bot API channel
- `backend/src/services/automation-scheduler.ts`: cron-based automation executor (croner, ConversationSession, summary extraction, notifications)
- `backend/src/api/automations.ts`: automation CRUD + manual trigger + run history
- `backend/src/api/prompt-templates.ts`: prompt template CRUD (deletion guard if referenced by automation)
- `backend/src/state/automations.ts`: automation + run persistence (atomic writes, run capping at 50)
- `backend/src/state/prompt-templates.ts`: template persistence
- `backend/src/utils/summary-extractor.ts`: extract `## Summary` section from agent messages
- `backend/src/state/state.ts`: JSON persistence + per-project locks
- `backend/src/state/config.ts`: file-based app config (`$DATA_DIR/config.json`)
- `backend/src/utils/preflight.ts`: startup dependency checks (git >= 2.17, claude, gh; codex optional)
- `backend/src/utils/github.ts`: GitHub URL parsing, `gh` CLI wrapper, PR status fetching (reviews, checks, merge state)
- `backend/src/utils/hive-config.ts`: `hive.json` parser for workspace scripts
- `backend/ecosystem.config.cjs`: pm2 ecosystem config (production + development environments)

### Important backend behavior

- Conversation turns use the provider abstraction: `conversation-session.ts` resolves the provider from compound model IDs (e.g. `"claude:opus-4-6"`, `"codex:o3-pro"`) via `resolveProvider()` and delegates CLI arg building, env config, and stream parsing to the matched provider.
- Claude provider uses `--print --output-format stream-json -p`. Codex provider uses `codex exec --json`.
- Session continuity: Claude uses `--session-id` and `--resume`; Codex uses `--thread-id`.
- Provider is locked per session after the first message (`lockedProvider`). Subsequent messages validate against it. The lock is broadcast via WS status events.
- Pre-multi-model sessions (created before provider support) default to `"claude"` when they have messages but no `lockedProvider`.
- Blocking tools (`AskUserQuestion`, `ExitPlanMode`) are intercepted and surfaced as `tool_input_required`. Only providers with `blockingTools` capability support this.
- Session tool responses are session-scoped; dismiss/approve/reject are routed back to the correct session.
- `getOrCreateSession()` recovers stale `busy` workspaces lazily (on access).
- On first message, a lightweight Claude subprocess generates a branch name and session title (`naming.ts`), then renames the branch via `git branch -m`.
- Workspace merge is executed in a temporary worktree on default branch, then default-branch ref is updated.
- `archiveWorkspace()` removes worktree and moves matching session folders under `archive/<ws-id>/sessions`.
- Git sync pushes cached `branch_info` + `diff_stats` snapshots to new WS clients. PR status is no longer polled here — moved to on-demand `GET /api/workspaces/:wsId/pr-status` with 15s TTL cache.
- WS uses a single multiplexed hub endpoint (`/ws/hub`). Clients send `sync_workspaces` with workspace ID lists to subscribe/unsubscribe. All outgoing messages are wrapped in `HubOutgoing` envelopes (`{ workspaceId, event }`). Bootstrap (status, history, branch_info, diff_stats, script_status) is sent per workspace on subscribe.
- Preflight checks run at startup and exit with clear errors if git/claude/gh are missing. Codex is optional.
- Notification config is persisted in `$DATA_DIR/config.json` and hot-reloaded when settings change (no restart needed).
- Script runner spawns PTY processes for `hive.json` setup/run commands, buffers last 200 lines, and broadcasts status via the workspace WS channel.
- Stream parser silences `rate_limit_event` CLI events (logged server-side with structured rate_limit_info diagnostics, not forwarded to clients).
- Server-side tool blocks (`server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`) are mapped to standard `tool_use`/`tool_result` WS events with display-name normalization (`web_search`→`WebSearch`, `web_fetch`→`WebFetch`, `bash_code_execution`→`Bash`, `text_editor_code_execution`→`Edit`).
- MCP tool blocks (`mcp_tool_use`, `mcp_tool_result`) and `redacted_thinking` are also handled.
- Image attachments are resized via sharp (max 1568px, JPEG q80) and stored as files on disk, served via HTTP (`/api/workspaces/:wsId/sessions/:sessionId/attachments/:filename`).
- PR status endpoint returns enriched data: review state (approved/changes_requested/review_required), checks counts (passed/total), mergeable state (13-state priority ladder), and supports closed/merged/draft PRs via `--state all`.
- Automation scheduler (`AutomationScheduler`) runs as a singleton service alongside `GitSyncService`, instantiated in `main()`.
- Automations execute `ConversationSession` directly (not via agent-manager) to keep automation sessions decoupled from workspace sessions.
- System prompt auto-appends a `## Summary` instruction; summary is extracted from the last assistant message post-run via `extractSummary()`.
- Workspace setup: project-linked automations create a worktree from the project's bare repo, reset to latest default branch on each run; non-project automations use a plain directory.
- No concurrent runs per automation — cron trigger skips if already running.
- Stale "running" runs are marked as failed on server restart.
- Automation data lives at `~/.hive/automations.json` (definitions) and `~/.hive/automations/<autoId>/` (runs, sessions, workspace).
- Prompt templates persist as individual `.md` files in `~/.hive/prompts/` (one file per template, YAML frontmatter + content); deletion is blocked if referenced by an automation.
- Automation notifications use the same `Notifier` + `TelegramChannel` / `ApnsChannel` infrastructure as workspace turn-complete notifications.

## Frontend Architecture

- `frontend/src/App.tsx`: routing and global workspace WS syncing
- `frontend/src/pages/WorkspaceView.tsx`: chat + file tree + scripts + modified files + diff modal + PR status
- `frontend/src/pages/settings/AppearanceSettings.tsx`: accent color picker
- `frontend/src/pages/settings/ConnectionSettings.tsx`: Tailscale IP/port + health check
- `frontend/src/pages/settings/AccountSettings.tsx`: GitHub OAuth device flow + profile display
- `frontend/src/pages/settings/NotificationSettings.tsx`: Telegram enable/disable + test message (wrapper + TelegramForm split for race-free init)
- `frontend/src/pages/settings/ProjectDetail.tsx`: per-repo info + deletion controls
- `frontend/src/hooks/useConversation.ts`: reducer-driven WS conversation state + tool responses + `lockedProvider` tracking
- `frontend/src/hooks/useSessions.ts`: list/create/activate/delete sessions
- `frontend/src/hooks/useWorkspaceLiveData.ts`: live status/branch/diff/script data from WS (PR status removed, now via REST)
- `frontend/src/hooks/useModels.ts`: model catalog fetch, selection, provider-aware locking
- `frontend/src/hooks/usePrStatus.ts`: TanStack Query polling for `GET /api/workspaces/:wsId/pr-status` (15s interval)
- `frontend/src/hooks/useScripts.ts`: script start/stop/status
- `frontend/src/hooks/useConnectionStatus.ts`: backend health check
- `frontend/src/hooks/useTailscaleConfig.ts`: Tailscale connection config
- `frontend/src/hooks/useServerUrl.ts`: configurable backend URL resolution
- `frontend/src/hooks/useAccentColor.ts`: theme accent color persistence
- `frontend/src/hooks/useCompletions.ts`: autocomplete scanning
- `frontend/src/hooks/useChatInputDraftPersistence.ts`: draft persistence (message, images, thinking, planMode, selectedModelId, thinkingLevel)
- `frontend/src/lib/ws-transport.ts`: single multiplexed hub WS transport (`/ws/hub`; `sync_workspaces`, envelope demux, per-workspace caches + replay buffer)
- `frontend/src/hooks/useAutomations.ts`: automation CRUD + trigger + run history hooks (TanStack Query, 15s polling)
- `frontend/src/hooks/usePromptTemplates.ts`: prompt template CRUD hooks
- `frontend/src/pages/AutomationDetail.tsx`: automation config display + run history + enable/disable + manual trigger + delete
- `frontend/src/components/CreateAutomationDialog.tsx`: automation creation form (name, project, schedule, model, prompts, notifications)
- `frontend/src/pages/settings/PromptTemplatesSettings.tsx`: template CRUD settings page (grouped by system/user)
- `frontend/src/components/Sidebar.tsx`: project/workspace nav + archive/delete + activity preview + automation list tab
- `frontend/src/components/ChatInput.tsx`: message input with provider-adaptive controls (thinking toggle/levels, plan mode gating, completions gating)
- `frontend/src/components/ChatConversation.tsx`: conversation display with hydration flash fix (visibility:hidden + double-rAF settle)
- `frontend/src/components/PrStatusSection.tsx`: enriched PR display (13 states: merged, closed, draft, conflicts, blocked, checks, reviews)
- `frontend/src/components/chat/ModelSelector.tsx`: model picker grouped by provider with icons, badges, and provider lock
- `frontend/src/components/chat/PlanProposal.tsx`: plan mode proposal card with accept/handoff/copy
- `frontend/src/lib/terminal.ts`: SSH command builder + terminal app detection (Tauri)
- `frontend/src/lib/open-external.ts`: VS Code remote SSH URI builder + external app launcher
- `frontend/src/hooks/useTerminalApps.ts`: detect available terminal emulators (Tauri)
- `frontend/src-tauri/`: Tauri v2 desktop app (Rust shell, config, icons)

### Important frontend behavior

- The frontend supports a configurable server URL (Settings > Connection) for remote backend connectivity. All API calls (`useApi.ts`) and WebSockets (`ws-transport.ts`) resolve the base URL via `getServerUrl()` from `useServerUrl.ts`.
- The app maintains a single hub WS connection; `wsTransport.syncWorkspaces` sends `sync_workspaces` with the full workspace ID set to the backend.
- `useConversation` hydrates from REST history and resolves stale replay races with request tokens. It also tracks `lockedProvider` from WS status events.
- Session tabs support create/switch/delete with live message replay and per-session streaming indicators.
- Chat input dynamically adapts controls based on the selected provider's capabilities: thinking toggle for Claude, thinking level cycling (Low/Med/High/xHigh) for Codex, plan mode hidden when unsupported, `/` and `@` autocomplete gated by `completions` capability.
- Chat input supports image attachments (paste/drag-drop/picker).
- Plan proposals render as rich markdown cards with accept, hand-off-to-new-session, and copy actions.
- Workspace sidebar shows script panel with live PTY output when `hive.json` defines setup/run commands.
- Connection health is checked via `useConnectionStatus`; the "Add Repository" button is gated until a valid connection is configured.
- File viewer uses Shiki syntax highlighting with github-dark theme and line numbers.
- VS Code remote SSH: workspace can be opened in VS Code via `vscode://vscode-remote/ssh-remote+` URIs (Tauri desktop only).
- Chat conversation hides content during initial REST hydration (visibility:hidden + `resize="instant"`) and reveals after scroll position settles via double-rAF, preventing a visible flash-from-top.
- PR status is fetched via REST polling (`usePrStatus`, 15s interval) instead of WS push. Displays enriched state: review status, check counts, merge conflicts, draft, closed/merged.
- Draft persistence saves `selectedModelId` and `thinkingLevel` alongside message text, images, and toggles.

## iOS App (`ios/`)

- `HiveMobile/HiveApp.swift`: app entry point
- `HiveMobile/Models/Models.swift`: data models (ChatMessage, ToolCall, Workspace, ModelCatalogEntry, etc.)
- `HiveMobile/Models/WebSocketTypes.swift`: WS protocol types (mirrors `backend/src/types.ts`)
- `HiveMobile/Services/APIClient.swift`: REST API client (includes `/api/models` and `/api/workspaces/:wsId/pr-status`)
- `HiveMobile/Services/ImageCache.swift`: image caching
- `HiveMobile/Stores/ConversationStore.swift`: chat state (mirrors `useConversation.ts`) + `lockedProvider` tracking + `send` closure for WS outgoing
- `HiveMobile/Stores/ConversationStoreCache.swift`: app-level cache of ConversationStore instances keyed by workspace ID, survives navigation
- `HiveMobile/Stores/ChatDraftStore.swift`: draft message persistence (includes `selectedModelId`, `thinkingLevel`)
- `HiveMobile/Stores/ProjectStore.swift`: project list state (accepts `ConversationStoreCache` at init)
- `HiveMobile/Stores/ModelCatalog.swift`: dynamic model catalog from API, grouped by provider
- `HiveMobile/Stores/HubStatusMonitor.swift`: single multiplexed hub WS (`/ws/hub`; `sync_workspaces`, `HubOutgoing` envelope demux, routing to ConversationStore) + PR status REST polling (15s) + turn-completed tracking
- `HiveMobile/Views/Chat/ChatView.swift`: conversation UI + provider locking + model selection
- `HiveMobile/Views/Chat/ChatInputBar.swift`: input bar with provider-adaptive controls (thinking toggle vs level picker)
- `HiveMobile/Views/Chat/MessageBubble.swift`: message + tool call rendering
- `HiveMobile/Views/Chat/ToolInputSheet.swift`: AskUserQuestion + ExitPlanMode interactive sheets
- `HiveMobile/Views/Chat/SessionSheet.swift`: session switching
- `HiveMobile/Views/Hub/HubView.swift`: project/workspace navigation
- `HiveMobile/Views/Hub/AddProjectSheet.swift`: new project creation
- `HiveMobile/Views/Hub/WorkspaceCard.swift`: workspace cards with activity preview + enriched PR status display + turn-completed badge
- `HiveMobile/Theme/DesignTokens.swift`: design tokens (WhisperColor, WhisperFont)
### Important iOS behavior

- Connects to the same backend as web/desktop via configurable host/port (Settings).
- Auth token stored in UserDefaults, passed as query param on WS connections.
- **Single multiplexed hub WS**: `HubStatusMonitor.HubConnection` opens one WS to `/ws/hub` for all workspaces. Sends `sync_workspaces` on connect. Incoming `HubOutgoing` envelopes are demuxed by `workspaceId`. Hub-level events (status, diff_stats, branch_info) update monitor properties. ALL events are forwarded to the workspace's `ConversationStore` in the `ConversationStoreCache`.
- **ConversationStoreCache** (`@Environment`): app-level cache of `ConversationStore` instances keyed by workspace ID. Stores survive `ChatView` mount/unmount, preserving streaming state across navigation. Stores are eagerly created when streaming starts (even if ChatView isn't open). Evicted on workspace archive/delete.
- **ChatView receives its store as a parameter** from the cache (via `HiveApp`'s `navigationDestination`). No per-view WS — all sends go through `store.send` closure wired to `WorkspaceConnection`.
- **Turn-completed badge**: `HubStatusMonitor.completedWorkspaces` tracks workspaces where a `done` event fired. `WorkspaceCard` shows a green dot. Cleared when `ChatView` opens (via `clearCompleted`).
- Tool rendering mirrors the frontend: same tool names, same icon mapping, same hierarchical display (parentToolUseId).
- AskUserQuestion renders as a paginated form sheet with multi-select support.
- ExitPlanMode renders as a markdown preview with approve/reject actions.
- Chat drafts are persisted per-workspace and restored on app relaunch (includes `selectedModelId`, `thinkingLevel`).
- Model catalog is fetched dynamically from `/api/models`. Picker groups by provider, disables cross-provider items when session is locked.
- Codex models show thinking level cycling (Low/Med/High/xHigh) instead of boolean toggle. Plan mode hidden for providers that don't support it.
- `lockedProvider` is read from WS status events (not REST) for instant model locking after first message.
- Pre-multi-model sessions default to `"claude"` when they have messages but no `lockedProvider`.
- PR status is polled via REST (15s) with enriched display (reviews, checks, merge state) matching the frontend.

## Coding Rules

- TypeScript strict mode, ES modules.
- Use English for code/comments/UI copy.
- Keep backend routes testable by preserving optional `dataDir` injection.
- Keep state mutations serialized via workspace/project lock helpers.
- **Before completing any task, run tests (`npm test`) and typecheck (`npm run typecheck`) from the repo root to catch regressions. Do not consider a task done until both pass.**

## Critical Guardrails

- **Do not execute raw shell git strings**. Use `git(args, cwd)` from `backend/src/utils/git.ts`.
- Validate repository URLs with `validateRepositoryUrl()` before cloning.
- Keep WebSocket protocol types in sync between:
  - `backend/src/types.ts`
  - `frontend/src/types.ts`
  - `ios/HiveMobile/Models/WebSocketTypes.swift`
- When adding new WS message types, update:
  - backend stream dispatch,
  - frontend reducers/hooks (`useConversation`, `useWorkspaceLiveData`, `ws-transport` cache),
  - iOS stores (`ConversationStore`, `HubStatusMonitor`),
  - corresponding tests.
- When Claude CLI adds new content block types, update `ContentBlock` in `backend/src/types.ts` and the switch in `conversation-session.ts`.
- When adding a new provider, implement `AgentProvider` from `providers/types.ts`, register it in `providers/registry.ts`, and add a stream adapter if the CLI output format differs from Claude's.
- Keep provider capabilities (`ProviderCapabilities`) in sync across backend types, frontend types, and iOS models.

## Testing

- Backend tests live next to source (`backend/src/**/*.test.ts`).
- Frontend tests live in `frontend/tests/**`.
- Use `SessionOptions.command = "bash"` in backend tests to avoid local Claude CLI dependency.
- WS tests use Fastify's `injectWS()` (not raw `new WebSocket()`) for deterministic message ordering.
- CI sets `NODE_ENV=test` explicitly to ensure React 19 exports `act()` in its development bundle.

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
- No toast/notification system for transient UI feedback yet.
- No startup reconciliation sweep for all persisted workspaces on backend boot.
- No graceful SIGTERM/SIGINT shutdown flow that drains active sessions.
- Completion scanner does not yet include plugin commands (`~/.claude/plugins`).
- No manual workspace rename/alias UI (auto-naming exists via `naming.ts`).
- No explicit light/dark theme toggle in settings (only accent color picker).
- iOS app has no file viewer/diff viewer (tool output shown as raw text).
- VS Code remote SSH opening is Tauri-desktop only (not available in web or iOS).
- `redacted_thinking` blocks are logged as `[redacted]` but not visually distinguished from regular thinking in the UI.
- Codex provider integration is functional but less battle-tested than Claude. Stream adapter edge cases may surface.
- No Codex session resume verification (thread ID persistence is best-effort).
- Automation detail page does not support inline editing of config (requires recreating the automation).
- No iOS UI for automations or prompt templates yet (types added, UI not implemented).
- No live WS streaming for automation runs (frontend uses REST polling only).

## Automation — Future Milestones

### GitHub Event Automations (M3)
- Webhook receiver endpoint: `POST /api/webhooks/github`
- GitHub sends PR/issue events → match against automations with `trigger.type === "github_event"`
- `AutomationTrigger` union needs `{ type: "github_event"; events: string[] }` variant
- Context enrichment: fetch PR diff/description via `gh` CLI, inject into user prompt
- Template variables: `{{pr_url}}`, `{{pr_title}}`, `{{pr_diff}}`, `{{issue_url}}`, etc.
- Agent output → post as GitHub comment via `gh pr review` or `gh issue comment`
- Requires: webhook secret validation, event deduplication, rate limiting

### Script Automations (M4)
- `AutomationAction` union needs `{ type: "script"; command: string }` variant
- Reuse `scriptRunner.startScript()` + `exitListeners` pattern
- Script output capture for notifications

### Advanced Features
- Automation chaining: trigger type `automation_complete` (run B after A finishes)
- Concurrency limits: semaphore for max parallel automation runs
- Live WS streaming: add `sync_automations` hub subscription for real-time run output
- Run log viewer: show full agent conversation in frontend
- Retry policy: configurable retry count on failure

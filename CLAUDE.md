# Hive Developer Notes

This repository is a monorepo:
- `backend/`: Fastify API + WebSocket server
- `frontend/`: React + Vite UI + Tauri desktop app (`frontend/src-tauri/`)
- `ios/`: SwiftUI iOS app + Live Activity widget

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

- `backend/src/index.ts`: app wiring, auth/rate-limit hooks, route registration, git sync + notifier bootstrap, preflight checks
- `backend/src/api/projects.ts`: project CRUD + fetch
- `backend/src/api/workspaces.ts`: workspace CRUD + diff/stat + files/file + merge + archive
- `backend/src/api/agents.ts`: session routes (single + multi-session)
- `backend/src/api/completions.ts`: completion scanning endpoint
- `backend/src/api/settings.ts`: notification config CRUD + test message
- `backend/src/api/account.ts`: GitHub OAuth device flow + `gh` CLI integration
- `backend/src/api/scripts.ts`: workspace setup/run script lifecycle (start/stop/status)
- `backend/src/ws/stream.ts`: conversation WebSocket protocol
- `backend/src/ws/terminal.ts`: PTY terminal WebSocket
- `backend/src/ws/script.ts`: script execution WebSocket (PTY output streaming)
- `backend/src/services/git-sync.ts`: branch/PR/diff polling and workspace broadcasts
- `backend/src/services/script-runner.ts`: PTY-based script execution with status broadcasting
- `backend/src/agents/conversation-session.ts`: Claude process lifecycle per turn
- `backend/src/agents/stream-parser.ts`: NDJSON parser for Claude CLI `--output-format stream-json --verbose`
- `backend/src/agents/agent-manager.ts`: in-memory session registry, persistence, switching, notification dispatch
- `backend/src/agents/naming.ts`: branch + session auto-naming via dedicated Claude subprocess
- `backend/src/notifications/notifier.ts`: event dispatcher for notification channels
- `backend/src/notifications/telegram.ts`: Telegram bot API channel
- `backend/src/state/state.ts`: JSON persistence + per-project locks
- `backend/src/state/config.ts`: file-based app config (`$DATA_DIR/config.json`)
- `backend/src/utils/preflight.ts`: startup dependency checks (git >= 2.17, claude, gh)
- `backend/src/utils/hive-config.ts`: `hive.json` parser for workspace scripts
- `backend/ecosystem.config.cjs`: pm2 ecosystem config (production + development environments)

### Important backend behavior

- Conversation turns use Claude CLI streaming mode (`--print --output-format stream-json -p`).
- Session continuity uses Claude `--session-id` and `--resume`.
- Blocking tools (`AskUserQuestion`, `ExitPlanMode`) are intercepted and surfaced as `tool_input_required`.
- Session tool responses are session-scoped; dismiss/approve/reject are routed back to the correct session.
- `getOrCreateSession()` recovers stale `busy` workspaces lazily (on access).
- On first message, a lightweight Claude subprocess generates a branch name and session title (`naming.ts`), then renames the branch via `git branch -m`.
- Workspace merge is executed in a temporary worktree on default branch, then default-branch ref is updated.
- `archiveWorkspace()` removes worktree and moves matching session folders under `archive/<ws-id>/sessions`.
- Git sync pushes cached `branch_info` + `diff_stats` snapshots to new WS clients.
- Preflight checks run at startup and exit with clear errors if git/claude/gh are missing.
- Notification config is persisted in `$DATA_DIR/config.json` and hot-reloaded when settings change (no restart needed).
- Script runner spawns PTY processes for `hive.json` setup/run commands, buffers last 200 lines, and broadcasts status via the workspace WS channel.
- Stream parser silences `rate_limit_event` CLI events (logged server-side, not forwarded to clients).
- Server-side tool blocks (`server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`) are mapped to standard `tool_use`/`tool_result` WS events with display-name normalization (`web_search`→`WebSearch`, `web_fetch`→`WebFetch`, `bash_code_execution`→`Bash`, `text_editor_code_execution`→`Edit`).
- MCP tool blocks (`mcp_tool_use`, `mcp_tool_result`) and `redacted_thinking` are also handled.
- Image attachments are resized via sharp and stored as files on disk, served via HTTP (`/api/workspaces/:wsId/sessions/:sessionId/attachments/:filename`).

## Frontend Architecture

- `frontend/src/App.tsx`: routing and global workspace WS syncing
- `frontend/src/pages/WorkspaceView.tsx`: chat + terminal + file tree + scripts + modified files + diff modal
- `frontend/src/pages/settings/AppearanceSettings.tsx`: accent color picker
- `frontend/src/pages/settings/ConnectionSettings.tsx`: Tailscale IP/port + health check
- `frontend/src/pages/settings/AccountSettings.tsx`: GitHub OAuth device flow + profile display
- `frontend/src/pages/settings/NotificationSettings.tsx`: Telegram enable/disable + test message
- `frontend/src/pages/settings/ProjectDetail.tsx`: per-repo info + deletion controls
- `frontend/src/hooks/useConversation.ts`: reducer-driven WS conversation state + tool responses
- `frontend/src/hooks/useSessions.ts`: list/create/activate/delete sessions
- `frontend/src/hooks/useWorkspaceLiveData.ts`: live status/branch/diff/script data from WS
- `frontend/src/hooks/useScripts.ts`: script start/stop/status
- `frontend/src/hooks/useConnectionStatus.ts`: backend health check
- `frontend/src/hooks/useTailscaleConfig.ts`: Tailscale connection config
- `frontend/src/hooks/useServerUrl.ts`: configurable backend URL resolution
- `frontend/src/hooks/useAccentColor.ts`: theme accent color persistence
- `frontend/src/hooks/useCompletions.ts`: autocomplete scanning
- `frontend/src/lib/ws-transport.ts`: reconnecting WS transport + replay buffer
- `frontend/src/components/Sidebar.tsx`: project/workspace nav + archive/delete + activity preview
- `frontend/src/components/Terminal.tsx`: xterm + `/ws/terminal/:wsId`
- `frontend/src/components/chat/PlanProposal.tsx`: plan mode proposal card with accept/handoff/copy
- `frontend/src/lib/terminal.ts`: SSH command builder + terminal app detection (Tauri)
- `frontend/src/lib/open-external.ts`: VS Code remote SSH URI builder + external app launcher
- `frontend/src/hooks/useTerminalApps.ts`: detect available terminal emulators (Tauri)
- `frontend/src-tauri/`: Tauri v2 desktop app (Rust shell, config, icons)

### Important frontend behavior

- The frontend supports a configurable server URL (Settings > Connection) for remote backend connectivity. All API calls (`useApi.ts`) and WebSockets (`ws-transport.ts`, `Terminal.tsx`) resolve the base URL via `getServerUrl()` from `useServerUrl.ts`.
- The app keeps WS channels synced for all known workspace IDs (`wsTransport.syncWorkspaces`).
- `useConversation` hydrates from REST history and resolves stale replay races with request tokens.
- Terminal instances are tracked in context; hidden terminals stay alive until explicitly closed.
- Session tabs support create/switch/delete with live message replay and per-session streaming indicators.
- Chat input supports image attachments (paste/drag-drop/picker), thinking toggle, plan mode, and `/` + `@` autocomplete.
- Plan proposals render as rich markdown cards with accept, hand-off-to-new-session, and copy actions.
- Workspace sidebar shows script panel with live PTY output when `hive.json` defines setup/run commands.
- Connection health is checked via `useConnectionStatus`; the "Add Repository" button is gated until a valid connection is configured.
- File viewer uses Shiki syntax highlighting with github-dark theme and line numbers.
- VS Code remote SSH: workspace can be opened in VS Code via `vscode://vscode-remote/ssh-remote+` URIs (Tauri desktop only).

## iOS App (`ios/`)

- `HiveMobile/HiveApp.swift`: app entry point
- `HiveMobile/Models/Models.swift`: data models (ChatMessage, ToolCall, Workspace, etc.)
- `HiveMobile/Models/WebSocketTypes.swift`: WS protocol types (mirrors `backend/src/types.ts`)
- `HiveMobile/Models/StreamingAttributes.swift`: Live Activity attributes
- `HiveMobile/Services/APIClient.swift`: REST API client
- `HiveMobile/Services/WebSocketManager.swift`: WS connection handler
- `HiveMobile/Services/LiveActivityManager.swift`: iOS 16+ Live Activity (streaming indicator on lock screen)
- `HiveMobile/Services/ImageCache.swift`: image caching
- `HiveMobile/Stores/ConversationStore.swift`: chat state (mirrors `useConversation.ts`)
- `HiveMobile/Stores/ChatDraftStore.swift`: draft message persistence
- `HiveMobile/Stores/ProjectStore.swift`: project list state
- `HiveMobile/Stores/HubStatusMonitor.swift`: connectivity monitoring
- `HiveMobile/Views/Chat/ChatView.swift`: conversation UI
- `HiveMobile/Views/Chat/MessageBubble.swift`: message + tool call rendering
- `HiveMobile/Views/Chat/ToolInputSheet.swift`: AskUserQuestion + ExitPlanMode interactive sheets
- `HiveMobile/Views/Chat/SessionSheet.swift`: session switching
- `HiveMobile/Views/Hub/HubView.swift`: project/workspace navigation
- `HiveMobile/Views/Hub/AddProjectSheet.swift`: new project creation
- `HiveMobile/Views/Hub/WorkspaceCard.swift`: workspace cards with activity preview
- `HiveMobile/Theme/DesignTokens.swift`: design tokens (WhisperColor, WhisperFont)
- `HiveWidget/`: iOS Live Activity widget (streaming status on lock screen)

### Important iOS behavior

- Connects to the same backend as web/desktop via configurable host/port (Settings).
- Auth token stored in UserDefaults, passed as query param on WS connections.
- Tool rendering mirrors the frontend: same tool names, same icon mapping, same hierarchical display (parentToolUseId).
- AskUserQuestion renders as a paginated form sheet with multi-select support.
- ExitPlanMode renders as a markdown preview with approve/reject actions.
- Chat drafts are persisted per-workspace and restored on app relaunch.
- Live Activity shows streaming status on lock screen when a turn is in progress.

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
  - `ios/HiveMobile/Models/WebSocketTypes.swift`
- When adding new WS message types, update:
  - backend stream dispatch,
  - frontend reducers/hooks (`useConversation`, `useWorkspaceLiveData`, `ws-transport` cache),
  - iOS stores (`ConversationStore`, `WebSocketManager`),
  - corresponding tests.
- When Claude CLI adds new content block types, update `ContentBlock` in `backend/src/types.ts` and the switch in `conversation-session.ts`.

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
- No toast/notification system for transient UI feedback yet.
- No startup reconciliation sweep for all persisted workspaces on backend boot.
- No graceful SIGTERM/SIGINT shutdown flow that drains active sessions.
- Completion scanner does not yet include plugin commands (`~/.claude/plugins`).
- No manual workspace rename/alias UI (auto-naming exists via `naming.ts`).
- No explicit light/dark theme toggle in settings (only accent color picker).
- iOS app has no terminal emulator (chat-only, no PTY access).
- iOS app has no file viewer/diff viewer (tool output shown as raw text).
- VS Code remote SSH opening is Tauri-desktop only (not available in web or iOS).
- `redacted_thinking` blocks are logged as `[redacted]` but not visually distinguished from regular thinking in the UI.

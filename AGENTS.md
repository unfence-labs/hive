# Hive Developer Notes

This repository is a monorepo:
- `backend/`: Fastify API + WebSocket server
- `frontend/`: React + Vite UI + Tauri desktop app (`frontend/src-tauri/`)
- `ios/`: SwiftUI iOS app

Hive runs AI agent conversations (Claude, Codex, Gemini) in isolated Git workspaces (worktrees) created from a project's bare repo.

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

One session is active per workspace, but multiple sessions can coexist (max 4) and be switched/loaded from disk.

## Backend Architecture

- `backend/src/index.ts`: app wiring, auth/rate-limit hooks, route registration, git sync + notifier bootstrap, preflight checks
- `backend/src/api/projects.ts`: project CRUD + fetch
- `backend/src/api/brain.ts`: singleton Brain routes — state read-create-connect-delete (`GET/POST/DELETE /api/brain`), working-tree file ops (`GET /api/brain/files`, `GET/PUT/DELETE /api/brain/file`, `POST /api/brain/file/rename`), and git ops (`GET /api/brain/status`, `GET /api/brain/diff` returning `{ diff, omittedFileCount }`, `POST /api/brain/save`) for a normal Git clone, not a Project
- `backend/src/brain/brain-files.ts`: Brain working-tree file operations (list/read/upsert/delete/rename) with `requireBrainRepo()` guard (409 when absent), anti-traversal `resolveBrainFilePath()`, and `.git` protection. Upsert/delete/rename touch disk only — never git.
- `backend/src/brain/brain-git.ts`: Brain git operations — `getBrainStatus()` (porcelain pending changes), `getBrainDiff()` (working-tree-vs-HEAD incl. untracked; returns `{ diff, omittedFileCount }` where `omittedFileCount` is the number of untracked files dropped by the render cap, surfaced so the review never hides files that `add -A` will commit), `saveBrain()` (`git add -A` + commit + push)
- `backend/src/utils/file-tree.ts`: shared recursive file-tree builder (`buildFileTree`) reused by workspace and Brain listings (ignores VCS/build/dep dirs, depth + node caps); `flattenFilePaths()` flattens a tree into a sorted path list (used for the Brain map)
- `backend/src/utils/git-diff.ts`: shared `getUntrackedDiff()` — synthetic new-file patches for untracked files, concatenable with `git diff HEAD`. Returns `{ patch, total, included }` (injectable `maxFiles` cap, default 100) so callers can surface how many untracked files were omitted from the rendered patch. Empty files render a `@@ -0,0 +0,0 @@` hunk (no spurious blank `+` line).
- `backend/src/api/workspaces.ts`: workspace CRUD + diff/stat + files/file + merge + archive + PR status + bulk PR status + file-completions + terminal start/stop
- `backend/src/api/agents.ts`: session routes (single + multi-session)
- `backend/src/api/completions.ts`: provider-aware completion scanning endpoint
- `backend/src/agents/chat-context.ts`: shared `resolveChatCwd(wsId)` mapping a chat workspace id to its working directory (Brain repo for `"brain"`, Git worktree otherwise; `null` when absent); used by the file-mention resolver (`ws/stream.ts`) and the file/`@`/`/` completion endpoints so the Brain gets the same `#`-mention + autocomplete behavior as workspaces without duplicated branches
- `backend/src/api/models.ts`: model catalog endpoint (`GET /api/models`)
- `backend/src/api/settings.ts`: notification config CRUD + test message + APNs device token registration
- `backend/src/api/account.ts`: GitHub OAuth device flow + `gh` CLI integration
- `backend/src/api/scripts.ts`: workspace setup/run script lifecycle (start/stop/status)
- `backend/src/api/agents-settings.ts`: `GET /api/settings/agents` — provider version check + npm update detection
- `backend/src/api/base-prompt.ts`: `GET/PUT/DELETE /api/prompts/base` — base system prompt CRUD
- `backend/src/api/ui-preferences.ts`: `GET/PUT /api/ui-preferences` — global UI preferences (sidebar folders + folderOpenState), sanitized against known project IDs on read and write
- `backend/src/api/automations.ts`: automation CRUD + manual trigger + run history + run messages
- `backend/src/api/prompt-templates.ts`: prompt template CRUD (deletion guard if referenced by automation)
- `backend/src/api/agent-instructions.ts`: global instruction settings (`GET/PUT/DELETE/POST /api/settings/instructions`) with `.codex/AGENTS.md` canonicalization, Claude symlink sync, and Codex override visibility
- `backend/src/api/skills.ts`: global skill settings (`GET/POST/PUT/DELETE /api/settings/skills`) with `.agents/skills` canonicalization and Claude symlink sync
- `backend/src/api/custom-agents.ts`: global custom agent settings (`GET/POST/PUT/DELETE /api/settings/custom-agents`) with provider-native Markdown/TOML editing and explicit counterpart creation
- `backend/src/ws/stream.ts`: multiplexed hub WebSocket protocol (`/ws/hub`; `sync_workspaces` subscription, `HubOutgoing` envelopes)
- `backend/src/ws/script.ts`: script execution WebSocket (PTY output streaming)
- `backend/src/services/git-sync.ts`: branch/diff polling and workspace broadcasts (PR status moved to REST)
- `backend/src/services/script-runner.ts`: PTY-based script execution with status broadcasting + command-less interactive terminal mode
- `backend/src/services/automation-scheduler.ts`: cron-based automation executor (croner, ConversationSession, summary extraction, git context injection, notifications)
- `backend/src/agents/conversation-session.ts`: agent process lifecycle per turn (provider-aware); `SessionKind` (`chat`/`automation`/`brain`)
- `backend/src/agents/stream-parser.ts`: NDJSON parser for Claude CLI `--output-format stream-json --verbose`
- `backend/src/agents/agent-event-normalizer.ts`: provider event normalization into Hive stream events and activity updates
- `backend/src/agents/runners/factory.ts`: runner selection (`codex` chat -> App Server, Codex automation -> process runner)
- `backend/src/agents/runners/process-agent-runner.ts`: CLI process runner for Claude, Gemini, and Codex exec automations
- `backend/src/agents/runners/codex-app-server-runner.ts`: Codex App Server turn runner and stop/interruption lifecycle
- `backend/src/agents/agent-manager.ts`: in-memory session registry, persistence, switching, notification dispatch (workspace-coupled)
- `backend/src/agents/brain-manager.ts`: Brain session manager — reuses `ConversationSession` but resolves context from the Brain clone (`cwd = brainRepoPath`, `dataDir = brainDir`, `workspaceId = "brain"`); list/create/switch/delete with `MAX_BRAIN_SESSIONS = 4`; Brain system prompt with fresh file-path map per session
- `backend/src/agents/session-dispatch.ts`: unified session surface keyed by workspace id — routes `wsId === "brain"` to `brain-manager`, everything else to `agent-manager`, so the WS hub + session routes stay manager-agnostic (no duplicated session logic)
- `backend/src/agents/naming.ts`: branch + session auto-naming via dedicated Claude subprocess
- `backend/src/agents/system-prompt.ts`: system prompt construction — `DEFAULT_BASE_PROMPT`, `loadBasePrompt()`, `getGitContext()`, `formatGitContextBlock()`, `buildSystemPrompt()` with template variable interpolation (`{PROJECT}`, `{DIR}`, `{DEFAULT_BRANCH}`); `buildBrainSystemPrompt()` + `formatBrainMapBlock()` inject the Brain's flattened file-path map (paths only) as the retrieval mechanism
- `backend/src/agents/providers/types.ts`: `AgentProvider` interface, `ProviderCapabilities`, `ModelDefinition` (includes `contextWindow`), `StreamAdapter`
- `backend/src/agents/providers/registry.ts`: CLI detection, model ID resolution (`"claude:opus-4-7"`), model catalog builder, npm package version tracking
- `backend/src/agents/providers/claude.ts`: Claude provider (CLI args, env, `--effort` flag for reasoning effort)
- `backend/src/agents/providers/codex.ts`: Codex provider (`codex exec` CLI args, thread resume)
- `backend/src/agents/providers/codex-app-server.ts`: long-lived JSON-RPC bridge for interactive Codex chat over `codex app-server`
- `backend/src/agents/providers/codex-stream-adapter.ts`: Codex JSONL->StreamParserEvent normalizer for assistant text/thinking, tool calls, native todo lists, file changes, token usage, and non-fatal diagnostics
- `backend/src/agents/providers/gemini.ts`: Gemini provider (`gemini -p` CLI args, `-o stream-json`, session resume via `-r`)
- `backend/src/agents/providers/gemini-stream-adapter.ts`: Gemini NDJSON->StreamParserEvent normalizer with tool name mapping (`run_shell_command`->`Bash`, `read_file`->`Read`, etc.)
- `backend/src/notifications/types.ts`: `NotificationEvent` discriminated union (5 variants: `agent_turn_complete`, `agent_needs_input`, `agent_proposed_plan`, `agent_failed`, `automation_run_complete`) + `NotificationChannel` interface
- `backend/src/notifications/notifier.ts`: event dispatcher for notification channels
- `backend/src/notifications/telegram.ts`: Telegram bot API channel
- `backend/src/notifications/apns.ts`: APNs push notification channel (HTTP/2, ES256 JWT, zero external deps, auto token pruning on 410)
- `backend/src/state/automations.ts`: automation + run persistence (atomic writes, run capping at 50)
- `backend/src/state/prompt-templates.ts`: template persistence (`.md` files with YAML frontmatter in `~/.hive/prompts/`)
- `backend/src/state/base-prompt.ts`: base prompt persistence (`~/.hive/prompts/base.md`), atomic write, reset-to-default
- `backend/src/state/agent-instructions.ts`: global instruction discovery and synchronization (`~/.codex/AGENTS.md` canonical, `~/.claude/CLAUDE.md` symlink, `AGENTS.override.md` read-only visibility)
- `backend/src/state/skills.ts`: global skill discovery and synchronization (`~/.agents/skills` canonical, `~/.claude/skills` symlinks)
- `backend/src/state/custom-agents.ts`: global custom agent discovery and provider-native persistence (`~/.claude/agents/*.md`, `~/.codex/agents/*.toml`) without symlink sync
- `backend/src/state/brain.ts`: Brain singleton state persistence at `$DATA_DIR/brain/state.json`
- `backend/src/utils/custom-agent-manifest.ts`: Claude Markdown frontmatter + Codex TOML manifest parsing and counterpart formatting
- `backend/src/state/ui-preferences.ts`: UI preferences persistence (`$DATA_DIR/ui-preferences.json`) — atomic write, sanitize helper drops folders/project refs that no longer exist
- `backend/src/state/state.ts`: JSON persistence + shared atomic JSON writes + per-project locks
- `backend/src/state/config.ts`: file-based app config (`$DATA_DIR/config.json`)
- `backend/src/utils/preflight.ts`: startup dependency checks (git >= 2.17, claude, gh; codex/gemini optional)
- `backend/src/utils/github.ts`: GitHub URL parsing, `gh` CLI wrapper, shared GitHub repo creation helpers, PR status fetching (reviews, checks, merge state)
- `backend/src/brain/brain-repo.ts`: Brain normal-clone creation/connect/delete operations; create mode provisions a private GitHub repo, seeds README, commits, and pushes
- `backend/src/utils/hive-config.ts`: `hive.json` parser for workspace scripts
- `backend/src/utils/summary-extractor.ts`: extract `## Summary` section from agent messages
- `backend/src/utils/format.ts`: `formatDuration(ms)` utility for notification formatting
- `backend/ecosystem.config.cjs`: pm2 ecosystem config (production + development environments)

### Important backend behavior

- Conversation turns use the provider abstraction: `conversation-session.ts` resolves the provider from compound model IDs (e.g. `"claude:opus-4-7"`, `"codex:o3-pro"`, `"gemini:gemini-3.1-pro-preview"`) via `resolveProvider()` and delegates CLI arg building, env config, and stream parsing to the matched provider.
- Claude provider uses `--print --output-format stream-json -p`. Codex interactive chat uses `codex app-server`. Codex automations use `codex exec --json`. Gemini provider uses `gemini -p -o stream-json`.
- Session continuity: Claude uses `--session-id` and `--resume`; interactive Codex chat persists the App Server thread id as `providerSessionId` and resumes with `thread/resume`; Codex exec automations use `--thread-id`; Gemini uses `-r <sessionId>`.
- Provider is locked per session after the first message (`lockedProvider`). Subsequent messages validate against it. The lock is broadcast via WS status events.
- Pre-multi-model sessions (created before provider support) default to `"claude"` when they have messages but no `lockedProvider`.
- Blocking tools (`AskUserQuestion`, `ExitPlanMode`) are intercepted and surfaced as `tool_input_required`. Only providers with `blockingTools` capability support this.
- Session tool responses are session-scoped; dismiss/approve/reject are routed back to the correct session.
- `getOrCreateSession()` recovers stale `busy` workspaces lazily (on access).
- On first message, a lightweight Claude subprocess generates a branch name and session title (`naming.ts`), then renames the branch via `git branch -m`.
- Workspace merge is executed in a temporary worktree on default branch, then default-branch ref is updated.
- `archiveWorkspace()` removes worktree and moves matching session folders under `archive/<ws-id>/sessions`.
- Git sync pushes cached `branch_info` + `diff_stats` snapshots to new WS clients. Before computing diff stats, Hive refreshes the local default branch from `origin/<defaultBranch>` with a fast-forward-only update, throttled per project, so branch diffs do not include already-merged default-branch changes. PR status is no longer polled here — moved to on-demand REST endpoints.
- WS uses a single multiplexed hub endpoint (`/ws/hub`). Clients send `sync_workspaces` with workspace ID lists to subscribe/unsubscribe. All outgoing messages are wrapped in `HubOutgoing` envelopes (`{ workspaceId, event }`). Bootstrap (status, history, branch_info, diff_stats, script_status) is sent per workspace on subscribe.
- Preflight checks run at startup and exit with clear errors if git/claude/gh are missing. Codex and Gemini are optional.
- Notification system supports 5 event types: turn complete (with duration + summary), needs input, proposed plan, agent failed, automation run complete. Events dispatched to Telegram and/or APNs channels.
- Notification config is persisted in `$DATA_DIR/config.json` and hot-reloaded when settings change (no restart needed).
- APNs channel uses HTTP/2 (`node:http2`) with ES256 JWT signing via `node:crypto`. Auto-prunes stale device tokens on 410 Gone.
- Script runner spawns PTY processes for `hive.json` setup/run commands, buffers last 200 lines, and broadcasts status via the workspace WS channel. Also supports interactive terminal mode (no command required).
- Stream parser silences `rate_limit_event` CLI events (logged server-side with structured rate_limit_info diagnostics, not forwarded to clients).
- Codex stderr is classified before surfacing to clients: known operational noise is suppressed, websocket metadata encoding failures are emitted inline as `CodexDiagnostic` tool calls, and unknown stderr remains an error.
- Codex native JSONL items are normalized to the shared tool protocol: `todo_list` becomes `TodoList`, item-level `error` becomes `CodexDiagnostic`, file changes become `Edit`, and repeated item updates reuse the same tool id while updating the tool result.
- Codex App Server events are normalized into `AgentActivity` records for command execution, file changes, plan updates, and diagnostics. These are emitted through additive `agent_activity` WS events while `tool_use`/`tool_result` compatibility is preserved.
- Codex App Server `thread/tokenUsage/updated` notifications feed assistant `contextUsedTokens` / `contextWindowTokens`, so the existing context ring can show provider-reported context usage without relying on static Codex catalog windows.
- Unsupported Codex App Server notifications are surfaced as deduplicated diagnostic activities. Unsupported non-approval App Server requests are answered with explicit JSON-RPC errors and surfaced as diagnostic error activities. Command/file approvals are auto-accepted according to Hive's current no-approval policy.
- Codex App Server close/reject paths clear transient process state, including unpersisted thread ids. If an App Server process is force-closed before `providerSessionId` is persisted, the next turn starts a fresh thread instead of trying to resume a stale in-memory thread id. Stale `turn/completed` events are ignored when another active turn has already started.
- `providerSessionId` is the canonical persisted provider thread/session id. `claudeSessionId` remains as a compatibility shim for older session metadata.
- Server-side tool blocks (`server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`) are mapped to standard `tool_use`/`tool_result` WS events with display-name normalization (`web_search`->`WebSearch`, `web_fetch`->`WebFetch`, `bash_code_execution`->`Bash`, `text_editor_code_execution`->`Edit`).
- MCP tool blocks (`mcp_tool_use`, `mcp_tool_result`) and `redacted_thinking` are also handled.
- Image attachments are resized via sharp (max 1568px, JPEG q80) and stored as files on disk, served via HTTP (`/api/workspaces/:wsId/sessions/:sessionId/attachments/:filename`).
- PR status: single-workspace endpoint (`GET /api/workspaces/:wsId/pr-status`) with 15s TTL cache, plus bulk endpoint (`POST /api/workspaces/bulk-pr-status`) that seeds per-workspace cache entries. Returns enriched data: review state, checks counts, mergeable state (13-state priority ladder), supports closed/merged/draft PRs.
- System prompt construction: `system-prompt.ts` loads base prompt from `~/.hive/prompts/base.md` (or hardcoded default), interpolates template variables (`{PROJECT}`, `{DIR}`, `{DEFAULT_BRANCH}`), appends git context block.
- Brain chat (M-C): Brain sessions run through the shared `ConversationSession` machinery via a dedicated `brain-manager` (the workspace-coupled `agent-manager` cannot back a non-workspace clone). Sessions persist under `$DATA_DIR/brain/sessions/<id>/`, are addressed over the existing WS hub as `workspaceId = "brain"` (no new WS message types), and are routed by `session-dispatch.ts`. The Brain system prompt injects a fresh file-path map (paths only, `.git` excluded) at each session start/disk-load — the user guides the agent, there is no search index. Brain sessions use the same full tool set and skip-permissions behavior as workspace sessions (no tool restriction). `#file` mentions, `@agent`, and `/command` autocomplete work in Brain chat too: the file-mention resolver and the `file-completions`/`completions` endpoints resolve `wsId === "brain"` against the Brain repo via `resolveChatCwd` (autocomplete lists tracked files via `git ls-files`, while mentions resolve any path within the repo, so freshly-created uncommitted notes are still mentionable by typing their path).
- Automation scheduler (`AutomationScheduler`) runs as a singleton service alongside `GitSyncService`, instantiated in `main()`.
- Automations execute `ConversationSession` directly (not via agent-manager) to keep automation sessions decoupled from workspace sessions.
- Automation system prompt: auto-appends `## Summary` instruction + git context block (for project-linked automations). The resolved system prompt is persisted to disk alongside run messages.
- Summary is extracted from the last assistant message post-run via `extractSummary()`.
- Workspace setup: project-linked automations create a worktree from the project's bare repo, reset to latest default branch on each run; non-project automations use a plain directory.
- No concurrent runs per automation — cron trigger skips if already running.
- Stale "running" runs are marked as failed on server restart.
- Automation data lives at `~/.hive/automations.json` (definitions) and `~/.hive/automations/<autoId>/` (runs, sessions, workspace).
- Prompt templates persist as individual `.md` files in `~/.hive/prompts/` (one file per template, YAML frontmatter + content); deletion is blocked if referenced by an automation.
- Automation notifications use the same `Notifier` + `TelegramChannel` / `ApnsChannel` infrastructure as workspace turn-complete notifications.
- `done` WS event includes optional `pendingToolName` and `durationMs`; `cancelled` includes optional `errorDetail` and `userInitiated`.

## Frontend Architecture

- `frontend/src/App.tsx`: routing (including `/brain`), global workspace WS syncing (always includes the synthetic `"brain"` workspace id), WS cache invalidation
- `frontend/src/pages/WorkspaceView.tsx`: chat + file tree + inline diff viewer + scripts + modified files + PR status. The conversation column (chat/sessions/tabs/tasks/queue) comes from the shared `useConversationColumn` hook + `ConversationPane` component; the page keeps its plan flow (`PlanActionBar`, `handleSend` with plan-reject, hand-off, `dismissPlan`/`approvePlan`), the unread-clear effect, diff-scope logic, the file/diff tab takeover (`FileContentToolbar` + `FileViewer`/`InlineDiffViewer`), browser panel, PR section, and scripts inline.
- `frontend/src/pages/BrainView.tsx`: two-column resizable Brain layout (`useDefaultLayout({ id: "hive-brain-v2" })`) mirroring `WorkspaceView` — a main column (left, `minSize "40%"`) with the agent chat plus a file-tab takeover via the shared `FileViewer`, and the notes file tree (right, `BrainFileTree`, `defaultSize "25%"`). The chat column is the shared `useConversationColumn` hook + `ConversationPane` component pointed at `workspaceId = "brain"` (so the Brain now uses the same per-session message queue as workspaces, no longer a single queue dropped on session switch). The page keeps its `handleSend` (plain), file-tab state, `renderMode` (defaults to `"rendered"` — Raw enables editing), the tree actions (`handleSelect`/`handleCreate`/`handleRename`/`handleDelete`/`handleWriteToDisk`), and the Save flow (status badge + indicator + review modal) inline; it passes no `planActionBar` (Brain has no plan flow). Clicking a note opens it in a file tab that takes over the chat area; opening invalidates that file's content key first to defeat the `staleTime: Infinity` cache. `useBrainChatRefresh(openFile)` refreshes tree/status/open-file on agent writes. The slim header hosts the Save indicator + Save button.
- `frontend/src/components/brain/BrainReviewChanges.tsx`: Save review panel — renders the full working-tree diff via `FileDiffCard`, optional commit message, Save & Push / Cancel; shows a warning when `omittedFileCount > 0` (files not shown in the diff that Save will still commit). Hosted inside a right-side `Sheet` modal opened by the header Save button (no longer replaces a center panel).
- `frontend/src/components/brain/BrainFileTree.tsx`: right-column Brain tree — virtualizes (windows) a flattened list of the currently visible nodes via `@tanstack/react-virtual` (only expanded folders emit their children) so it stays fluid with thousands of notes; fixed-height rows with depth indentation, `tree`/`treeitem` ARIA roles, selection, expand/collapse, and create (new note) / rename (Dialog) / delete (AlertDialog) actions. Renders flat rows rather than the recursive `FileTree` primitives (which don't window cleanly); those primitives remain in use elsewhere.
- `frontend/src/components/diff/FileDiffCard.tsx`: shared single-file diff card (header + `@pierre/diffs` `FileDiff`) reused by `InlineDiffViewer` and `BrainReviewChanges`
- `frontend/src/pages/AutomationDetail.tsx`: automation config display + run history + run log sheet + enable/disable + manual trigger + delete + inline editing
- `frontend/src/pages/AutomationsHome.tsx`: automation list empty state with creation CTA
- `frontend/src/pages/settings/AppearanceSettings.tsx`: accent color picker
- `frontend/src/pages/settings/ConnectionSettings.tsx`: Tailscale IP/port + health check
- `frontend/src/pages/settings/AccountSettings.tsx`: GitHub OAuth device flow + profile display
- `frontend/src/pages/settings/NotificationSettings.tsx`: Telegram + APNs enable/disable + test message (instant-apply toggles)
- `frontend/src/pages/settings/ProjectDetail.tsx`: per-repo info + deletion controls
- `frontend/src/pages/settings/AgentSettings.tsx`: per-provider version display + npm update check
- `frontend/src/pages/settings/PromptTemplatesSettings.tsx`: master-detail split view — base prompt + template list (left) + CodeMirror editor (right) + prompt flow explainer dialog
- `frontend/src/pages/settings/InstructionsSettings.tsx`: global instructions editor — `.codex/AGENTS.md` canonical storage, Claude symlink sync, Codex override visibility, provider diff view
- `frontend/src/pages/settings/SkillsSettings.tsx`: master-detail global skills editor — `.agents/skills` canonical storage, Claude symlink sync, provider/status badges
- `frontend/src/pages/settings/CustomAgentsSettings.tsx`: master-detail global custom agent editor — provider tabs, validated Markdown/TOML editors, provider-specific delete, explicit counterpart creation
- `frontend/src/components/settings/`: shared settings editor frame, resource list, provider status primitives, and selection helpers
- `frontend/src/contexts/WorkspaceLiveDataContext.tsx`: React context for `useWorkspaceLiveData` — provides per-session unread tracking, `clearUnread(wsId, sessionId?)`
- `frontend/src/hooks/useConversation.ts`: reducer-driven WS conversation state + tool responses + `lockedProvider` tracking + late live-fragment guards
- `frontend/src/hooks/useConversationColumn.ts`: shared conversation-column orchestration reused by `WorkspaceView` + `BrainView` — aggregates `useConversation`/`useSessions`/`useTabs`/`useTasks`/`useBackgroundAgents` into one object, computes `effectiveLockedProvider`, owns the per-session message queue (keyed `wsId:sessionId`, auto-dequeue on idle) + `scrollToBottomTrigger`, and exposes shared `handleCreateSession`/`handleActivateSession`/`handleDeleteSession`. Page divergences ride on `opts.onActivateSession` (unread clear) and `opts.onLastSessionDeleted` (cache cleanup). Plan logic, file-mention handlers, and ChatInput's `onSend` stay per-page.
- `frontend/src/hooks/useSessions.ts`: list/create/activate/delete sessions (max 4)
- `frontend/src/hooks/useWorkspaceLiveData.ts`: live status/branch/diff/script data from WS + per-session unread tracking (`unreadBySession`)
- `frontend/src/hooks/useModels.ts`: model catalog fetch, selection, provider-aware locking
- `frontend/src/hooks/usePrStatus.ts`: reads from TanStack Query cache seeded by `useBulkPrStatus` (no independent polling timer)
- `frontend/src/hooks/useScripts.ts`: script start/stop/status + interactive terminal start/stop
- `frontend/src/hooks/useConnectionStatus.ts`: backend health check
- `frontend/src/hooks/useTailscaleConfig.ts`: Tailscale connection config
- `frontend/src/hooks/useServerUrl.ts`: configurable backend URL resolution
- `frontend/src/hooks/useAccentColor.ts`: theme accent color persistence
- `frontend/src/hooks/useCompletions.ts`: autocomplete scanning (`/` commands, `@` agents)
- `frontend/src/hooks/useFileCompletions.ts`: file path completions for `#` mention autocomplete
- `frontend/src/hooks/useChatInputDraftPersistence.ts`: draft persistence (message, images, planMode, selectedModelId, thinkingLevel)
- `frontend/src/hooks/useAutomations.ts`: automation CRUD + trigger + run history + run messages hooks (TanStack Query)
- `frontend/src/hooks/useBrain.ts`: Brain singleton query + create/connect/delete mutations for `/api/brain`
- `frontend/src/hooks/useBrainFiles.ts`: Brain file-tree + file-content queries and upsert/delete/rename mutations (each invalidates the tree + git status)
- `frontend/src/hooks/useBrainGit.ts`: `useBrainStatus` (Save badge), `useBrainDiff` (review, fetched on demand, returns `BrainDiffResponse` `{ diff, omittedFileCount }`), `useBrainSave` (commit+push, invalidates status+diff)
- `frontend/src/hooks/useBrainChatRefresh.ts`: subscribes to the `"brain"` hub channel and invalidates Brain file-tree/status/open-file queries on agent `Write`/`Edit` tool calls and `done`/`cancelled` (last-write-wins editor refresh)
- `frontend/src/hooks/usePromptTemplates.ts`: prompt template CRUD hooks
- `frontend/src/hooks/useBasePrompt.ts`: base prompt query + update + reset hooks
- `frontend/src/hooks/useCustomAgents.ts`: custom agent CRUD hooks + completion cache invalidation
- `frontend/src/hooks/useContextUsage.ts`: context window usage calculation from provider-reported context fields, falling back to last assistant message input tokens
- `frontend/src/hooks/useBackgroundAgents.ts`: scans tool calls for background `Task` agents, returns running count
- `frontend/src/hooks/useTabs.ts`: multi-tab state (session + file tabs) with workspace-level snapshot cache, `FileViewMode = "source" | "diff"`
- `frontend/src/hooks/useTasks.ts`: derives `TrackedTask[]` from `TaskCreate`/`TaskUpdate` tool calls, Codex `TodoList` events, and Codex App Server plan updates for task tracker display
- `frontend/src/hooks/useDiff.ts`: diff fetching via `@pierre/diffs` for inline diff viewer
- `frontend/src/hooks/useSidebarCollapsed.ts`: localStorage-backed sidebar collapsed state, Cmd/Ctrl+B keyboard shortcut
- `frontend/src/hooks/useSidebarProjectFolders.ts`: sidebar folder organization — TanStack Query fetch + optimistic mutations with 300ms debounced PUT to `/api/ui-preferences`, localStorage cache for first-render bootstrap, one-shot migration from legacy `hive:sidebar-project-folders:v1` key
- `frontend/src/hooks/useThemeType.ts`: dark/light theme detection via DOM class mutations + `prefers-color-scheme`
- `frontend/src/hooks/useWsCacheInvalidation.ts`: centralized WS-driven TanStack Query invalidation (sessions, files, diff-stat, file-completions)
- `frontend/src/hooks/useTerminalApps.ts`: detect available terminal emulators (Tauri)
- `frontend/src/lib/ws-transport.ts`: single multiplexed hub WS transport (`/ws/hub`; `sync_workspaces`, envelope demux, per-workspace caches + replay buffer)
- `frontend/src/lib/plan-state.ts`: plan mode logic — `isPlanAwaitingUserInput()`, `findPlanContent()` (multi-strategy: Write to plans/, Edit+Read reconstruction, ExitPlanMode input, markdown fallback)
- `frontend/src/lib/sub-agent.ts`: `parseSubAgentInfo()`, `buildChildrenMap()` for hierarchical Task tool rendering
- `frontend/src/lib/pr-display.ts`: `computePrDisplay()` / `computePrDisplayCompact()` — 13-state priority ladder to icons/colors/labels
- `frontend/src/lib/cron.ts`: `getNextRuns()`, `getNextRun()`, `formatTimeUntil()` via croner
- `frontend/src/lib/format-usage.ts`: `formatTokenCount()`, `usageStrokeColor()` for context ring display
- `frontend/src/lib/file-mentions.ts`: `#file` and `@agent` mention parsing + splitting
- `frontend/src/lib/fuzzy-match.ts`: fuzzy file matching with 5-tier scoring for autocomplete
- `frontend/src/lib/clipboard.ts`: `copyToClipboard()` with `execCommand` fallback for HTTP contexts
- `frontend/src/lib/terminal.ts`: SSH command builder + terminal app detection (Tauri)
- `frontend/src/lib/open-external.ts`: VS Code remote SSH URI builder + external app launcher
- `frontend/src/components/Sidebar.tsx`: project/workspace nav + org/repo two-tone headers + resizable workspace/automation panels + sidebar collapse + bulk PR status + unread badges + dashed active border
- `frontend/src/components/WorkspacePathCopyButton.tsx`: workspace header path-copy action with tooltip and transient copied state
- `frontend/src/components/ChatInput.tsx`: message input with provider-adaptive controls, `#` file autocomplete with `MentionHighlightOverlay`, Commit & Push quick action, context ring, message queue display, `appendText` ref for paste-from-diff
- `frontend/src/components/ChatConversation.tsx`: conversation display with hydration flash fix (visibility:hidden + double-rAF settle)
- `frontend/src/components/chat/ConversationPane.tsx`: shared chat-body layout reused by `WorkspaceView` + `BrainView` — renders `ConversationTabs` + a body (hidden, not unmounted, while a file tab is active) with `ChatConversation`, an optional `TaskTracker` (gated on tasks/agents present and no pending question), and a footer that switches between `QuestionPanel` (when an `AskUserQuestion` is pending) and the input. The page-built `<ChatInput>` and optional `<PlanActionBar>` are passed as `chatInput`/`planActionBar` slots inside a shared `relative` footer wrapper.
- `frontend/src/components/chat/AgentActivityList.tsx`: inline renderer for Codex App Server command execution, file changes, and diagnostics; plan updates are filtered into the task tracker
- `frontend/src/components/PrStatusSection.tsx`: enriched PR display (13 states)
- `frontend/src/components/TaskTracker.tsx`: collapsible status bar showing active tasks, Codex plan updates, and background agents with shimmer animation
- `frontend/src/components/AutomationRunLogSheet.tsx`: slide-over sheet for full automation run conversation log with collapsible system prompt banner
- `frontend/src/components/CreateAutomationDialog.tsx`: automation creation + editing form with cron preview (next 3 runs)
- `frontend/src/components/PromptEditor.tsx`: CodeMirror 6 markdown editor with `{TEMPLATE_VAR}` pill highlighting
- `frontend/src/components/PromptFlowExplainer.tsx`: interactive diagram showing prompt assembly flow (interactive chat vs automations)
- `frontend/src/components/FileContentToolbar.tsx`: toolbar with source/diff toggle (hideable via `showSourceDiffToggle={false}` — the Brain has no per-file diff), Raw/Rendered toggle, split/unified layout, paste-to-prompt; diff-only props are optional with safe defaults
- `frontend/src/components/diff/InlineDiffViewer.tsx`: inline diff viewer (`@pierre/diffs/react`) with split/unified modes, line selection, diff comments, paste-to-prompt
- `frontend/src/components/chat/ModelSelector.tsx`: model picker grouped by provider with icons, badges, and provider lock
- `frontend/src/components/chat/PlanProposal.tsx`: plan mode proposal with inline markdown rendering
- `frontend/src/components/chat/PlanActionBar.tsx`: floating action bar above chat input with Copy / Hand-off / Approve buttons
- `frontend/src/components/chat/SubAgentNode.tsx`: Task tool rendering with type-specific icons, expand/collapse, nested child tool tree, result footer
- `frontend/src/components/chat/ContextRing.tsx`: SVG ring showing context window usage (green/yellow/red thresholds) with tooltip
- `frontend/src/hooks/useClipboardCopy.ts`: shared clipboard copy state/timer hook used by copy affordances
- `frontend/src/components/chat/FileAutocompletePopup.tsx`: dropdown for `#` file mention autocomplete
- `frontend/src/components/chat/MentionHighlightOverlay.tsx`: overlay highlighting `#file` and `@agent` mentions in chat input
- `frontend/src/components/chat/QuestionPanel.tsx`: AskUserQuestion card with numbered options, inline text input, multi-question support, CANCELLED badge
- `frontend/src-tauri/`: Tauri v2 desktop app (Rust shell, config, icons)

### Important frontend behavior

- The frontend supports a configurable server URL (Settings > Connection) for remote backend connectivity. All API calls (`useApi.ts`) and WebSockets (`ws-transport.ts`) resolve the base URL via `getServerUrl()` from `useServerUrl.ts`.
- The app maintains a single hub WS connection; `wsTransport.syncWorkspaces` sends `sync_workspaces` with the full workspace ID set to the backend. The synthetic `"brain"` id is always included so the Brain agent chat streams over the same hub.
- Brain chat (M-C): `BrainView` reuses the workspace chat stack inline pointed at `workspaceId = "brain"` (no rewritten chat components; the old `BrainChatPanel`/`BrainEditorPanel` were removed and their orchestration folded into `BrainView`, which now structurally mirrors `WorkspaceView`). Clicking a note opens it in a file tab (shared `FileViewer`, editable in Raw only) that takes over the chat area, exactly like a workspace; Brain has no per-file diff (source-only, so `FileContentToolbar` is passed `showSourceDiffToggle={false}`). When the Brain agent runs a `Write`/`Edit` tool or finishes a turn, `useBrainChatRefresh` invalidates the Brain file tree, status, and the open file's content so the file viewer reflects the agent's changes (last-write-wins for the open file).
- `useConversation` hydrates from REST history, resolves stale replay races with request tokens, and ignores late live fragments after a terminal assistant message. It also tracks `lockedProvider` from WS status events.
- Session tabs support create/switch/delete (max 4 sessions) with live message replay, per-session streaming indicators, and per-session unread badges.
- Chat input dynamically adapts controls based on the selected provider's capabilities: a unified thinking-level cycler reads the supported list from `capabilities.thinkingLevels` (Claude: low/medium/high/xhigh/max via `--effort`; Codex: none/minimal/low/medium/high/xhigh via `model_reasoning_effort`; Gemini: `[]` → hidden), plan mode hidden when unsupported, `/` and `@` autocomplete gated by `completions` capability, `#` file mention autocomplete with fuzzy matching.
- Chat input supports image attachments (paste/drag-drop/picker), Commit & Push quick action button, and context window usage ring.
- Message queue: users can type and submit one follow-up while the agent is streaming. Queued message renders with dashed border and "Queued" label, auto-dispatches on turn complete.
- Plan proposals render inline in chat. `PlanActionBar` floats above the input with Copy, Hand-off (creates new session with plan content), and Approve. Backend emits `plan_mode_changed` WS events on `EnterPlanMode`/`ExitPlanMode` for automatic UI sync.
- Codex App Server command/file activities are normalized into tool-call display data, plan updates feed `TaskTracker`, and diagnostics render through `AgentActivityList`.
- Diagnostic activities make unsupported App Server notifications/requests visible in the chat stream so protocol coverage can be implemented incrementally.
- Sub-agent Task tool calls render as collapsible `SubAgentNode` cards with type-specific icons, nested child tool trees, and result footers. Background agents tracked separately in `TaskTracker`.
- Sidebar: org/repo two-tone project headers (lowercase), build/automation tabs, dashed primary border for active workspace, sidebar collapse via toggle or Cmd/Ctrl+B, workspace count/add button toggle on hover.
- PR status: single polling source — `useBulkPrStatus` polls and seeds per-workspace TanStack Query cache; `usePrStatus` reads from cache only (no independent timer), eliminating drift.
- Unread badges: `done`/`cancelled` WS events mark the session as unread. Session tab and sidebar workspace dot reflect unread state. Cleared per-session (not per-workspace).
- Context ring shows usage fraction (green <50%, yellow <80%, red >=80%) from the last assistant message token data.
- Inline diff viewer replaces the old diff modal. Clicking a modified file opens it inline in diff mode; clicking in file tree opens source mode. Supports split/unified, line selection, diff comments, and paste-to-prompt.
- File viewer uses Shiki syntax highlighting with github-dark theme and line numbers.
- VS Code remote SSH: workspace can be opened in VS Code via `vscode://vscode-remote/ssh-remote+` URIs (Tauri desktop only).
- Chat conversation hides content during initial REST hydration (visibility:hidden + `resize="instant"`) and reveals after scroll position settles via double-rAF, preventing a visible flash-from-top.
- Workspace sidebar shows script panel with live PTY output when `hive.json` defines setup/run commands, plus an always-available interactive terminal tab.
- Connection health is checked via `useConnectionStatus`; the "Add Repository" button is gated until a valid connection is configured.
- Draft persistence saves `selectedModelId` and `thinkingLevel` alongside message text, images, and toggles.
- AskUserQuestion dismissed by user shows "CANCELLED" badge in chat history.
- WS cache invalidation (`useWsCacheInvalidation`): `diff_stats` events invalidate file-completions and diff queries; `done`/`cancelled` invalidate session data.

### Brain (M-B) — two-stage Save model

- The Brain (`/brain`) is a normal Git clone, editable without an agent. M-B is 100% REST (no WebSocket, no agent/session); the left chat column is a collapsed placeholder filled in M-C.
- **Two distinct persistence levels — do not conflate them:**
  1. **Disk write (working tree):** editing a note writes the file to disk immediately via a debounced `PUT /api/brain/file`. This is NOT git; it only prevents losing work (and enables future agent collaboration in M-C).
  2. **Git save (commit + push):** manual, triggered by the Save button after reviewing the working-tree-vs-HEAD diff. This is the backup to the remote. "Save" means publish/back up, not "save my text" (already on disk).
- Save flow: click Save -> center panel switches to "Review changes" (full diff of all pending files: modified + new/untracked + deleted) -> optional commit message -> Save & Push commits + pushes, Cancel returns to the editor without committing.
- `POST /api/brain/save` semantics: nothing to commit -> `{ committed: false, pushed: false }` (not an error); commit OK but push fails -> `{ committed: true, pushed: false, error }` (local commit kept, UI shows "Push failed"); default commit message is `Brain update <ISO timestamp>`.
- `GET /api/brain/diff` reflects exactly what `save` would commit: tracked changes via `git diff HEAD` plus synthetic patches for untracked files (shared `getUntrackedDiff`). It returns `{ diff, omittedFileCount }`: because `save` does `git add -A` (commits everything) while the untracked-render cap bounds memory, `omittedFileCount` reports any untracked files dropped from the rendered diff so the review can warn that more files will be committed than displayed — never a silent truncation.
- All Brain routes are scoped to the Brain repo with anti-traversal validation and a 409 guard when no Brain is connected; the `.git` directory is never accessible. File ops accept an injectable `dataDir` for tests.
- Single human editor in M-B, so React Query invalidation on mutation is sufficient (no live refresh). WebSocket-driven refresh on agent writes is deferred to M-C.

## iOS App (`ios/`)

- `HiveMobile/HiveApp.swift`: app entry point + `AppDelegate` adapter + `CompletedWorkspacesStore` merge on launch + native `NavigationStack` routing
- `HiveMobile/Models/Models.swift`: data models (ChatMessage, ToolCall, Workspace, ModelCatalogEntry, etc.)
- `HiveMobile/Models/AgentActivity.swift`: normalized agent activity models for Codex App Server command execution, file changes, plan updates, diagnostics, and unknown fallback
- `HiveMobile/Models/WebSocketTypes.swift`: WS protocol types (mirrors `backend/src/types.ts`)
- `HiveMobile/Services/APIClient.swift`: REST API client (includes `/api/models`, `/api/workspaces/:wsId/pr-status`, bulk PR status, device token registration)
- `HiveMobile/Services/ImageCache.swift`: image caching
- `HiveMobile/Services/AppDelegate.swift`: push notification registration (APNs), device token forwarding to backend, notification tap routing
- `HiveMobile/Services/CompletedWorkspacesStore.swift`: `@Observable` singleton bridging push notification taps to `HubStatusMonitor`, persists pending IDs across kills via UserDefaults
- `HiveMobile/Stores/ConversationStore.swift`: chat state (mirrors `useConversation.ts`) + `lockedProvider` tracking + per-session plan mode + late live-fragment guards + `send` closure for WS outgoing
- `HiveMobile/Stores/ConversationStoreCache.swift`: app-level cache of ConversationStore instances keyed by workspace ID, survives navigation
- `HiveMobile/Stores/ChatDraftStore.swift`: draft message persistence (includes `selectedModelId`, `thinkingLevel`)
- `HiveMobile/Stores/ProjectStore.swift`: project list state (accepts `ConversationStoreCache` at init)
- `HiveMobile/Stores/ModelCatalog.swift`: dynamic model catalog from API, grouped by provider
- `HiveMobile/Stores/HubStatusMonitor.swift`: single multiplexed hub WS + PR status bulk polling + per-session streaming/unread tracking + foreground reconnect (2s debounce) + background stream catchup
- `HiveMobile/Stores/TaskDerivation.swift`: pure function port of `useTasks.ts` — derives `TasksState` from messages, active tool calls, Codex `TodoList` events, and Codex App Server plan updates
- `HiveMobile/Views/Chat/WorkspaceConversationsView.swift`: workspace-level conversation list, create/delete flow, and `NavigationPath` routing into chat
- `HiveMobile/Views/Chat/ConversationRow.swift`: conversation row with active, streaming, unread, message count, and timestamp state
- `HiveMobile/Views/Chat/ChatView.swift`: single-session conversation UI + provider locking + model selection + per-session plan mode
- `HiveMobile/Views/Chat/ChatInputBar.swift`: input bar with provider-adaptive controls (thinking-level cycler) + context ring
- `HiveMobile/Views/Chat/MessageBubble.swift`: message + tool call rendering + `#file`/`@agent` mention highlighting + copy-to-clipboard button
- `HiveMobile/Views/Chat/AgentActivityList.swift`: SwiftUI renderer for visible `agent_activity` diagnostics and unknown activities; command/file activities are rendered as tool calls and plan updates feed the task tracker
- `HiveMobile/Views/Chat/DiffRendering.swift`: shared chat diff line parsing/rendering used by tool-call diffs and agent file-change activities
- `HiveMobile/Views/Chat/ChatActivityChrome.swift`: shared chat activity content panel primitives
- `HiveMobile/Views/Chat/ChatFormatting.swift`: shared chat formatting helpers
- `HiveMobile/Views/Chat/ToolInputSheet.swift`: AskUserQuestion + ExitPlanMode interactive sheets
- `HiveMobile/Views/Chat/ContextRingView.swift`: SwiftUI context ring with matching color thresholds
- `HiveMobile/Views/Chat/TaskTrackerView.swift`: collapsible task list bar (mirrors frontend `TaskTracker`)
- `HiveMobile/Views/Chat/SessionEmptyState.swift`: empty state for new sessions (project/workspace/branch info)
- `HiveMobile/Views/Hub/HubView.swift`: project/workspace navigation
- `HiveMobile/Views/Hub/AddProjectSheet.swift`: new project creation
- `HiveMobile/Views/Hub/HubRows.swift`: folder/project/workspace rows with activity preview + enriched PR status display + turn-completed/unread badge
- `HiveMobile/Views/Hub/HubStatusSummary.swift`: shared hub diff summary, PR attention rules, and PR status display mapping used by Hub rows and workspace dashboard
- `HiveMobile/Views/Components/StatusDot.swift`: idle (gray) / unread activity (accent with glow animation) dot
- `HiveMobile/Views/Components/AgentActivityIndicator.swift`: animated 3x3 dot grid wave pattern for agent activity
- `HiveMobile/Theme/DesignTokens.swift`: design tokens (WhisperColor, WhisperFont)

### Important iOS behavior

- Connects to the same backend as web/desktop via configurable host/port (Settings).
- Auth token stored in UserDefaults, passed as query param on WS connections.
- **Push notifications**: `AppDelegate` registers for remote notifications on launch, forwards device token to backend. Notifications suppressed in foreground (WS handles it). Notification taps routed through `CompletedWorkspacesStore` which persists IDs in UserDefaults for cold-start bridging to `HubStatusMonitor`.
- **Single multiplexed hub WS**: `HubStatusMonitor.HubConnection` opens one WS to `/ws/hub` for all workspaces. Sends `sync_workspaces` on connect. Incoming `HubOutgoing` envelopes are demuxed by `workspaceId`. Hub-level events (status, diff_stats, branch_info) update monitor properties. ALL events are forwarded to the workspace's `ConversationStore` in the `ConversationStoreCache`.
- **Foreground reconnect**: on `scenePhase` change to active (2s debounce), forces WS reconnect. Streams cleared before reconnect. If bootstrap arrives with `streaming=false` for a previously-streaming workspace, treated as unread workspace activity without push.
- **ConversationStoreCache** (`@Environment`): app-level cache of `ConversationStore` instances keyed by workspace ID. Stores survive `ChatView` mount/unmount, preserving streaming state across navigation. Stores are eagerly created when streaming starts (even if ChatView isn't open). Evicted on workspace archive/delete.
- **Workspace conversation navigation**: `HiveApp` owns the Hub `NavigationPath`. Workspace rows push `WorkspaceConversationsView`; conversation rows append `SessionMetadata` to the path so the custom row UI stays free of the default List disclosure chevron.
- **ChatView receives its store as a parameter** from the cache (via `WorkspaceConversationsView`). No per-view WS — all sends go through `store.send` closure wired to the hub connection.
- **Turn-completed/unread badges**: `HubStatusMonitor.completedWorkspaces` tracks background `done` events at workspace level, while `unreadSessions` tracks per-session unread `done` and failed background `cancelled` events. Hub workspace rows show an accent unread dot when either workspace completion or unread sessions exist. Conversation rows show per-session streaming/unread state. `viewingWorkspaceId`/`viewingSessionId` prevent false positives when the relevant screen is visible.
- Tool rendering mirrors the frontend: same tool names, same icon mapping, same hierarchical display (parentToolUseId).
- Codex App Server `agent_activity` events are decoded and stored per streaming session. Activities are upserted by id, persisted into finalized `ChatMessage.agentActivities`, and routed to tool-call rendering, `TaskTracker`, or `AgentActivityList` depending on kind.
- Compatibility `tool_use` / `tool_result` events remain supported on iOS, but `MessageBubble` filters tool calls whose ids are already represented by an `AgentActivity` to avoid duplicate command/file rows.
- Late live fragments after `done`/`cancelled` must not recreate a ghost stream; `ConversationStore` only accepts live text/thinking/tool/activity/plan events when a stream slot already exists, and ignores late `tool_input_required` after a terminal assistant message.
- Unknown WS event types decode to `.unknown` instead of visible chat errors. Unknown agent activity kinds render as an unsupported activity row.
- AskUserQuestion renders as a paginated form sheet with multi-select support. Dismissed questions show "CANCELLED" badge.
- ExitPlanMode renders as a markdown preview with approve/reject actions.
- Chat drafts are persisted per-workspace and restored on app relaunch (includes `selectedModelId`, `thinkingLevel`).
- Deleting the active conversation must clear its `ConversationStore` state and either focus the next remaining session or clear focus when none remain.
- Model catalog is fetched dynamically from `/api/models`. Picker groups by provider, disables cross-provider items when session is locked.
- All providers supporting reasoning effort show a unified thinking-level cycler; the supported list comes from `capabilities.thinkingLevels` (Claude: low/medium/high/xhigh/max; Codex: none/minimal/low/medium/high/xhigh). Plan mode hidden for providers that don't support it.
- `lockedProvider` is read from WS status events (not REST) for instant model locking after first message.
- Pre-multi-model sessions default to `"claude"` when they have messages but no `lockedProvider`.
- PR status uses bulk endpoint matching the frontend. iOS keeps one shared `HubPrStatusDisplay` mapping so Hub rows and the workspace dashboard cannot drift.
- `#file` mentions highlighted with `AttributedString` in `MessageBubble` using accent color.
- Context ring matches frontend thresholds (green/yellow/red).
- Max 4 sessions enforced in `WorkspaceConversationsView`.

## Coding Rules

- TypeScript strict mode, ES modules.
- Use English for code/comments/UI copy.
- Keep backend routes testable by preserving optional `dataDir` injection.
- Keep state mutations serialized via workspace/project lock helpers.
- **Before completing any task, run tests (`npm test`) and typecheck (`npm run typecheck`) from the repo root to catch regressions. For iOS changes, also run `cd ios && swift test` and an Xcode simulator build when Swift/Xcode is available. Do not consider a task done until the relevant checks pass or the missing toolchain is explicitly reported.**

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
- Keep `NotificationEvent` variants in sync between `backend/src/notifications/types.ts` and all channels (Telegram, APNs).

## Testing

- Backend tests live next to source (`backend/src/**/*.test.ts`).
- Frontend tests live in `frontend/tests/**`.
- iOS Swift package tests live in `ios/Tests/**` and use Swift Testing.
- Use `SessionOptions.command = "bash"` in backend tests to avoid local Claude CLI dependency.
- WS tests use Fastify's `injectWS()` (not raw `new WebSocket()`) for deterministic message ordering.
- CI sets `NODE_ENV=test` explicitly to ensure React 19 exports `act()` in its development bundle.
- Current GitHub CI covers Node workspaces; iOS test/build validation is local unless the workflow is extended.

## Tauri Desktop App

- Tauri v2 config: `frontend/src-tauri/tauri.conf.json`
- Icons: `frontend/src-tauri/icons/` (generated via `npx tauri icon <source.png>`)
- macOS icons require pre-baked squircle corners (macOS does not auto-mask like iOS).
- Icons are compiled into the Rust binary; after changing icons run `cargo clean` in `src-tauri/` then rebuild.
- Vite config (`frontend/vite.config.ts`) includes Tauri-specific settings (fixed port, HMR, build targets).
- Sidebar collapse: CSS var `--traffic-light-clearance` (76px) provides clearance for macOS traffic lights. Tauri fullscreen detection resets to 0.
- **HTML5 drag & drop inside the webview**: `dragDropEnabled` is set to `false` on the window in `tauri.conf.json`. When left at its default (`true`), Tauri's OS-level file-drop handler intercepts drag events before they reach the DOM — `dragstart` still fires but `dragover`/`drop` never do, which breaks in-app DnD (e.g. sidebar project folders reordering). The tradeoff: dropping files from Finder/Explorer onto the Hive window is disabled. If we later need OS file-drop for a feature, options are: (a) re-enable `dragDropEnabled` and migrate in-app DnD to pointer-event-based libs like `@dnd-kit/core` which aren't affected by the OS handler, or (b) keep it disabled and use a Tauri dialog / OS picker for file selection instead.

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
- Codex/Gemini provider integrations are functional but less battle-tested than Claude. Stream adapter edge cases may surface.
- No Codex session resume verification (thread ID persistence is best-effort).
- No iOS UI for automations or prompt templates yet (types added, UI not implemented).
- No live WS streaming for automation runs (frontend uses REST polling only).

## Automation — Future Milestones

### GitHub Event Automations (M3)
- Webhook receiver endpoint: `POST /api/webhooks/github`
- GitHub sends PR/issue events -> match against automations with `trigger.type === "github_event"`
- `AutomationTrigger` union needs `{ type: "github_event"; events: string[] }` variant
- Context enrichment: fetch PR diff/description via `gh` CLI, inject into user prompt
- Template variables: `{{pr_url}}`, `{{pr_title}}`, `{{pr_diff}}`, `{{issue_url}}`, etc.
- Agent output -> post as GitHub comment via `gh pr review` or `gh issue comment`
- Requires: webhook secret validation, event deduplication, rate limiting

### Script Automations (M4)
- `AutomationAction` union needs `{ type: "script"; command: string }` variant
- Reuse `scriptRunner.startScript()` + `exitListeners` pattern
- Script output capture for notifications

### Advanced Features
- Automation chaining: trigger type `automation_complete` (run B after A finishes)
- Concurrency limits: semaphore for max parallel automation runs
- Live WS streaming: add `sync_automations` hub subscription for real-time run output
- Retry policy: configurable retry count on failure

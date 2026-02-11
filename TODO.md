# Hive — TODO

## Bugs & Fixes (do first)

- [ ] **Merge fix branch into main** — all recent fixes are on `fix/empty-json-body`, need to merge and clean up
- [ ] **Sidebar doesn't refresh after workspace creation** — creating a workspace from ProjectView updates local state but Sidebar still shows stale project data (no refetch)
- [ ] **Agent status polling** — UI has no way to know when an agent finishes unless the WebSocket stream is open. If you navigate away and come back, workspace still shows "running" until page refresh
- [ ] **AgentHistory "View" button is a placeholder** — clicking "View" shows `"Agent output would be streamed here from logs"` instead of actual log content. Need an API endpoint to serve log file content
- [ ] **Terminal output lost on page navigation** — if you leave the workspace page and come back, the xterm terminal is empty. Output only comes from live WebSocket, no replay from log
- [ ] **DiffViewer untested end-to-end** — the component exists but hasn't been validated with a real diff from the backend
- [ ] **No error boundaries** — any component crash (like the Sidebar one we hit) takes down the entire app. Add React error boundaries
- [ ] **No toast/notification system** — errors silently fail or crash. Need user-facing feedback for create/delete/merge actions

## Core Features (functional product)

### Backend

- [ ] **GET /api/agents/:agentId/logs** — new endpoint to serve agent log file content (paginated or streamed). The frontend needs this for history replay and reconnection
- [ ] **Agent output replay on WS connect** — when a client connects to an already-running agent's stream, send buffered output first (or read from log file), then switch to live. Right now you miss everything emitted before connection
- [ ] **Workspace status auto-update** — after an agent finishes, the workspace status changes to "idle" in state.json. But the frontend doesn't know unless it polls. Consider: SSE events for state changes, or a simple polling endpoint
- [ ] **Git fetch on project** — the `POST /api/projects/:id/fetch` endpoint exists but there's no UI to trigger it. Workspaces created after a fetch should be up to date with remote
- [ ] **Handle merge conflicts** — `mergeWorkspace` does a simple `git merge` which will fail on conflicts. Need to detect conflicts and report them to the user instead of a generic 500
- [ ] **Agent environment variables** — allow passing env vars to the claude process (API keys, custom configs). Store per-project or per-workspace
- [ ] **Graceful shutdown** — when the backend stops, running agents should be killed cleanly and their state saved as "error" or "interrupted"
- [ ] **Process recovery on restart** — if the backend crashes while agents are running, state.json still says "running" but the processes are gone. On startup, detect orphaned "running" agents and mark them as "error"

### Frontend

- [ ] **Auto-refresh workspace/agent status** — poll `GET /api/workspaces/:wsId` every few seconds while an agent is running, stop when idle. Update Sidebar accordingly
- [ ] **Reconnect to agent stream** — if the page was closed or navigated away, reconnect to the WebSocket and load past output from log endpoint
- [ ] **Load agent logs in history** — when clicking "View" on a past agent, fetch `GET /api/agents/:agentId/logs` and render in a terminal or pre block
- [ ] **Trigger git fetch from UI** — button on project page to fetch latest from remote
- [ ] **Show merge result** — after merge, show success message and redirect to project view. Handle merge failure (conflict) gracefully with error message
- [ ] **Diff viewer: handle empty diff** — when there are no changes, show a clear "No changes" message instead of an empty diff
- [ ] **Stop agent confirmation** — add confirmation dialog before stopping an agent
- [ ] **Workspace rename** — ability to give a workspace a custom name (alias) alongside the city name

## UX & Polish

- [ ] **Dark/light mode toggle** — Tailwind v4 supports dark mode, shadcn has dark theme, just need a toggle in the header
- [ ] **Home page** — root `/` currently shows nothing. Show a dashboard: list of projects, active agents across all workspaces, recent activity
- [ ] **Agent elapsed time** — show a running timer while agent is active ("Running for 2m 34s"), show total duration in history
- [ ] **Better terminal colors** — xterm.js supports full ANSI colors, make sure Claude's colored output renders correctly (bold, colors, links)
- [ ] **Terminal scrollback** — increase terminal scrollback buffer for long agent outputs
- [ ] **Responsive layout** — sidebar should collapse on mobile, or use a drawer/sheet
- [ ] **Keyboard shortcuts** — `Ctrl+Enter` to launch agent, `Escape` to close dialogs
- [ ] **Favicon** — add a proper favicon
- [ ] **Loading states** — show spinners/skeletons for all async actions (merge, delete, fetch)
- [ ] **Empty states** — better empty state illustrations for "no projects", "no workspaces", "no agents"
- [ ] **Copy prompt to clipboard** — in agent history, allow copying the prompt text
- [ ] **Agent prompt templates** — save frequently used prompts (e.g. "review all changes in this workspace", "write tests for recent changes")
- [ ] **Workspace status indicator in tab title** — `(running) tokyo — Hive` so you can see status from browser tabs

## Infrastructure & Deployment

- [ ] **Caddyfile** — create a production Caddyfile with HTTPS, basic auth, static file serving for frontend, reverse proxy for backend/ws
- [ ] **Process manager** — systemd service file or pm2 ecosystem config to keep backend running and auto-restart on crash
- [ ] **Frontend production build** — wire up `npm run build` in frontend, serve `dist/` via Caddy
- [ ] **Environment config** — `.env.example` file documenting all env vars
- [ ] **Log rotation** — agent log files grow indefinitely. Add rotation or max size per log, or cleanup old logs periodically
- [ ] **Disk usage monitoring** — worktrees + bare repos + logs can fill disk. Add a `GET /api/system/status` endpoint showing disk usage
- [ ] **Backup strategy** — state.json files are the source of truth. Periodic backup or git commit of state
- [ ] **Dedicated system user** — run agents as a non-root user with restricted filesystem access
- [ ] **Rate limiting** — prevent accidental spam (launching 50 agents at once)

## Security

- [ ] **Auth layer** — Caddy basic auth for MVP. Consider upgrading to token-based auth later
- [ ] **Tailscale alternative** — document VPN-based access as an alternative to public auth
- [ ] **Sanitize git URLs** — validate repo URLs before cloning (prevent `file://`, local paths, or command injection via crafted URLs)
- [ ] **Agent sandboxing** — consider running agents with limited filesystem access (only their worktree, not the whole VPS)
- [ ] **Secret management** — if agents need API keys or tokens, don't store them in state.json. Use env vars or a separate encrypted store

## Ideas & Future

- [ ] **Interactive mode** — switch from `claude -p` (fire-and-forget) to interactive mode where the user can chat with the agent mid-task via the terminal
- [ ] **Agent chaining** — auto-launch a review agent when a code agent finishes (configurable per workspace)
- [ ] **Multi-model support** — allow choosing the model (claude opus, sonnet, haiku) per agent launch. Pass `--model` flag
- [ ] **Cost tracking** — parse Claude's output for token usage, track cost per agent/workspace/project
- [ ] **File explorer** — browse workspace files from the UI without SSH. Read-only tree view with syntax highlighting
- [ ] **Git graph** — visual branch graph showing workspace branches vs main
- [ ] **Notifications** — browser notifications when an agent finishes (useful when running multiple workspaces)
- [ ] **Webhook integration** — POST to a URL when an agent finishes (Slack, Discord, etc.)
- [ ] **Project templates** — pre-configured prompts and workflows per project type (e.g. "Node.js project" → lint + test after agent)
- [ ] **Agent presets** — saved prompts with variables: "Review PR #{number}", "Fix issue #{title}"
- [ ] **Workspace snapshots** — save/restore workspace state before/after an agent run (git stash or tagged commits)
- [ ] **Parallel agent view** — dashboard showing all active agents across all projects side-by-side, like a multi-terminal
- [ ] **Mobile-friendly view** — read-only mobile UI to monitor agent progress on the go
- [ ] **Import from GitHub Issues** — pull issue description as the agent prompt, link agent output back to the issue
- [ ] **Auto-PR creation** — after merge, optionally push to remote and create a PR via GitHub API
- [ ] **CLAUDE.md per project** — store project-specific CLAUDE.md that gets injected into every agent's context for that project
- [ ] **Agent retry** — re-run a failed agent with the same prompt (one click)
- [ ] **Diff annotations** — allow adding comments to specific lines in the diff viewer before merging

# Configuration

## Backend environment variables

This table is the single source of truth for backend environment variables; the other documents
point at it rather than repeating it.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | Backend HTTP port |
| `DATA_DIR` | `~/.hive` | Root storage for projects, workspaces, sessions, prompts, Brain, config, and automations |
| `HIVE_BACKEND_VERSION` | release artifact's `VERSION`, otherwise `dev` | Explicit backend version. The manual PM2 configuration derives it from the canonical version of the checked-out source; provisioned releases deliberately use the artifact instead |
| `HIVE_UPDATE_METHOD` | `manual` | Server update ownership. Only the exact value `provisioner` enables the app's provisioner-driven update flow; missing and other values remain manual |
| `HIVE_AUTH_TOKEN` | unset | Access token in plaintext. Requires bearer/token auth for API and WS when set; `/health` stays public |
| `HIVE_AUTH_TOKEN_SHA256` | unset | The same token as a lowercase hex SHA-256 digest, so the plaintext never lands on the server. What `provision.sh` writes. A request authorizes if it matches either form |
| `HIVE_ALLOWED_HOSTS` | unset | Extra hostnames accepted by the `Host` guard, comma-separated. IP literals and `localhost` are always accepted; anything else gets `403` until listed. The guided installer adds its selected address automatically |
| `HIVE_ALLOWED_ORIGINS` | unset | Extra browser origins accepted for CORS and WebSocket upgrades, comma-separated. The desktop webview's origins are always accepted, plus `localhost:5173` outside production |
| `HIVE_RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `HIVE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `HIVE_AUTOMATION_TIMEOUT_SEC` | `1800` | Per-run timeout for scheduled automations |
| `HIVE_CLAUDE_SKIP_PERMISSIONS` | `true` | Controls Claude `--dangerously-skip-permissions` |
| `HIVE_DEBUG_AGENT_LOGS` | unset | Verbose agent process logging when `1`/`true`/`yes`/`on` |
| `GITHUB_CLIENT_ID` | built in | Override GitHub OAuth app client id |

**With neither `HIVE_AUTH_TOKEN` nor `HIVE_AUTH_TOKEN_SHA256` set, the backend starts only on a
loopback address, where requests are accepted without authentication.** The production PM2
configuration binds `0.0.0.0` and sets neither variable, so it refuses to start until you provide
one. `provision.sh` generates a token, writes only its digest, and refuses to finish a run in which
an unauthenticated request to `/api/projects` does not return `401`.

## Frontend environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | derived from browser location | Override WS base URL |

## Everything else is in the UI

Connection host, port, access token, SSH user, Telegram, theme, accent color, CLI status,
prompt settings, instructions, skills, Team agents, and subagents are configured **in the UI**.

Agent and GitHub accounts are connected **in the UI** too, with no terminal: Settings → Harness
signs in Claude Code and Codex, Settings → Account signs in GitHub. Each is a browser
confirmation — GitHub and Codex use device codes, Claude opens a page and takes an authorization
code back. Connecting either Claude or Codex is enough to run sessions; nothing requires both.

## Production backend (pm2)

The backend ships `backend/ecosystem.config.cjs` for pm2:

| Environment | Host | Port | Data dir | Update method |
|---|---:|---:|---|---|
| `production` | `0.0.0.0` | `9420` | `~/.hive` | `manual` |
| `development` | `127.0.0.1` | `3000` | `~/.hive-dev` | `manual` |

```bash
cd backend
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 logs hive-backend
```

The PM2 configuration reports the canonical release version of the checked-out source and marks
the backend as manually managed. It never offers the provisioner update flow.

The full manual setup, including token configuration and auth verification, is in
**[Manual Installation](manual-installation.md)**.

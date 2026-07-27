# Getting Started: Remote Backend + Tauri Desktop

This guide covers deploying the Hive backend on a VPS and connecting to it from a Tauri desktop client over Tailscale.

## Architecture

```text
+------------------+          Tailscale          +------------------+
|  Your Mac        | <--- 100.x.x.x private --> |  VPS             |
|  Tauri app       |         network             |  Hive backend    |
|  (frontend only) |                             |  (Fastify + CLI) |
+------------------+                             +------------------+
```

The backend runs on a VPS where Claude CLI, Git, GitHub CLI, and all heavy operations happen. The frontend runs locally as a Tauri desktop app and connects to the backend over a Tailscale private network. No ports are exposed to the public internet.

## 1. Install Tailscale

### On the VPS (Linux)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Copy the auth link from the terminal output and open it in your browser.

### On your Mac

Install from the Mac App Store (search "Tailscale") or via Homebrew:

```bash
brew install tailscale
brew services start tailscale
tailscale up
```

Log in with the same Tailscale account.

### Verify connectivity

On both machines, get the Tailscale IP:

```bash
tailscale ip -4
```

From your Mac, ping the VPS:

```bash
ping 100.x.x.x
```

## 2. Deploy the Backend on the VPS

### Prerequisites

The backend runs preflight checks on startup. It exits with a clear error if a required dependency is missing; optional dependencies only disable related features:

- **Node.js >= 20**
- **Git >= 2.17** (worktree support)
- **Claude CLI** installed and authenticated (`claude` command)
- **GitHub CLI** (`gh`) installed (startup preflight requirement; authenticate it before GitHub-backed flows)
- **Codex CLI** (`codex`) optional for OpenAI model support

### Clone and build

```bash
git clone <repo-url> hive
cd hive
npm install
cd backend
npm run build
```

### Run with PM2

```bash
npm install -g pm2
```

Start the backend, binding to the Tailscale interface only (replace with your VPS Tailscale IP):

```bash
HOST=100.x.x.x pm2 start dist/index.js --name hive-backend --update-env
```

This ensures the backend is only accessible from your Tailscale network, not from the public internet.

Make it persistent across reboots:

```bash
pm2 save
pm2 startup
```

The `pm2 startup` command prints a `sudo ...` line to copy-paste and execute.

### Verify

From your Mac:

```bash
curl http://100.x.x.x:3000/api/projects
```

### Useful PM2 commands

```bash
pm2 logs hive-backend      # live logs
pm2 restart hive-backend    # restart
pm2 status                  # all processes
```

### Troubleshooting

If the backend still shows `Server listening at http://127.0.0.1:3000` in the logs, the `HOST` env var was not picked up. Delete and recreate:

```bash
pm2 delete hive-backend
HOST=100.x.x.x pm2 start dist/index.js --name hive-backend --update-env
```

If you can ping the VPS but not curl the API, check `sudo ufw status`. If UFW is active and blocking, allow Tailscale traffic:

```bash
sudo ufw allow in on tailscale0
```

This is not required when binding to the Tailscale IP directly.

## 3. Connect the Frontend

### Browser (quick test)

Run the frontend locally:

```bash
cd frontend
npm run dev
```

Open the app and go to **Settings > Connection**. Enter your VPS Tailscale IP (e.g. `100.x.x.x`) and port (`3000`). The status badge will show **Connected** (green) once the health check succeeds. All API and WebSocket traffic routes through Tailscale.

### Tauri Desktop App

```bash
cd frontend
npm run tauri dev
```

Same as above: configure the Tailscale IP and port in **Settings > Connection**.

To build a distributable app:

```bash
cd frontend
npm run tauri build
```

The output (`.dmg` on macOS, `.msi` on Windows) will be in `frontend/src-tauri/target/release/bundle/`.

### Post-connect setup (optional)

Once connected, you can configure additional integrations from the app:

- **Settings > Account** — Connect your GitHub account via OAuth device flow. This authenticates the `gh` CLI on the VPS and configures git credentials, enabling PR status detection and authenticated cloning.
- **Settings > Notifications** — Enable Telegram notifications to receive alerts when an agent turn completes. Enter your bot token and chat ID, then hit "Test" to verify.
- **Settings > Projects > Environment** — Configure project-level environment variables. Hive stores structured variables locally and generates a workspace `.env` only when a project has variables.

## Environment Variables Reference

### Backend (VPS)

| Variable | Recommended Value | Description |
|---|---|---|
| `HOST` | `100.x.x.x` (Tailscale IP) | Bind to Tailscale interface only |
| `PORT` | `3000` | HTTP port |
| `HIVE_AUTH_TOKEN` | a strong random string | Secures API + WS access |

### Frontend (local)

The frontend needs no environment variables for the connection. Host, port and the access token
(which must match the backend `HIVE_AUTH_TOKEN`) are entered at runtime in **Settings > Connection**
and stored as a single connection record, so changing the token never requires a rebuild. Telegram notification credentials are configured in **Settings > Notifications** and persisted in `~/.hive/config.json` on the VPS.

## Updating the Backend

```bash
cd hive
git pull
cd backend
npm install
npm run build
pm2 restart hive-backend
```

## Updating App Icons

Generate all platform icons from a source PNG (1024x1024 recommended, with macOS squircle corners pre-baked):

```bash
cd frontend
npx tauri icon /path/to/icon.png
cd src-tauri && cargo clean
```

The `cargo clean` is required because icons are embedded in the Rust binary at compile time.

# Getting Started: Hive on a Server

Hive runs a backend on a server you own and talks to it from the desktop app, a browser, or the iOS
client. This guide covers the three ways to get that backend running, and how to connect a client to
it.

> [!WARNING]
> Hive does not provide HTTPS yet. Never expose port 9420 directly to the
> public Internet. Connect only through an encrypted private network such as
> Tailscale, WireGuard, or another VPN. The access token is sent over HTTP and
> WebSocket and can be intercepted on an untrusted network.

Read **[docs/prerequisites.md](docs/prerequisites.md)** first — supported operating systems, what
access the installer needs, and exactly what it will and will not change on a server that is already
running other software.

Environment variables are documented once, in the README's
**[Configuration](README.md#configuration)** section. This guide points at that table rather than
repeating it.

```text
+------------------+                             +------------------+
|  Your machine    |                             |  Server          |
|  Desktop app     | -- the address that ---->   |  Hive backend    |
|  (frontend only) |    reaches the server       |  (Fastify + CLI) |
+------------------+                             +------------------+
```

The server does the work: agent CLIs, git, worktrees, sessions. The client is a view onto it. Hive
does not configure networking or HTTPS; establish an encrypted private network before setup and use
the server's private address. See **[docs/networking.md](docs/networking.md)**.

## Which path

| | |
|---|---|
| **[Guided installer](#1-guided-installer-desktop)** | Desktop app. Screen by screen, no terminal. The normal path. |
| **[`provision.sh`](#2-provisionsh-from-a-terminal)** | Same installer, run from a shell on the server. |
| **[Manual install](#3-manual-install)** | Build from source and run it yourself. |

The first two produce an identical server: a pinned private Node.js runtime, the agent CLIs, the
backend under systemd on port 9420, and an access token that is enforced before the run reports
success.

## 1. Guided installer (desktop)

Build and launch the desktop app:

```bash
git clone https://github.com/unfence-labs/hive.git
cd hive
npm install
cd frontend
npm run tauri dev              # or: npm run tauri build
```

With no server configured, the installer opens by itself. With one configured, open it from
**Settings → Server → Install Hive on a server**.

The screens, in order:

1. **Welcome to Hive.** Either start the install, or point the app at a server that already exists
   by entering its address, port and access token. The second is the skip.
2. **Connect to your server.** The SSH address that reaches it (`host`, or `user@host` to log in as
   something other than root) and the key — keys under `~/.ssh` are scanned and the first usable
   one auto-selected; a passphrase-protected key is marked unusable unless an agent holds it (run
   `ssh-add <path>` and rescan). The key you pick is also the key authorized on the service
   account, so editor and terminal sessions connect as `hive`. *Advanced* exposes the Hive port and
   the install and data directories. You are not asked how the server is reachable. **Connect**
   then proves the form: Hive reaches the server, shows its host key fingerprint for approval on
   first contact, runs the installer's own read-only preflight over that connection and lists every
   finding. Blocking findings name the field on this same screen that fixes them, and editing any
   field discards the check. An active `ufw` is configured automatically during installation; an
   active firewall Hive cannot configure blocks here instead of producing an unreachable install.
   If the account needs a `sudo` password, this is where it is asked for. Nothing on the server is
   changed by this step.
3. **Ready to install.** The settled plan, restated. This is the last screen where going back is
   free.
4. **Installing Hive.** A live checklist and the raw output. Closing the installer or interrupting
   SSH stops the current local run. Each completed server step is recorded, so reopening or pressing
   Retry resumes an incomplete install when the port, install directory, and data directory still
   match the original run exactly.
5. **Connect your accounts.** The server is up. Copy the access token, connect GitHub, and
   authenticate at least one of Claude Code or Codex. The ordinary app stays gated on this screen,
   including after a relaunch, until all three requirements are complete. The same controls remain
   available later in **Settings → Account** and **Settings → Harness**.

When the install succeeds the app stores the connection itself — address, port, the plaintext
generated access token, and `hive` as the SSH user for editor and terminal sessions — in its local
connection record. The Accounts screen is the only UI that reveals that token. Later Connection
settings accept a replacement token but do not reveal the stored value.

## 2. `provision.sh` from a terminal

Every release publishes `provision.sh` next to the backend tarballs. Run it as root on the server:

```bash
curl -fsSL https://github.com/unfence-labs/hive/releases/latest/download/provision.sh | bash
```

Look before you commit — this changes nothing and always exits 0:

```bash
curl -fsSL https://github.com/unfence-labs/hive/releases/latest/download/provision.sh | bash -s -- --preflight
```

Options are passed through `bash -s --`. The common path, port, and SSH-key flags also have
environment-variable equivalents. The full table is in the README's
**[Install on a server](README.md#install-on-a-server)** section.

```bash
curl -fsSL <url>/provision.sh | bash -s -- \
  --port 9420 --install-dir /srv/hive --data-dir /mnt/hive \
  --ssh-public-key "$(cat ~/.ssh/id_ed25519.pub)"
```

Progress is NDJSON, one record per line. **The access token appears exactly once, on that stream**,
on the `generate_token` step — it is never written to the log file, and only its SHA-256 digest is
stored on the server. The server cannot recover the plaintext token. Every fresh or resumed
incomplete run generates a new token, so keep the value printed by the run that completes:

```text
{"v":1,...,"step":"generate_token","status":"ok",...,"data":{"accessToken":"<64 hex characters>"}}
```

Pass `--ssh-public-key` unless you have a reason not to. The service account owns every repository
and worktree; an editor or terminal session that connects as root instead silently takes ownership
of every file it saves, after which the agent can no longer write them.

The run ends by proving the token is enforced: an unauthenticated request to `/api/projects` must
return `401`. If it does not, the script stops the service and fails the run.

A fresh install writes a non-secret identity manifest containing its schema, port, install
directory, and data directory. An interrupted install resumes only with those exact values. A
completed install rejects another provisioning run because V1 does not support updates. To change
the port or either path, uninstall and perform a fresh install. The uninstaller keeps the data
directory unless you pass `--purge`.

## 3. Manual install

For a server you want to build from source and run yourself.

### Dependencies

The backend runs a startup preflight and exits if a required dependency is missing:

- **git** ≥ 2.17 — required
- **Claude CLI** (`claude`), installed and authenticated — required
- **GitHub CLI** (`gh`) — required at startup; authenticate it before GitHub-backed flows
- **Codex CLI** (`codex`) — optional; only its provider features depend on it
- **Node.js** ≥ 20

### Build

```bash
git clone https://github.com/unfence-labs/hive.git hive
cd hive
npm install
cd backend
npm run build
```

### Configure the access token

**Set a token.** With neither `HIVE_AUTH_TOKEN` nor `HIVE_AUTH_TOKEN_SHA256` configured, the backend
has no expectation to check against and accepts every request. `backend/ecosystem.config.cjs` does
not set either one, so a bare `pm2 start ecosystem.config.cjs --env production` produces an
unauthenticated server.

Generate one:

```bash
openssl rand -hex 32
```

Then configure it in one of two forms. Both are accepted, and a request authorizes when it matches
either:

| Variable | Value | Use it when |
|---|---|---|
| `HIVE_AUTH_TOKEN` | the token itself | Simplest. The plaintext sits in the environment. |
| `HIVE_AUTH_TOKEN_SHA256` | its lowercase hex SHA-256 | Keeps the plaintext off the server. This is what the guided installer writes. |

```bash
printf '%s' "<token>" | sha256sum      # produces the digest form
```

Clients present the token as `Authorization: Bearer <token>`, as an `x-hive-token` header, or as
`?token=<token>` on the query string. `/health` is always public.

### Run

```bash
cd backend
HIVE_AUTH_TOKEN_SHA256=<digest> pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup      # prints a `sudo ...` line to copy-paste
pm2 logs hive-backend
```

`--env production` binds `0.0.0.0:9420` with `DATA_DIR=~/.hive`. Use `--env development` for
`127.0.0.1:3000` and `~/.hive-dev`. Both are in the README
[Configuration](README.md#configuration) section.

### Verify that auth is actually on

This is the check that matters, and the reason to do it with `-w '%{http_code}'`: a plain `curl`
against a working server looks the same whether or not the token is enforced.

```bash
# Must print 401. Anything else means the server is open.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9420/api/projects

# Must print 200.
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <token>" \
  http://127.0.0.1:9420/api/projects
```

### If the client is a browser or a custom hostname

Two guards sit in front of everything but `/health`, and both are on by default:

- **Host header.** IP literals and `localhost` are accepted. Reaching the server through a DNS name
  returns `403 Forbidden host` until that name is listed in
  `HIVE_ALLOWED_HOSTS` (comma-separated).
- **Browser origin.** CORS and WebSocket upgrades accept the desktop webview's own origins, plus
  `http://localhost:5173` and `http://127.0.0.1:5173` outside production. A web build served from
  any other origin returns `403 Forbidden origin` until that origin is listed in
  `HIVE_ALLOWED_ORIGINS` (comma-separated). Native clients send no `Origin` header and are
  unaffected.

The guided installer adds the selected address to `HIVE_ALLOWED_HOSTS` automatically. A manual
`provision.sh` install can do the same with `--allowed-host`.

### Update a manual install

```bash
cd hive
git pull
npm install
cd backend
npm run build
pm2 restart hive-backend
```

## Connect a client

### Desktop app

**Settings → Connection**: host, port, access token, and the SSH user for editor and terminal
sessions (`hive` on a provisioned server — not the admin login you installed with). The status badge
distinguishes the failures: *Token rejected* means the server answered and refused the token,
*Client refused* means it refused this client (see the two guards above), *Unreachable* means it did
not answer at all.

The guided installer fills all of this in for you. Its successful install stores the plaintext
token in the local connection record. This form is write-only for the token: it accepts a
replacement but never reveals the stored value.

### Browser

```bash
cd frontend
npm run dev                    # → http://localhost:5173
```

Same **Settings → Connection** form. For a build served from somewhere other than the Vite dev
server, set `HIVE_ALLOWED_ORIGINS` on the backend.

### iOS

The iOS client uses the same host, port and access token, entered in its first-run onboarding.

### Package the desktop app

```bash
cd frontend
npm run tauri build
```

The bundle (`.dmg` on macOS, `.msi` on Windows) lands in
`frontend/src-tauri/target/release/bundle/`.

## After connecting

- **Settings → Harness** — install, update and sign in to Claude Code and Codex, with no
  terminal. Codex uses a device code; Claude opens a page and takes an authorization code
  back. Either one is enough to run sessions. GitHub connects from **Settings → Account**.
- **Settings → Notifications** — Telegram bot token and chat id, with a Test button. Stored in
  `$DATA_DIR/config.json` on the server.
- **Settings → Projects → Environment** — project-level environment variables. Hive writes a
  workspace `.env` only for projects that have any.

## Uninstall

A provisioned server carries its own uninstaller, generated with the paths that install actually
used:

```bash
sudo /opt/hive/hive-uninstall.sh            # remove Hive, keep your data
sudo /opt/hive/hive-uninstall.sh --purge    # remove your data as well
```

## Troubleshooting

**The install stopped.** The panel names a typed error code and the failing output. Press Retry with
the same port, install directory, and data directory: the script resumes from the completed server
steps. A different identity is rejected. Failures that a form field can fix say which field.

**`401` from a server you believe is configured.** Use the token reported by the run that completed
the install. The server keeps only its digest and cannot recover the plaintext. A completed V1
install cannot be reprovisioned to rotate it; uninstall and perform a fresh install instead.

**`403 Forbidden host` / `403 Forbidden origin`.** See
[the two guards](#if-the-client-is-a-browser-or-a-custom-hostname).

**Reachable by ping but not by HTTP.** Check external routing first. The installer automatically
opens Hive's port when `ufw` is active, but it cannot change a cloud security group, router, NAT, or
VPN policy:

```bash
sudo ufw status
sudo ufw status numbered
```

**Service state on a provisioned server.**

```bash
systemctl status hive
journalctl -u hive -f
```

## Updating app icons

Generate all platform icons from a source PNG (1024x1024 recommended, with macOS squircle corners
pre-baked):

```bash
cd frontend
npx tauri icon /path/to/icon.png
cd src-tauri && cargo clean
```

The `cargo clean` is required because icons are embedded in the Rust binary at compile time.

# Manual Installation

Use this guide when you want to build Hive from source and manage its runtime, authentication, and
process yourself. For the normal setup, use the desktop app instead.

Read **[Prerequisites](prerequisites.md)** and **[Networking](networking.md)** before continuing.
All backend environment variables are documented in **[Configuration](configuration.md)**.

## Dependencies

The backend runs a startup preflight and exits if a required dependency is missing:

- **Node.js** 20 or newer
- **Git** 2.17 or newer
- **Claude CLI** (`claude`), installed and authenticated
- **GitHub CLI** (`gh`), installed and authenticated for GitHub-backed flows
- **PM2** for the documented production process
- **Codex CLI** (`codex`), optional and required only for its provider features
- **agent-browser** (`agent-browser`), optional — powers the live browser panel and agent-driven UI
  checks; run `agent-browser install` once (`--with-deps` on Linux) to download its Chrome build

Install PM2 if it is not already available:

```bash
npm install --global pm2
```

## Build

```bash
git clone https://github.com/unfence-labs/hive.git
cd hive
npm install
cd backend
npm run build
```

## Configure the access token

Set an access token before starting the backend. With neither `HIVE_AUTH_TOKEN` nor
`HIVE_AUTH_TOKEN_SHA256` configured, the backend starts only on a loopback address, where requests
are accepted without authentication. The production PM2 configuration binds `0.0.0.0` and sets
neither variable, so it refuses to start until you provide one.

Generate a token:

```bash
openssl rand -hex 32
```

Configure it in one of two forms:

| Variable | Value | Use it when |
|---|---|---|
| `HIVE_AUTH_TOKEN` | The token itself | The simplest setup; the plaintext remains in the environment |
| `HIVE_AUTH_TOKEN_SHA256` | Its lowercase hexadecimal SHA-256 digest | You do not want the plaintext token stored on the server |

Generate the digest without adding a newline:

```bash
printf '%s' "<token>" | sha256sum
```

Keep the original plaintext token. Clients present it as an `Authorization: Bearer <token>` header,
an `x-hive-token` header, or a `?token=<token>` query parameter. The `/health` endpoint is always
public.

## Run

Start the production process with the token or digest in its environment:

```bash
cd backend
HIVE_AUTH_TOKEN_SHA256=<digest> pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
pm2 logs hive-backend
```

`pm2 startup` prints a command that must be run with root privileges to start PM2 after a reboot.

The production configuration binds `0.0.0.0:9420` and stores data under `~/.hive`. The development
configuration binds `127.0.0.1:3000` and stores data under `~/.hive-dev`.

## Verify authentication

An unauthenticated request must return `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:9420/api/projects
```

The same request with the plaintext token must return `200`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:9420/api/projects
```

Do not expose or use the backend if the first request returns anything other than `401`.

## Allow a custom hostname

IP literals and `localhost` are accepted by default. Requests through any other hostname return
`403 Forbidden host` until the hostname is added to the comma-separated `HIVE_ALLOWED_HOSTS`
environment variable.

```bash
HIVE_ALLOWED_HOSTS=hive.example.internal
```

## Allow a browser frontend

CORS and WebSocket upgrades accept the desktop app origins by default. Outside production, they
also accept `http://localhost:5173` and `http://127.0.0.1:5173`.

A web frontend served from another origin returns `403 Forbidden origin` until its complete origin
is added to the comma-separated `HIVE_ALLOWED_ORIGINS` environment variable:

```bash
HIVE_ALLOWED_ORIGINS=https://hive.example.internal
```

Native clients do not send an `Origin` header and are unaffected.

## Update a manual installation

This procedure applies only to a source checkout that you manage yourself. It does not update a
backend installed by `provision.sh`; provisioned V1 installations deliberately reject in-place
updates.

Back up the configured data directory before changing versions. Build the new version before
restarting the running process, and keep the previous tag available for rollback.

```bash
cd hive
git fetch --tags --prune
git checkout v<version>
npm ci
cd backend
npm run build
pm2 restart hive-backend
```

Repeat the authenticated and unauthenticated checks above after restart. If either check fails,
check out the previous tag, run `npm ci` and `npm run build` again, then restart the process.

## Connect a client

Enter the server address, port, and plaintext access token in the client. For desktop editor and
terminal sessions, also provide the SSH user that owns the repositories and workspaces.

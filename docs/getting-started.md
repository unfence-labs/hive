# Getting Started

Hive separates the machine doing the work from the client controlling it. The backend, agent
harnesses, repositories, workspaces, and sessions run in one Linux environment. The desktop, web,
and iOS clients connect to that backend.

> [!WARNING]
> Hive does not provide HTTPS yet. Never expose port 9420 directly to the
> public Internet. Connect only through an encrypted private network such as
> Tailscale, WireGuard, or another VPN. The access token is sent over HTTP and
> WebSocket and can be intercepted on an untrusted network. See
> **[Networking](networking.md)**.

## 1. Choose where Hive will run

You need a supported Linux environment with root privileges:

- **Remote VPS** — The recommended target when you want agents and automations to keep running
  after you close Hive or shut down your computer.
- **Local VM** — A good target for local development or a private setup on your own machine. Hive
  remains available only while the host and VM are running. On macOS, the
  **[OrbStack guide](install-flow-orbstack.md)** walks through the real installer flow with an
  Ubuntu VM.

The backend is the source of truth in both cases. Clients do not need a local checkout, agent CLI,
or development environment.

## 2. Check the prerequisites

Read **[Prerequisites](prerequisites.md)** before installing. The page covers supported
distributions and architectures, root access, SSH requirements, disk space, the backend port, and
every host change made by the automatic installer.

Set up an encrypted private path between your clients and the server before installation. Hive does
not configure a VPN or HTTPS. See **[Networking](networking.md)**.

## 3. Install the backend

The guided desktop installer and the terminal provisioner run the same script and produce the same
server layout and systemd service. Choose whichever fits how you work.

### From the desktop app

The distributed desktop app supports Apple Silicon Macs running macOS 14 or later. Intel builds are
not published. Download the latest stable DMG, or an explicitly selected prerelease, from
[GitHub Releases](https://github.com/unfence-labs/hive/releases), open it, and drag Hive to
Applications. The app then checks for new stable releases and offers to install them: accepting
downloads the update and restarts Hive. Prerelease builds are not offered automatically; update
those by installing a newer DMG from the same page.

The desktop app installs Hive on a server itself, over SSH, with no terminal. With no server
configured it opens on launch; otherwise it is under **Settings → Server → Install Hive on a
server**.

It walks through giving the address and port, picking an SSH key from `~/.ssh`, approving the
server's host key fingerprint, running the installer's own read-only preflight over that same
connection and listing every finding while the form is still editable, restating the settled plan,
and then running the install as a live checklist. The host firewall needs no choice: an active
`ufw` is configured automatically for Hive's port. The private key never leaves the machine — only
its path is stored, and only its public half is sent, to be authorized on the service account. An
account that needs a `sudo` password is asked for one, which is used for that install only and
never written to disk.

On success the app stores the connection, including the generated access token and `hive` as the
SSH user for editor and terminal sessions. The final Accounts screen stays in front of the ordinary
app until you copy the token, connect GitHub, and authenticate at least one of Claude Code or
Codex.

### From a terminal

Every release publishes `provision.sh` alongside the backend tarballs. Run it as root on
Ubuntu 22.04/24.04 or Debian 12/13 (x86-64 or arm64) with systemd:

```bash
curl -fsSL https://github.com/unfence-labs/hive/releases/latest/download/provision.sh | bash
```

The `latest` URL selects only stable releases. To test a prerelease, use its explicit tag instead,
for example `releases/download/v0.1.0-beta.1/provision.sh`.

It installs Hive's own pinned Node.js runtime and the agent CLIs inside `/opt/hive` and the `hive`
service account, downloads the backend release, verifies it against its published checksum, and
runs it under systemd as an unprivileged, sandboxed unit on port 9420. It generates the server's
access token, stores only its SHA-256 digest, and prints the plaintext exactly once on its progress
stream — keep the value reported by the run that completes successfully.

Options are passed through `bash -s --`:

| Option | Environment variable | Default | What it sets |
|---|---|---|---|
| `--install-dir` | `HIVE_INSTALL_DIR` | `/opt/hive` | Hive, its private Node runtime and the uninstaller |
| `--data-dir` | `HIVE_DATA_DIR` | `/home/hive/.hive` | Projects, worktrees and sessions — the directory that grows |
| `--port` | `HIVE_PORT` | `9420` | Backend port |
| `--allowed-host` | — | — | Hostname or IP the client will use. The desktop installer supplies it automatically |
| `--ssh-public-key` | `HIVE_SSH_PUBLIC_KEY` | — | Authorize this key on the `hive` account |
| `--preflight` | — | — | Report and change nothing |

```bash
curl -fsSL <url>/provision.sh | bash -s -- --port 9420 --install-dir /srv/hive --data-dir /mnt/hive
```

Because the service account owns every repository and worktree, pass `--ssh-public-key` so an
editor or terminal session connects as `hive` rather than root. Without this, files an editor saves
become root-owned and the agent can no longer write them.

An interrupted install resumes only with the exact same port, install directory, and data
directory. A completed install rejects another provisioning run because V1 does not support
updates. What the installer changes on the host, the read-only `--preflight` mode, and the
generated uninstall script are all covered in **[Prerequisites](prerequisites.md)**.

### Manual installation

Choose this path when developing Hive, changing its runtime layout, or managing the service
yourself. You are responsible for dependencies, authentication, process supervision, and updates.
Continue with **[Manual Installation](manual-installation.md)**.

## 4. Connect a client

Clients connect with the server address, port, and access token:

- **Desktop** — Open **Settings → Connection**. A successful guided installation fills this in
  automatically.
- **Web** — Use the same backend connection. Browser deployments may require an allowed origin on
  the backend; see **[Configuration](configuration.md)**.
- **iOS** — Enter the same address, port, and token during first-run onboarding.

After connecting, authenticate GitHub and at least one agent harness from Hive. Claude Code or
Codex is sufficient to start; you do not need both.

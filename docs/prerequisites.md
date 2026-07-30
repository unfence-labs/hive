# Prerequisites

Read this before installing Hive. It takes about a minute.

Hive runs in a Linux environment you control: either a remote VPS or a local VM. For the initial
installation paths, that environment must grant root privileges directly or through `sudo`. The
automatic installer connects over SSH, installs the backend as a systemd service, and hands you
back a running server and its access token. Setup instructions are in
**[Getting Started](getting-started.md)**.

## The desktop client

| | |
|---|---|
| Operating system | macOS 14 or later |
| Architecture | Apple Silicon (arm64) |
| Distribution | Signed and notarized DMG from GitHub Releases |
| Updates | Manual DMG download in V1 |

Intel DMGs are not published. The web and iOS clients use the same backend but have their own
runtime requirements.

## The server

| | |
|---|---|
| Environment | Remote VPS or local VM |
| Operating system | Ubuntu 22.04, Ubuntu 24.04, Debian 12, or Debian 13 |
| Architecture | x86-64 or arm64 |
| Init system | **systemd** — Hive installs itself as a systemd service |
| Free disk | 2 GB where the install directory goes, 1 GB where the data directory goes |
| Free port | `9420` by default, and configurable |

Nothing else is supported. The installer stops before it changes anything on an unsupported release,
an unsupported architecture, a machine without systemd, a port already in use, or a directory it
cannot create.

The server is expected to already be running other software. What that means in practice is at the
bottom of this page.

## Access

The installer connects over SSH on port 22, with a key.

- **A key, not a password.** The app lists the private keys under `~/.ssh` on the machine you run it
  from. A passphrase-protected key is only usable if an agent already holds it — run
  `ssh-add <path>` first. The private key never leaves your machine; only its path is stored, and
  only its public half is sent, to be authorized on the service account the install creates.
- **Root, or an account that can become root.** Log in as `root`, or give the address as
  `user@host` for an account whose `sudo` works. If that `sudo` needs a password, the installer asks
  for it on the "Check the server" screen, uses it for that install only, and never writes it to
  disk.
- `ssh`, `ssh-keyscan` and `ssh-keygen` must be present on the machine running the app. `ssh-add` is
  used to see which keys an agent already holds.
- The guided installer is part of the **desktop app**. From a browser build, use the `provision.sh`
  path described in [Getting Started](getting-started.md) instead.

## How you will reach the server

Hive does not provide HTTPS or configure networking. Before setup, establish an encrypted private
network such as Tailscale, WireGuard, another VPN, or a cloud provider's private network. Enter the
server's private address in the installer. Never expose port `9420` directly to the public Internet:
the access token travels over HTTP and WebSocket and can be intercepted on an untrusted network.
See **[networking.md](networking.md)**.

The backend binds every interface (`0.0.0.0` on port `9420` by default), so firewall and routing
remain your responsibility. Every fresh or resumed incomplete install generates a new access token
and reports it exactly once on its progress stream. The plaintext is never written to a log file;
the server stores only its SHA-256 digest and cannot recover the token.

The address you type is the address the app keeps using afterwards. The installer never hands over
to a second one.

### Firewall handling

There is no firewall question. If `ufw` is active, the installer opens only Hive's configured TCP
port automatically. If no firewall is active, no rule is needed. An active `firewalld` or raw
`nftables` ruleset blocks the install because Hive cannot configure its policy safely and must not
claim success while its port may be closed.

## What the installer changes

- Installs these `apt` packages if missing: `ca-certificates`, `curl`, `git`, `xz-utils`,
  `iproute2`.
- Creates an unprivileged `hive` service account with the home directory `/home/hive`.
- Creates the install directory (`/opt/hive` by default) holding Hive's **own pinned Node.js
  runtime**, its releases, and the uninstall script.
- Installs the Claude Code, Codex, GitHub and `agent-browser` CLIs under `/home/hive/.local`, as the
  service account, plus a Chrome build under `/home/hive/.agent-browser` and the system libraries it
  needs (via `agent-browser install --with-deps`). On arm64 servers the browser step is skipped —
  Chrome for Testing ships no linux-arm64 build — and Hive runs without browser automation.
- Writes `/etc/hive/hive.env`, root-owned and readable by nobody else, holding the service
  configuration and the SHA-256 digest of the access token.
- Writes a non-secret install identity manifest containing its schema, port, install directory, and
  data directory, plus a completion marker after all checks pass.
- Installs, enables and starts `/etc/systemd/system/hive.service`, running as `hive` with
  `NoNewPrivileges`, `ProtectSystem=strict` and a restricted `ReadWritePaths`.
- Keeps provisioning state and its own log under `/var/lib/hive`.
- Creates the data directory (`/home/hive/.hive` by default) for projects, worktrees and sessions.
- If you supply one, appends your public key to `/home/hive/.ssh/authorized_keys` — appended only,
  never rewritten, and never duplicated on an exact incomplete resume.
- Opens Hive's configured TCP port automatically when `ufw` is active.

## What the installer does not change

- **Your system Node.js.** Hive's runtime is pinned and lives inside Hive's own install directory.
  The system one — if the server has one at all — is never read, replaced or upgraded.
- **Your package sources.** No vendor apt repository is added. Node.js comes from a pinned tarball
  on nodejs.org and the GitHub CLI from its official release tarball, each verified against a
  checksum pinned in the script before anything is unpacked.
- **Your firewall policy.** The installer never enables a firewall and never changes its default
  policy. If `ufw` is already active it opens only the configured TCP port. If no firewall is active
  it does nothing and says so. An active `firewalld` or raw `nftables` ruleset blocks the install
  rather than being modified or silently ignored.
- **Your SSH configuration.** `sshd` is not reconfigured. The only SSH file written on the server is
  `authorized_keys` on the service account the installer created. On your own machine, approving a
  server's fingerprint writes to Hive's own `known_hosts` inside the app's configuration directory,
  never to `~/.ssh/known_hosts`.
- **Other services.** Only the port Hive wants has to be free; the install stops if it is taken. An
  install directory that already exists but was not created by Hive is a refusal, not an overwrite.
  An incomplete Hive install resumes only when its port, install directory, and data directory match
  exactly. A completed install can be updated with a release's `provision.sh --update`; the script
  reads those values from the existing manifest and refuses explicit mismatches. Changing the port
  or paths still requires uninstalling and performing a fresh install.

## Updating it

Run the provisioner published with the exact target release:

```bash
curl -fsSL <release-url>/provision.sh | sudo bash -s -- --update
```

Use `--preflight --update` for a read-only check first. An update preserves the data directory,
authorized SSH keys, access token, and `/etc/hive/hive.env`. It reconciles Hive's private runtime,
backend release, systemd unit, uninstaller, and firewall rule, then restarts the service. A failed
backend health check restores the previous backend release.

Updates interrupt active backend child processes. Wait for agents, terminals, and automations to
finish first. The provisioner does not back up the data directory automatically.

## Removing it

Every install writes an uninstall script into the install directory, carrying the paths that run
actually used:

```bash
sudo /opt/hive/hive-uninstall.sh            # remove Hive, keep your data
sudo /opt/hive/hive-uninstall.sh --purge    # remove your data as well
```

It removes the service unit, the install directory and the private runtime, the configuration, the
provisioning state, the service account, and the one firewall rule that install added. It never
removes system packages, package repositories, or — without `--purge` — your data.

## Checking a server without changing it

The installer runs a read-only preflight over the same connection before it offers to start, and
reports everything on this page as it actually is on that server. You can also run it yourself:

```bash
curl -fsSL https://github.com/unfence-labs/hive/releases/latest/download/provision.sh | bash -s -- --preflight
```

It writes nothing, always exits 0, and reports the operating system and architecture, whether the
port is free, whether the chosen directories are writable with room to spare, whether Hive is
already installed, which host firewall is present and whether Hive can configure it automatically,
and whether privilege escalation needs a password.

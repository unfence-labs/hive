# Getting Started

Hive separates the machine doing the work from the client controlling it. The backend, agent
harnesses, repositories, workspaces, and sessions run in one Linux environment. The desktop, web,
and iOS clients connect to that backend.

> [!WARNING]
> Hive does not provide HTTPS yet. Never expose port 9420 directly to the
> public Internet. Connect only through an encrypted private network such as
> Tailscale, WireGuard, or another VPN. The access token is sent over HTTP and
> WebSocket and can be intercepted on an untrusted network.

## 1. Choose where Hive will run

You need a supported Linux environment with root privileges:

- **Remote VPS** — The recommended target when you want agents and automations to keep running
  after you close Hive or shut down your computer.
- **Local VM** — A good target for local development or a private setup on your own machine. Hive
  remains available only while the host and VM are running. On macOS, the existing
  **[OrbStack guide](docs/install-flow-orbstack.md)** walks through the real installer flow with an
  Ubuntu VM.

The backend is the source of truth in both cases. Clients do not need a local checkout, agent CLI,
or development environment.

## 2. Check the prerequisites

Read **[Prerequisites](docs/prerequisites.md)** before installing. The page covers supported
distributions and architectures, root access, SSH requirements, disk space, the backend port, and
every host change made by the automatic installer.

Set up an encrypted private path between your clients and the server before installation. Hive does
not configure a VPN or HTTPS. See **[Networking](docs/networking.md)**.

## 3. Choose an installation method

### Automatic installation

This is the preferred path. Use the guided desktop installer for the complete setup flow, or run
the same provisioner from a terminal. Both produce the same server layout and systemd service.

The automatic installation flow is documented directly in the
**[README](README.md#installation)**.

### Manual installation

Choose this path when developing Hive, changing its runtime layout, or managing the service
yourself. You are responsible for dependencies, authentication, process supervision, and updates.

Continue with **[Manual installation](docs/manual-installation.md)**.

## 4. Connect a client

Clients connect with the server address, port, and access token:

- **Desktop** — Open **Settings → Connection**. A successful guided installation fills this in
  automatically.
- **Web** — Use the same backend connection. Browser deployments may require an allowed origin on
  the backend.
- **iOS** — Enter the same address, port, and token during first-run onboarding.

After connecting, authenticate GitHub and at least one agent harness from Hive. Claude Code or
Codex is sufficient to start; you do not need both.

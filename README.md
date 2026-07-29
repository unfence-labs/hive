<div align="center">

<img src=".github/assets/hive-logo.svg" alt="Hive" width="120" height="120" />

# Hive

**Orchestrate AI coding agents across isolated git workspaces — from your desktop, browser, or phone.**

[![CI](https://github.com/unfence-labs/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/unfence-labs/hive/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-FF7048.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org)

[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-iOS-F05138?logo=swift&logoColor=white)](https://developer.apple.com/xcode/swiftui/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Features](#features) · [Supported Models](#supported-models) · [Getting Started](#getting-started) · [Documentation](#documentation) · [Contributing](#contributing)

</div>

---

<!-- TODO(release): hero screenshot — drop the image into .github/assets/screenshot-hero.png
     (workspace chat with a live diff is the money shot), then uncomment:

<p align="center">
  <img src=".github/assets/screenshot-hero.png" alt="A Hive workspace running an agent session" width="90%" />
</p>
-->

## What is Hive?

Hive is a control plane for AI coding agents. It manages your projects as **bare git repositories**, spins up **isolated workspaces** as git worktrees and branches, and keeps every agent conversation as a **resumable session** — so multiple agents can work in parallel without stepping on each other.

Hive runs on your own server, keeping your projects, workspaces, and agent sessions under your control. Through an encrypted private network, that server is easily accessible from any Hive client: the web app, the Tauri desktop app, or the native SwiftUI iOS app. Every client uses the same REST and WebSocket protocols, so your work is available wherever you need it.

<!-- TODO(release): use-case diagram — drop the image into .github/assets/how-it-works.svg
     (an example flow: server + isolated workspaces + the three clients), then uncomment:

<p align="center">
  <img src=".github/assets/how-it-works.svg" alt="How Hive works" width="90%" />
</p>
-->

## Features

- **Parallel, isolated workspaces** — Every workspace gets its own git worktree and branch, so multiple agents can work on the same project without overwriting each other's changes.
- **Launch and forget** — Sessions live on the backend: conversations, tool calls, plans, and results are all persisted. Start an agent, close your laptop, and pick the work back up later from the desktop, web, or iOS client.
- **Multi-harness** — Run different agent runtimes side by side through the same interface, with provider and model selection scoped to each session.
- **Live visibility and control** — Stream agent text, reasoning, tool calls, file changes, diffs, and plans as they happen. Interrupt a run, send a follow-up, or take over from another client. Browse files, comment on diffs, attach images, open a terminal in the worktree — or continue in VS Code over Remote SSH.
- **GitHub-aware workflows** — Create workspaces from branches, pull requests, or issues, keep their source context attached, and follow pull request status from Hive.
- **The Brain** — A free-standing workspace that belongs to no project: a git-backed knowledge base you can edit, chat with, and share context through across everything you build.
- **Server-native automation** — Define reusable Team agents and schedule recurring runs directly in Hive. Automations run on the backend without an open client, keep their full run history, and notify you when work finishes or fails.
- **Shared agent configuration** — Keep global instructions, skills, and subagents aligned across harnesses. Hive connects standards such as `AGENTS.md` and `.agents/skills` with harness-native counterparts, so your setup stays consistent.

## Supported Models

| Provider | Runtime | Models |
|---|---|---|
| Anthropic | Claude Code | Fable 5, Opus 5, Sonnet 5, Haiku 4.5 |
| OpenAI | Codex | GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.5 |
| Moonshot | Claude Code | K3, K3 1M, K2.7 Coding, K2.7 Coding Highspeed |

## Getting Started

Hive separates the machine doing the work from the client controlling it. The backend runs on a Linux server you control — a remote VPS for an always-on setup, or a local VM when you want everything on your own machine.

> [!IMPORTANT]
> Hive is designed to run on your own infrastructure, behind an encrypted private network such as
> Tailscale or WireGuard. It does not terminate HTTPS in V1, so the backend port must never be
> reachable from the public Internet. See **[Networking](docs/networking.md)**.

1. **[Download the desktop app](https://github.com/unfence-labs/hive/releases/latest)** (macOS).
2. Point it at your server: the guided installer connects over SSH, runs a read-only preflight, and installs the complete backend as a systemd service. Check **[Prerequisites](docs/prerequisites.md)** for what it needs and what it changes.
3. Connect from anywhere — the desktop app, a browser, or the iOS app share the same backend.

The full walkthrough, including the terminal-only installer, lives in
**[Getting Started](docs/getting-started.md)**. To build and configure every component yourself,
follow the **[Manual Installation guide](docs/manual-installation.md)**.

## Documentation

| Guide | What it covers |
|---|---|
| [Getting Started](docs/getting-started.md) | Choosing a server, installing the backend, connecting clients |
| [Prerequisites](docs/prerequisites.md) | Supported systems, SSH access, exactly what the installer changes |
| [Networking](docs/networking.md) | The encrypted private network Hive expects |
| [Manual Installation](docs/manual-installation.md) | Building from source and managing the runtime yourself |
| [Configuration](docs/configuration.md) | Backend and frontend environment variables |
| [Architecture](docs/architecture.md) | Monorepo layout, core model, HTTP and WebSocket APIs, testing |

## Contributing

Contributions are welcome! Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the dev setup and
guidelines — and **[AGENTS.md](AGENTS.md)** for the commands, repository map, and guardrails
(written for coding agents, works just as well for humans).

Found a bug or have an idea? [Open an issue](https://github.com/unfence-labs/hive/issues).

## License

Released under the [GNU General Public License v3.0](LICENSE). Copyright (C) 2026 419Labs.

---

<div align="center">
<sub>Built with 🧡 for people who run many agents at once.</sub>
</div>

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

[Features](#features) · [Supported Models](#supported-models) · [Getting Started](#getting-started) · [Documentation](#documentation)

</div>

---

> [!WARNING]
> Hive does not provide HTTPS yet. Never expose port 9420 directly to the
> public Internet. Connect only through an encrypted private network such as
> Tailscale, WireGuard, or another VPN. The access token is sent over HTTP and
> WebSocket and can be intercepted on an untrusted network.

## What is Hive?

Hive is a control plane for AI coding agents. It manages your projects as **bare git repositories**, spins up **isolated workspaces** as git worktrees and branches, and keeps every agent conversation as a **resumable session** — so multiple agents can work in parallel without stepping on each other.

Hive runs on your own server, keeping your projects, workspaces, and agent sessions under your control. Through an encrypted private network, that server is easily accessible from any Hive client: the web app, the Tauri desktop app, or the native SwiftUI iOS app. Every client uses the same REST and WebSocket protocols, so your work is available wherever you need it.

## Features

This is a non-exhaustive overview of what Hive brings to your workflow:

- **Launch and forget** — Start an agent from any Hive client, then close Hive, shut down your laptop, or switch devices. When the backend runs on an always-on server, the work continues without a connected client and is ready whenever you return.
- **Run remotely or locally** — Deploy Hive on an always-on remote VPS for access from anywhere, or run it inside a local Linux VM when you want the entire environment on your own machine.
- **Multi-harness** — Use different agent runtimes side by side through the same interface, with provider and model selection scoped to each session.
- **Persistent, resumable sessions** — Conversations, tool calls, plans, and results are stored on the backend. Follow live progress or resume later from the desktop, web, or iOS client.
- **Parallel, isolated workspaces** — Every workspace gets its own git worktree and branch, so multiple agents can work on the same project without overwriting each other's changes.
- **GitHub-aware workflows** — Create workspaces from branches, pull requests, or issues, keep their source context attached, and follow pull request status from Hive.
- **Live visibility and control** — Stream agent text, reasoning, tool calls, file changes, diffs, tasks, plans, and diagnostics. Interrupt a run, send a follow-up, or take over from another client.
- **Shared agent configuration** — Keep global instructions, skills, and subagents aligned across harnesses. Hive connects standards such as `AGENTS.md` and `.agents/skills` with harness-native counterparts, so your setup stays consistent.
- **One home for your work** — Repositories, workspaces, conversations, agent configuration, compute, and your Brain knowledge base live together on the backend. Resume instantly from any client, including a lightweight client with no local development environment.
- **Continue in your IDE** — Open any workspace in VS Code over Remote SSH and keep coding with your usual editor, extensions, and tooling.
- **Built-in development tools** — Browse files, inspect diffs, comment on changes, attach images, manage project environment variables, and open a workspace in a terminal.
- **Server-native automation** — Define reusable Team agents and schedule recurring runs directly in Hive. Automations run on the backend without an open client and retain their prompts, results, status, and history.
- **Notifications when work finishes** — Receive completion and failure notifications without keeping Hive in the foreground.

## Supported Models

| Provider | Runtime | Models |
|---|---|---|
| Anthropic | Claude Code | Fable 5, Opus 5, Sonnet 5, Haiku 4.5 |
| OpenAI | Codex | GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.5 |
| Moonshot | Claude Code | K3, K3 1M, K2.7 Coding, K2.7 Coding Highspeed |

## Getting Started

### Installation

The recommended way to install Hive is through the macOS desktop app. During onboarding, the app
connects to your VPS or local VM over SSH, checks the target, and installs the complete Hive backend
for you.

If you want to build and configure every component yourself, follow the
**[manual installation guide](docs/manual-installation.md)**.

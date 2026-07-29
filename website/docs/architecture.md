---
title: Architecture
description: How Hive is put together.
---

# Architecture

For the curious and the contributing. Hive is a TypeScript monorepo with a native iOS client:

```
backend/    Fastify REST API, WebSocket hub, provider runners,
            git/worktree management, Brain, automation scheduler,
            notifications, file-backed state
frontend/   React 19 + Vite web UI and Tauri v2 desktop shell
ios/        SwiftUI client sharing the same REST and hub protocols
shared/     TypeScript helpers shared by backend and frontend
```

## The backend is the product

Everything durable lives in the backend: projects, worktrees, sessions, prompts, automations, notification config. Clients are deliberately thin. They render state and stream. They do not own anything. That is the architectural reason you can close any client at any time.

## REST for truth, WebSocket for liveness

The protocol split is strict:

- **REST** owns conversation history and all CRUD. Any client fetches the same finalized truth on any reconnect.
- **The WebSocket hub** carries live activity only: streaming text and thinking, tool calls, status, diff stats, branch info, PR status, script and browser state. Clients that join mid stream get a snapshot of the running turn. They never get a divergent history.

One hub connection multiplexes all workspaces. A sidebar full of running agents costs one socket. Separate sockets carrying PTY bytes exist for scripts, terminals, and the live browser stream.

## Providers are adapters

Each provider (Claude, Codex, Kimi) implements one interface: spawn or attach to the CLI, translate its output into normalized Hive events, expose its capabilities (models, thinking levels, fast mode). The rest of the system stays independent of any provider. That covers UI, history, automations, and notifications. Adding a provider means adding one adapter. It does not touch the product.

## Git, everywhere

Hive leans on git primitives rather than inventing its own:

- Projects are **bare repos**. Workspaces are **worktrees**. They are cheap, instant, and isolated.
- The Brain is a normal clone. Saving is a commit and a push.
- Automation runs on a project get a fresh worktree per run.

## State backed by files

No database. Sessions are JSONL, config is JSON, prompts are Markdown, repos are repos. This keeps backups trivial (`rsync` the data dir). It makes debugging transparent. And it means your data outlives any particular version of Hive.

Want the full API surface? The [GitHub README](https://github.com/unfence-labs/hive#architecture) documents every REST endpoint and WebSocket event.

---
title: What is Hive?
description: A control plane for AI coding agents that you host yourself.
---

# What is Hive?

Hive is a **control plane for AI coding agents that you host yourself**. It runs on a machine you own. That can be your laptop or a home server or a VPS. It gives every agent a durable place to work. Each agent gets an isolated git workspace and a resumable conversation and a live stream you can watch from any device.

The core promise: **close your laptop and your agents keep working.** Sessions live on the backend and not in a browser tab. Come back later from your desktop or the web or your phone and pick up exactly where the agent is.

## What you can do with it

- Run **Claude Code, Codex, and Kimi** sessions side by side. Each is locked to its provider. Each carries its own thinking levels.
- Give every task its own **git worktree and branch**. Create it from scratch or from an existing branch or pull request or issue.
- Run up to **six parallel agent sessions per workspace** without them stepping on each other.
- Watch **everything stream live** over a single WebSocket. Text and thinking and tool calls and file edits and diffs and plans and tasks and diagnostics all appear. Every connected client sees it at once.
- Schedule **automations**. These are reusable Team agents triggered by cron. They come with run history and failure alerts.
- Keep a **Brain**. It is a Markdown knowledge base backed by git. Your agents can read it and you can chat with it.
- Get **notifications** by push (iOS) or Telegram the moment an agent finishes or fails or needs input.

## The clients

One backend serves three clients. They all speak the same REST and WebSocket protocols.

| Client | What it is |
|---|---|
| **Desktop** | A Tauri v2 app pointed at a local or remote backend. It adds a full pane terminal and external terminal / VS Code opening and native shortcuts. |
| **Web** | The same React UI in any browser. Useful on machines where you cannot install anything. |
| **iOS** | A native SwiftUI app with push notifications and conversations and automations browsing and PR status. |

## What Hive is not

- **Not a SaaS.** There is no hosted Hive and no account and no cloud middleman. Your API keys talk directly to your providers.
- **Not another agent.** Hive orchestrates the agent CLIs you already use and pay for. It does not replace them.
- **Not a black box.** State is files on disk. That means repos and sessions as JSONL and prompts as Markdown. The whole project is GPLv3.

> **Looking for installation instructions?** The install flow is currently being reworked. For now the [GitHub README](https://github.com/unfence-labs/hive#quick-start) has the current quick start.

Next: [Core concepts](/docs/core-concepts) explains the Project → Workspace → Session model everything else builds on.

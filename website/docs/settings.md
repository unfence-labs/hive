---
title: Settings & integrations
description: GitHub, instructions, skills, subagents, and appearance.
---

# Settings & integrations

## GitHub connection

Hive connects to GitHub through the **device flow**. Click *Connect*. Enter the shown code on github.com. Done. Under the hood it authenticates the `gh` CLI and sets up git credentials.

The connection powers everything that touches GitHub:

- listing branches, open pull requests, and issues when you create workspaces,
- live **PR status** per workspace (open / draft / merged / closed),
- creating the private repository for the [Brain](/docs/brain).

## Global instructions

Your personal agent instructions span every project. Think of it as the "how I like to work" file. Hive maintains **one canonical copy**. It keeps both providers in sync. Codex reads `~/.codex/AGENTS.md`. And `~/.claude/CLAUDE.md` is kept as a symlink to it. The settings page shows the sync state (linked, diverged, one sided…). A single click on **Sync** repairs it.

## Skills

Manage agent skills from the UI. Create, edit, and sync them across providers. Skills live in the standard locations (`~/.claude/skills` for Claude, `~/.agents/skills` for Codex). They use the same sync as instructions, built on a symlink. Write once and both CLIs see it. A *sync missing* action propagates skills that exist for only one provider.

## Subagents

Custom subagents (the `@agent` completions in the composer) are managed per provider. Claude uses Markdown definitions. Codex uses TOML. When a subagent exists for only one provider, Hive can **generate the counterpart** for the other automatically.

## Models

- Set the **default model** for new sessions.
- Enter the **Kimi Code API key** to unlock Kimi models.
- See CLI availability (which provider binaries the backend detected).

## Appearance

- **Theme**: system, light, or dark.
- **Accent color**: six presets (indigo, blue, cyan, emerald, amber, rose) applied across highlights, focus rings, and active states.

## Remote friendly by design

The backend serves every client the same API. It adds bearer token auth and rate limiting when exposed beyond localhost. It plays well with Tailscale for reaching your Hive from anywhere. Connection settings (host, port, token) are configured per client.

---
title: Core concepts
description: Projects, workspaces, sessions, and the Brain.
---

# Core concepts

Everything in Hive builds on one hierarchy:

```
Project  →  Workspace  →  Session
```

## Project

A project is a **bare git repository** managed by Hive. It is typically a clone of your GitHub repo. Because the project repo is bare no one ever works in it directly. It exists to fan out workspaces.

Projects also carry a few things at the project level. There is an `.env` file injected into workspaces. There is GitHub metadata (branches, pull requests, issues). And there are logs kept per project.

## Workspace

A workspace is a **git worktree with its own branch** checked out from the project. This is where agents actually run. Isolation is the point:

- An agent can commit and install dependencies and run tests and break things without touching any other workspace.
- Two agents in two workspaces can edit the same file with zero conflict. They are on different branches in different directories.
- When the work is merged or abandoned you archive the workspace and the worktree disappears.

Workspaces can be created empty or **from a source**. A source is an existing branch or a pull request or an issue. The source travels with the workspace. Agents see it in their context and issue workspaces fill in your first message for you. See [Workspaces](/docs/workspaces).

## Session

A session is a **persisted and resumable agent conversation** inside a workspace. Each session:

- is locked to one provider (Claude, Codex, or Kimi) after its first message,
- keeps its full history on the backend as JSONL. Every client fetches the same truth over REST,
- streams live activity to all connected clients over the WebSocket hub while running.

A workspace holds up to **six sessions**. So one workspace can run an implementation session and a review session and an "explain this codebase" session side by side. Sessions can also be converted into full **terminal tabs** on desktop.

## Brain

The Brain is a single **knowledge base backed by git**. It is a normal clone (not a bare repo) of a Markdown notes repository and is usually private. It sits outside the project hierarchy and uses the synthetic workspace id `brain`. That means chatting with the Brain works exactly like chatting in a workspace. See [Brain](/docs/brain).

## Where things live

All state is plain files under the backend's data directory (`~/.hive` by default):

```
$DATA_DIR/
├── config.json               backend configuration
├── prompts/                  base, brain, and issue-draft prompts + templates
├── brain/                    the Brain clone and its sessions
├── automations/              automation definitions, runs, and workspaces
└── proj-<id>/
    ├── repo.git/             the bare project repository
    ├── workspaces/<name>/    one git worktree per workspace
    ├── sessions/<id>/        metadata.json, messages.jsonl, attachments/
    └── env/.env              project-level environment file
```

No database and no proprietary formats. You can read (and back up) everything with standard tools.

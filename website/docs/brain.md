---
title: Brain
description: A git backed knowledge base you can chat with.
---

# Brain

The Brain is your **shared, persistent knowledge base**: a normal git clone of a Markdown repository that lives alongside your projects. It holds architecture decisions, runbooks, conventions, and meeting notes. Anything you want agents (and future you) to know.

## Setting it up

Two ways, both from the Brain page:

- **Create**: Hive creates a **private GitHub repository** for you, clones it, and seeds it with a README (requires the [GitHub connection](/docs/settings)).
- **Connect**: point Hive at an existing repository URL and it clones it.

## Working with notes

- Browse and edit Markdown files directly in the UI. Edits go to the working tree only. Nothing is committed behind your back.
- The **status view** shows pending changes (added, modified, deleted, renamed, untracked) and how many commits haven't been pushed yet.
- The **diff view** shows exactly what saving would commit, including untracked files.
- **Save** runs `git add -A`, commits, and pushes in one step. If the push fails (offline, auth), the local commit is kept and the UI tells you. Save again later to push.

## Chatting with the Brain

The Brain has its own chat, built on the same session stack as workspaces. The Brain agent gets a **map of every file path in the repo** in its system prompt, so it knows what exists and reads what it needs. Use it to ask questions ("what did we decide about billing retries?"), file new notes, or reorganize.

The Brain agent's system prompt is editable in *Settings → Prompt*. See [Prompts](/docs/prompts).

## Deleting

Deleting the Brain removes the **local clone only**. The remote GitHub repository is never touched. Reconnect it any time.

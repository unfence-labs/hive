---
title: Workspaces
description: Isolated git worktrees where agents do their work.
---

# Workspaces

A workspace is an isolated git worktree with its own branch. Everything an agent does happens inside it. That includes edits and commits and test runs and dev servers.

## Creating workspaces

Create a fresh workspace from the sidebar (**⌘N**). Or create one **from an existing source** with the *New workspace from…* dialog (**⌘⇧N**, also in the command palette). The dialog is a spotlight style picker with three tabs:

- **Pull requests**: pick from your open PRs (drafts are marked). You can also type a PR number directly or paste a GitHub PR URL from the same repo. If a PR is already checked out Hive jumps to its existing workspace instead of duplicating it.
- **Branches**: grouped into *Existing* and *Remote* and *Local*. An *Existing* branch is already checked out and opens that workspace.
- **Issues**: pick from open issues or type an issue number or paste an issue URL.

When more than one project exists a project dropdown appears in the dialog.

### What the source changes

The workspace source is injected into the agent's git context so the agent knows what it is working on:

- **Branch workspaces** note the originating branch.
- **PR workspaces** carry the PR number and title and URL and **base branch**. They also carry instructions to push to the PR's head branch rather than opening a new PR. There is a special warning for fork PRs where pushing would not update the PR.
- **Issue workspaces** additionally **fill in the composer** with an editable draft message built from the issue's number and title and URL and body. See [Prompts](/docs/prompts).

## Files and diffs

The right sidebar shows the repository:

- **All**: the full file tree. **⌘P** opens quick open fuzzy file search.
- **Modified**: changed files grouped by committed / uncommitted with additions and deletions shown per file.

Selecting a file opens a pinned file tab with a **Source / Diff** toggle. Diffs render inline (split or unified). They can be scoped to uncommitted or committed or combined changes.

### Comment on a diff and send it to the agent

In any diff click a line number (or drag a range) and write a comment. For example "this needs a null check" or "extract this". Comments accumulate with a counter. **Paste to prompt** drops them into the composer formatted with the file and line range and your note. It is a code review flow where the reviewer's feedback goes straight back to the agent.

## Scripts

If the repository has a `hive.json` the workspace gets a script panel:

- **Setup**: a one shot install/bootstrap script (shows a ✓ when done).
- **Run scripts**: one tab per named script (dev servers show a port badge when configured).
- **Terminal**: an interactive shell tab.

Scripts run in real PTYs with live streamed output. They survive client disconnects like everything else in Hive.

## PR status, commit, and archive

- The sidebar footer shows the workspace's **pull request status** linked to GitHub. That status is open or draft or merged or closed. This requires the [GitHub connection](/docs/settings).
- The composer offers a one click **Commit & Push** shortcut.
- **Archive** tears the workspace down when you are done. It is blocked while a script is still running.

## Desktop extras

- **Full terminal**: any session can become a terminal tab running a real login shell in the worktree. The PTY outlives the pane. Switch away and back and your scrollback replays.
- **Open in…**: open the worktree in VS Code (via Remote-SSH) or an external terminal app over SSH once an SSH host is configured in Settings.
- **Command palette** (**⌘K**) with the classic shortcuts: ⌘T new conversation, ⌘P quick open, ⌘F find in conversation, ⌘B toggle sidebar, ⌘, settings, and more.

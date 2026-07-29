---
title: Sessions & chat
description: Parallel, resumable agent conversations.
---

# Sessions & chat

Sessions are where you talk to agents. Each workspace holds up to **six** of them. Terminal tabs do not count toward the limit. Every session is persisted on the backend. Close the client whenever you like.

## Providers, models, and thinking

- Pick a model from the **model selector**. Models are grouped by provider (Claude, Codex, Kimi).
- A session **locks to its provider on the first message**. You can switch models within the provider mid session. You cannot jump providers. Start a new session for that.
- The **thinking selector** controls reasoning effort (from none up to ultra) on models that support it.
- **Plan mode** asks the agent to propose a plan before touching code. Plan proposals surface an approval bar. You can approve or hand the plan off to a fresh session.
- On supported Opus models, a **Fast** toggle trades cost for output speed.

Your choices persist per session and seed from the session's previous run.

## What streams live

While an agent runs the conversation streams in real time to every connected device at once:

- **Text and thinking**: assistant Markdown plus collapsible reasoning blocks.
- **Tool calls**: command executions with running state, file edits carrying their diff, subagent activity, and context compaction.
- **Diagnostics**: errors and warnings with expandable details.
- **Tasks, plans, and goals**: a task tracker below the transcript shows the agent's goal, task list, and background agents.
- **Images**: screenshots and generated images open in a lightbox.
- **Diff stats and branch info**: live counts of what the session has changed.

When the agent drives a browser a **live browser panel** streams its screen into the workspace. The panel is read only.

## Composer

The composer does more than text:

- **`#file`**: fuzzy search tracked files and attach them as structured mentions (rendered as clickable chips in the transcript).
- **`/command`**: slash commands from the underlying CLI. These include built in commands, your user and project commands, and invocable skills.
- **`@agent`**: your custom subagents.
- **Images**: attach with the `+` button, drag and drop, or paste from the clipboard.

## Flow control

- **Queued message**: submit while the agent is running and the message queues. It auto sends the moment the agent goes idle. The queue survives switching sessions and reconnecting.
- **Stop**: interrupt a running turn at any time.
- **Unread indicators**: session tabs show an unread dot when something finished while you were looking elsewhere. Streaming tabs show a live activity glyph.
- **Delivery states**: optimistic sends show *Sending…*, *Not delivered* (with retry), or *Delivery unconfirmed* on flaky connections. This is built for phones on cellular.

## History is REST, live is WebSocket

Finalized history is always fetched over REST. Every client sees the same conversation truth on desktop, web, and iOS. The WebSocket hub only carries live activity. Whoever is connected sees the stream. Whoever is not loses nothing.

---
title: iOS app
description: Your agents, from your pocket.
---

# iOS app

The iOS client is a **native SwiftUI app**. It speaks the same REST and WebSocket protocols as desktop and web. It is not a companion viewer. It is a full client for the moments you are away from a keyboard.

## What you can do

- **Converse**: open any workspace, switch between its sessions, read full history, and send new messages. You get model selection and the same `#file`, `/command`, and `@agent` autocomplete as desktop.
- **Watch live**: streaming text, thinking, tool calls, and the task tracker, rendered natively.
- **Follow along**: provider marks per conversation, unread indicators, and diff summaries on the dashboard.
- **Brain**: browse and chat with your knowledge base.
- **Automations**: a read only browser for automation definitions and run logs.
- **PR status & scripts**: see pull request state and script activity per workspace.
- **Push notifications**: turn completions, questions, plan proposals, failures, and automation results arrive as native pushes. Tap through to the session.

## Built for flaky networks

- A **connection status banner** with tap to reconnect.
- Optimistic sends with delivery states and retry.
- History over REST means reopening the app always shows the truth, even if you missed the live stream.

## Typical flow

1. Kick off two or three agents from your desk.
2. Leave. Get a push when a turn completes or an agent has a question.
3. Answer from your phone. Approve the plan. Refine the request. Or just say "ship it".
4. Back at your desk, the full conversation is there, as if you had never left.

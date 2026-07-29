---
title: Notifications
description: Know the moment an agent needs you.
---

# Notifications

The point of walking away is not having to check back. Hive tells you when something actually needs your attention.

## What triggers a notification

| Event | When it fires |
|---|---|
| **Turn complete** | An agent finishes a turn with duration and a short summary. |
| **Needs input** | The agent stopped to ask you a question. |
| **Proposed a plan** | The agent finished a plan and is waiting for approval. |
| **Agent failed** | A session errored out with the failure detail. |
| **Automation run finished** | A scheduled run completed or failed with duration and summary. |

Events fan out to **every enabled channel**.

## Channels

### Push (iOS)

Native push notifications to the iOS app via APNs. Configure your Apple credentials in *Settings → Notifications*. Enter the Team ID and Key ID and the `.p8` key content and bundle ID. Add a sandbox toggle for development builds. Devices register themselves automatically when the iOS app connects. A test button verifies the setup end to end.

### Telegram

A simple bot that messages you (or a group). Enter a **bot token** and **chat ID** in *Settings → Notifications* and send a test message. Works everywhere Telegram does. That includes your desktop and watch.

### In app toasts

Local toasts inside the web/desktop UI for turn completions in other workspaces. Toggle them in settings.

## Design notes

- Notifications are sent by the **backend** so they fire even when no client is open. That's what makes the close your laptop workflow real.
- Channel configuration lives on the server. Enabling a channel applies to all events.

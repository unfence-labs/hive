---
title: Automations & Team agents
description: Reusable agents on a schedule with cron.
---

# Automations & Team agents

Automations run agents **without you in the loop**. Think nightly triage. Think morning standup summaries. Think scheduled refactor sweeps. They are built from two pieces. A reusable **Team agent** is the *who*. An **automation** is the *when and what*.

## Team agents

A Team agent is a durable agent definition. You manage it in *Settings → Team*:

| Field | Meaning |
|---|---|
| **Name / description** | How it appears in pickers and run history. |
| **System prompt** | The agent's standing instructions. |
| **Model** | A provider qualified model (Claude, Codex, or Kimi). This also determines the provider. |
| **Thinking level** | Reasoning effort for models that support it. |
| **Read only** | Blocks edit tools while keeping shell access. The agent can grep and build and test but not modify files. Ideal for audits and reports. |

A Team agent can't be deleted while an automation still references it.

## Automations

An automation ties a Team agent to a schedule and a prompt:

- **Project** *(optional)*. With a project each run gets a **fresh git worktree** of the project's default branch. It also injects git context into the system prompt. Without one the run executes in a plain standalone directory.
- **Schedule**. A standard five field cron expression (`0 7 * * 1-5`) validated when you save.
- **Prompt**. Either a saved [prompt template](/docs/prompts) or inline text. This is the run's user message. The *system* prompt comes from the Team agent.
- **Notifications**. Toggle alerts on completion and on failure.

Automations can also be **triggered manually** at any time.

## Runs

Every run is recorded. This includes status (running, success, or failure). It includes start and end time and duration. It includes a summary extracted from the transcript and any error. Opening a run shows the **full message transcript**. It also shows the exact resolved system prompt it ran with. No guessing what the agent was told.

Safety rails built in:

- Runs of the same automation never overlap.
- A run with no stream activity for 30 minutes (configurable) is failed rather than left hanging.
- If the server restarts during a run the run is marked failed instead of being silently lost.

## Notifications

When a run finishes Hive can notify you through any configured channel. That means push to iOS or Telegram. The alert carries the automation name and status and duration and the summary or error. See [Notifications](/docs/notifications).

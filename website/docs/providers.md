---
title: Providers & models
description: Claude, Codex, and Kimi side by side.
---

# Providers & models

Hive orchestrates the agent CLIs you already use. Each provider implements the same interface, so sessions, streaming, automations, and history work identically regardless of which model is doing the work.

## Claude

Claude Code runs through the Claude CLI in streaming JSON mode. Everything the CLI emits is normalized into Hive events. This covers text, thinking, tool use, subagents, plans, and images. Model selection includes the current Claude models with per model thinking levels, and a **Fast** toggle on supported Opus models.

## Codex

Codex runs as a long lived `codex app-server` process speaking JSON-RPC. This gives interactive chat parity: streaming, reasoning, command execution, file changes, and diagnostics. Read only agents are enforced through the Codex sandbox.

## Kimi

Kimi (Moonshot's K series coding models) rides the Claude CLI pointed at Moonshot's endpoint that is compatible with Anthropic. It requires a **Kimi Code subscription API key**. Enter it in *Settings → Models*. Models appear in the picker once the key is saved.

- **K3 / K3-1M**: selectable thinking effort. The 1M context variant requires the higher subscription tier.
- **K2.7 coding variants**: always on thinking with no effort selector.

## How selection works

- The model picker groups models by provider and shows each model's capabilities (thinking levels, fast mode).
- A session **locks to a provider on first message**. The picker greys out other providers' models for that session.
- A **default model** can be set in *Settings → Models* and is used for new sessions.
- Provider usage (rate limit windows, consumption) is surfaced in the UI where providers expose it.

## One interface, everywhere

Because providers are normalized at the backend, everything downstream is independent of the provider: the iOS app renders a Codex session the same way it renders a Claude one. Automations can use any provider via their [Team agent](/docs/automations)'s model. History is stored in one format.

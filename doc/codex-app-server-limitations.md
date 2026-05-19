# Codex App Server Limitations

Hive uses `codex app-server` for interactive Codex chat because the protocol exposes long-lived threads, turns, items, command execution, file changes, plans, usage, warnings, and server requests. Scheduled automations stay on `codex exec --json` because they are one-shot runs with a clear process exit.

The integration intentionally promotes the main chat activity into first-class Hive UI records:

- command execution
- file changes
- plan updates
- diagnostics for unsupported notifications, unsupported server requests, unsupported item types, and known actionable App Server failures

The remaining items below are known protocol surface area that Hive does not yet render with rich, dedicated UI. Unsupported items should stay visible as diagnostics instead of failing silently.
Known App Server notifications that are routine runtime state rather than chat activity are handled explicitly and ignored.

## Client Rendering Contract

Hive clients consume normalized `agent_activity` WebSocket events rather than the raw Codex App Server protocol. Each activity is persisted on assistant messages as `agentActivities` and has one of these kinds:

- `command_execution`
- `file_change`
- `plan_update`
- `diagnostic`

The web frontend and iOS app both render these activities directly and keep `tool_use` / `tool_result` compatibility events as fallback data. Clients should filter compatibility tool calls whose ids are already represented by an `AgentActivity`, otherwise Codex command/file/plan rows will appear twice.

Unsupported Codex App Server protocol events should continue to become `diagnostic` activities. Unknown client-side activity kinds should not surface as chat errors; render an unsupported/unknown activity row or ignore them safely.

After a `done` or `cancelled` event finalizes a stream, clients should ignore late live fragments for that terminal assistant message. Late `text_delta`, `thinking`, `tool_use`, `agent_activity`, `tool_input_required`, and `plan_mode_changed` events must not recreate a ghost streaming message or pending input for the completed turn.

## Notification Coverage

These notifications are either diagnostic-only today or not yet rendered as richer activity:

- `serverRequest/resolved`
- `thread/compacted`
- `model/rerouted`
- `model/verification`
- `item/fileChange/outputDelta`
- `item/commandExecution/terminalInteraction`
- `item/mcpToolCall/progress`
- `item/plan/delta`
- `rawResponseItem/completed`
- `hook/started`
- `hook/completed`

Warnings such as `warning`, `configWarning`, `deprecationNotice`, and `guardianWarning` are rendered as diagnostic activities.

The following notifications are intentionally absorbed instead of being rendered in chat:

- `remoteControl/status/changed` because Hive does not expose Codex remote-control state in chat.
- `turn/diff/updated` because it is an aggregate turn diff that duplicates item-level file-change rendering.
- `thread/status/changed` for routine thread states. `systemError` still emits an error diagnostic.
- `mcpServer/startupStatus/updated` for `starting` and `ready`. `failed` and `cancelled` still emit warning diagnostics.
- `account/rateLimits/updated` because rate-limit UX should be handled outside the chat activity stream in a future pass.

## Item Coverage

These App Server item types currently rely on the unsupported-item diagnostic fallback:

- `imageView`
- `imageGeneration`
- `enteredReviewMode`
- `exitedReviewMode`
- `contextCompaction`

`collabAgentToolCall` is normalized into Hive's existing `Agent` tool-call rendering path so web and iOS can reuse the same sub-agent UI used by other providers.

`userMessage` and `hookPrompt` are intentionally ignored because Hive already owns user-message rendering and hook prompts are internal context.

## Server Requests

Hive auto-accepts command and file approvals according to its current no-approval execution policy:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `execCommandApproval`
- `applyPatchApproval`

Other request types are rejected explicitly until Hive has product support for them:

- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`
- `item/tool/call`
- `account/chatgptAuthTokens/refresh`

The rule is to respond explicitly. Unsupported requests must not hang the App Server turn.

## Compatibility

Hive probes `codex app-server --help` at startup. If the installed Codex CLI exists but does not support App Server, interactive Codex chat falls back to the existing `codex exec --json` runner instead of exposing a broken App Server path.

References:

- https://openai.com/index/unlocking-the-codex-harness/
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

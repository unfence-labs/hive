# Codex App Server Limitations

Hive uses `codex app-server` for interactive Codex chat because the protocol exposes long-lived threads, turns, items, command execution, file changes, plans, usage, warnings, and server requests. Scheduled automations stay on `codex exec --json` because they are one-shot runs with a clear process exit.

The integration intentionally promotes the main chat activity into first-class Hive UI records:

- command execution
- file changes
- plan updates
- diagnostics for unsupported notifications, unsupported server requests, and unsupported item types

The remaining items below are known protocol surface area that Hive does not yet render with rich, dedicated UI. Unsupported items should stay visible as diagnostics instead of failing silently.

## Notification Coverage

These notifications are either diagnostic-only today or not yet rendered as richer activity:

- `turn/diff/updated`
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

## Item Coverage

These App Server item types currently rely on the unsupported-item diagnostic fallback:

- `collabAgentToolCall`
- `imageView`
- `imageGeneration`
- `enteredReviewMode`
- `exitedReviewMode`
- `contextCompaction`

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

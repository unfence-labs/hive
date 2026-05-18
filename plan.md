# Codex App Server Integration Plan

## Current Status

This work stays in one Git PR, but the implementation is split into clean feature layers.

Completed:

- Codex interactive chat uses `codex app-server`.
- Codex automations use `sessionKind: "automation"` and stay on `codex exec --json`.
- `providerSessionId` is the canonical provider-native thread/session id.
- `claudeSessionId` is still read and written as a compatibility shim.
- `turn/completed.turn.status` is respected:
  - `completed` emits normal `done`.
  - `failed` emits a Hive error with the App Server error details.
  - `interrupted` is treated as cancellation only when Hive initiated the stop.
- CLI process execution is isolated in `ProcessAgentRunner`.
- Codex App Server turn lifecycle is isolated in `CodexAppServerRunner`.
- Runner selection is handled by a small factory.
- `ConversationSession` owns history, metadata, stream accumulation, reconnect snapshots, and websocket mapping.
- `AgentEventNormalizer` maps provider stream events into Hive-normalized events.
- Rich `AgentActivity` data exists for:
  - command execution
  - file changes
  - plan updates
  - diagnostics for unsupported App Server events/requests
- The backend emits the additive `agent_activity` websocket event.
- Live stream snapshots replay `agent_activity` events on reconnect.
- Assistant messages persist `agentActivities`.
- The frontend renders rich activities through `AgentActivityList`.
- Unsupported App Server notifications are surfaced as deduplicated diagnostic activities.
- Unsupported App Server requests are rejected explicitly and surfaced as diagnostic error activities.
- Existing `tool_use` / `tool_result` compatibility is preserved.
- Existing chat UI components are reused instead of adding a Codex-only parallel UI.

Recent validation:

- Backend typecheck and lint pass.
- Backend targeted tests pass for conversation sessions, App Server provider/runner, and websocket stream replay.
- Frontend typecheck and lint pass.
- Frontend targeted tests pass for `useConversation`, `AgentActivityList`, `DiffView`, and `ChatConversation`.

## Product Direction

Hive should use App Server for interactive Codex chat because it exposes a richer long-lived protocol: threads, turns, items, command execution, file changes, plans, diffs, usage, warnings, and server requests.

Hive should keep scheduled automations on `codex exec --json` because automations are one-shot, non-interactive, and should exit with a clear result.

References:

- https://openai.com/index/unlocking-the-codex-harness/
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## Remaining Work

### 1. Manual Smoke Tests

Run real Hive smoke tests before expanding the feature further.

Required checks:

- Codex chat streams assistant text.
- Codex chat streams command execution with live output.
- Codex chat streams file changes with unified diffs.
- Codex chat streams plan updates.
- Stop interrupts the active Codex turn and surfaces a clear cancelled state.
- A message after stop continues on the same Codex thread.
- Reconnect during a running Codex turn replays the accumulated snapshot.
- Codex automation still uses `codex exec --json`.
- Claude and Gemini chat still render existing tool calls correctly.

### 2. Remaining App Server Event Coverage

The rich UI currently covers the main interactive events: command execution, file changes, and plan updates.

Unsupported App Server notifications are now visible as diagnostic activities. "Completing App Server coverage" means promoting useful diagnostics into richer first-class Hive activities over time.

Candidates:

- `turn/diff/updated`
  - Could power a turn-level diff summary or workspace change preview.
- `warning`
  - Should probably surface as a non-fatal visible warning.
- `configWarning`
  - Should probably surface when Codex config/env is wrong.
- `deprecationNotice`
  - Could be shown as a low-priority warning.
- `guardianWarning`
  - Should likely be visible because it may explain blocked/risky execution.
- `serverRequest/resolved`
  - Could update activity state when a request was accepted/rejected/resolved.
- `thread/compacted`
  - Could become a compact context activity later.
- `model/rerouted`
  - Could be shown if Codex changes model during a turn.
- `model/verification`
  - Needs product decision; probably not urgent.
- `item/fileChange/outputDelta`
  - May matter if App Server streams patch output separately from patch updates.
- `item/commandExecution/terminalInteraction`
  - Needs product decision; likely should become visible if it explains command behavior.
- `item/mcpToolCall/progress`
  - Relevant if Hive wants richer MCP progress UI.

Do not add all of these blindly. The diagnostic fallback is there so unsupported protocol events are visible while implementation can happen incrementally.

### 3. Server Requests Outside Approvals

App Server can send JSON-RPC requests to the client. These are different from notifications: Codex expects Hive to answer.

Approval requests are already handled according to Hive's current no-approval policy:

- `item/commandExecution/requestApproval` is accepted.
- `item/fileChange/requestApproval` is accepted.
- `execCommandApproval` is accepted.
- `applyPatchApproval` is accepted.
- unknown approval-like requests are not silently accepted.

There are other request types that are not simple approvals. Unsupported requests are rejected explicitly and shown as diagnostic errors, so product support can be added incrementally without silent hangs.

Known request types to evaluate:

- `item/permissions/requestApproval`
  - Codex is asking for additional permissions.
  - Current direction: reject loudly unless Hive adds an explicit permissions UX.
- `item/tool/requestUserInput`
  - A tool wants structured user input during a turn.
  - Current direction: reject unless Hive adds interactive prompt UI.
- `mcpServer/elicitation/request`
  - An MCP server asks the user for form or URL-based input.
  - Current direction: reject unless Hive supports MCP elicitation UX.
- `item/tool/call`
  - Dynamic tool call request.
  - Needs a deliberate tool execution policy before support.
- `account/chatgptAuthTokens/refresh`
  - Codex may ask the client to refresh ChatGPT auth tokens.
  - Needs investigation depending on how Hive expects users to authenticate Codex.

The rule is: respond explicitly. Do not let requests hang. Do not auto-approve broad capability changes without a product decision.

### 4. Lifecycle Hardening

The App Server path is functional, but more edge-case coverage would reduce risk.

Add or verify tests for:

- App Server process crash during a turn.
- App Server restart before the next turn.
- malformed JSON-RPC lines.
- stop during initialization.
- stop before `turn/started`.
- stop after `turn/started`.
- pending JSON-RPC requests rejected on process exit.
- no duplicate listeners across multiple turns.

### 5. Cleanup After Smoke Tests

Only after real smoke tests:

- Search for dead Codex App Server compatibility code.
- Confirm `CodexStreamAdapter` is still used only for `codex exec --json`.
- Re-check whether `AgentActivity` should move to a shared package to avoid backend/frontend type drift.
- Consider normalizing turn finalization (`done`, `cancelled`, `error`) as runner events if it makes `ConversationSession` simpler.
- Run full validation:
  - `npm run lint`
  - `npm run typecheck`
  - targeted backend tests
  - targeted frontend tests
  - one real Codex chat smoke test
  - one real Codex automation smoke test

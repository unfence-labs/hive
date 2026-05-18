# Codex App Server Integration Plan

## Current PR Assessment

This branch does not match the original PR 1 scope.

The intended PR 1 was a behavior-preserving refactor: add `sessionKind`, introduce a runner abstraction, keep Codex chat and automations on the existing `codex exec --json` path, and prepare the codebase for App Server without changing runtime behavior.

The current branch already does more than that:

- Codex chat sessions now route to `codex app-server`.
- A substantial `CodexAppServerSession` JSON-RPC bridge has been added.
- App Server item events are mapped into the existing text/tool/thinking stream.
- The frontend has a small diff-rendering update for Codex-native edit output.
- Automations are explicitly kept on `sessionKind: "automation"` and still use `codex exec --json`.

That is useful progress, but architecturally it mixes PR 1 and PR 2. `ConversationSession` still owns provider selection, process spawning, App Server lifecycle, parser wiring, stream accumulation, stop behavior, persistence, and UI event mapping. The runner abstraction from the original plan has not been created yet.

## Chosen Direction

This work will stay in one Git PR, but the implementation should still be split into clean feature layers. The goal is not to revert the App Server progress. The goal is to fix the architecture now so the rest of the Codex UX can be added without turning `ConversationSession` into a protocol-specific catch-all.

## Fix Plan Before More Features

### Phase 1: Stabilize behavior and close correctness gaps

Fix the current App Server path before expanding it.

Tasks:

- Inspect `turn/completed.turn.status`.
- Treat `completed` as success.
- Treat `failed` as an error and surface `turn.error`.
- Treat `interrupted` as cancellation or park, depending on Hive stop reason.
- Add tests for completed, failed, interrupted, and malformed turn completion payloads.
- Keep Codex automations on `codex exec --json`.
- Keep the current frontend behavior unchanged except for bug fixes.

Acceptance criteria:

- A failed Codex App Server turn cannot emit a successful `done` event.
- A stopped Codex turn produces the same user-facing semantics as other providers.
- Existing Claude, Gemini, and Codex automation tests still pass.

### Phase 2: Extract the runner contract

Move protocol execution out of `ConversationSession`.

Tasks:

- Add an `AgentRunner` interface.
- Add a shared normalized event type for runner output.
- Move CLI process execution into `ProcessAgentRunner`.
- Move Codex App Server execution into `CodexAppServerRunner`.
- Keep provider selection in one small factory, not inside the session turn body.
- Keep `ConversationSession` responsible for persistence, metadata, accumulators, snapshots, and websocket mapping.

Acceptance criteria:

- `ConversationSession` no longer imports `CodexAppServerSession`, `CodexStreamAdapter`, `GeminiStreamAdapter`, or `spawn` directly.
- Adding another provider or protocol does not require editing the core turn orchestration logic.
- Existing tests can use a fake runner without spawning fake processes.

### Phase 3: Normalize events without changing the UI yet

Introduce the internal stream model while preserving current websocket messages.

Tasks:

- Add normalized events:
  - `AgentTextDelta`
  - `AgentThinkingDelta`
  - `AgentToolStarted`
  - `AgentToolUpdated`
  - `AgentToolCompleted`
  - `AgentPlanUpdated`
  - `AgentFileChangeUpdated`
  - `AgentUsageUpdated`
  - `AgentDone`
  - `AgentCancelled`
  - `AgentError`
- Map normalized events to the existing `WsOutgoing` messages.
- Keep current `ToolCall` persistence compatible.
- Add tests for the mapper separately from process/App Server tests.

Acceptance criteria:

- Frontend behavior stays stable.
- Backend protocol adapters can emit richer events without knowing websocket shapes.
- `ConversationSession` has one event ingestion path for Claude, Gemini, Codex exec, and Codex App Server.

### Phase 4: Harden App Server lifecycle and server requests

Make the App Server path robust enough to build UX on top of it.

Tasks:

- Handle process crash and pending request rejection deterministically.
- Handle stop before `turn/started`.
- Handle stop after `turn/started`.
- Handle process restart before the next turn.
- Preserve and resume `providerSessionId`.
- Explicitly handle or reject:
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
  - `item/permissions/requestApproval`
  - `item/tool/requestUserInput`
  - `mcpServer/elicitation/request`
  - `item/tool/call`
- Do not silently auto-approve unknown request types.

Acceptance criteria:

- Unknown App Server requests fail loudly with a clear Hive error.
- Known approval requests are handled according to the no-approval Hive policy.
- App Server restarts do not corrupt persisted session state.

### Phase 5: Keep metadata compatibility clean

Finish the `providerSessionId` migration without breaking old clients.

Tasks:

- Read `providerSessionId` first.
- Fall back to `claudeSessionId`.
- Write `providerSessionId` as canonical.
- Continue writing `claudeSessionId` temporarily for older clients.
- Add iOS model compatibility follow-up if the mobile client needs to display provider session IDs.

Acceptance criteria:

- Existing sessions still load.
- New sessions persist `providerSessionId`.
- No new code uses `claudeSessionId` except compatibility shims.

### Phase 6: Only then add richer UX events

Once the backend is clean, expand the UI stream.

Tasks:

- Add command activity events and renderer.
- Add file change activity events and renderer.
- Add plan update events and renderer.
- Add warnings/config/deprecation event display.
- Keep a single activity list rather than a Codex-only parallel UI.

Acceptance criteria:

- Codex App Server has richer UI than `codex exec`.
- Claude/Gemini UI does not regress.
- The frontend consumes Hive events, not raw Codex protocol events.

## Recommended Next Decision

Before adding more UI, choose one of these paths:

1. Split back to the planned PR shape.
   Extract the runner abstraction first, keep App Server disabled or behind a flag, and ship PR 1 as a low-risk foundation.

2. Accept this as a combined PR 1/2.
   Then harden the App Server path immediately before expanding the frontend. This is faster, but riskier because the new protocol path is already live for Codex chat.

My recommendation is path 1 if the target branch needs low-risk reviewability. If speed matters more, path 2 is acceptable only if we add the hardening items below before shipping.

## Sources and Product Direction

OpenAI's App Server direction validates the original split:

- App Server is the rich client protocol for Codex: long-lived JSON-RPC over stdio, with thread, turn, and item primitives.
- App Server emits UI-ready lifecycle events for messages, reasoning, command execution, file changes, diffs, plans, token usage, and approvals.
- `codex exec` remains the better fit for one-shot automations and CI-style runs because it is simple, non-interactive, and exits with a clear result.

That means Hive should use App Server for interactive Codex chat, but keep scheduled automations on `codex exec --json`.

References:

- https://openai.com/index/unlocking-the-codex-harness/
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## Backend Work Remaining

### 1. Extract the runner architecture

Create an internal runner contract so `ConversationSession` stops knowing about protocol details.

Suggested shape:

- `AgentRunner`
  - `startTurn(input, options): Promise<void>`
  - `stop(reason): void`
  - `respondToToolInput?(...)`
  - emits normalized runner events
- `ProcessAgentRunner`
  - owns Claude CLI, Gemini CLI, and Codex exec process spawning
  - owns stderr classification and stream adapter wiring
- `CodexAppServerRunner`
  - owns App Server process lifecycle
  - owns JSON-RPC request/response handling
  - owns Codex protocol mapping

`ConversationSession` should keep only:

- history persistence
- metadata persistence
- websocket outgoing event emission
- stream accumulators and reconnect snapshots
- tool-input continuation orchestration

### 2. Add normalized runner events

Do not let the frontend depend on raw Codex App Server protocol events.

Use an internal event model like:

- `AgentTextDelta`
- `AgentThinkingDelta`
- `AgentToolStarted`
- `AgentToolUpdated`
- `AgentToolCompleted`
- `AgentPlanUpdated`
- `AgentFileChangeUpdated`
- `AgentUsageUpdated`
- `AgentDone`
- `AgentCancelled`
- `AgentError`

Then map these to the existing `WsOutgoing` messages plus narrowly scoped new messages where the current protocol cannot represent the UX cleanly.

### 3. Harden App Server turn status handling

The current App Server path should inspect `turn/completed.turn.status`.

Required behavior:

- `completed` -> normal done
- `interrupted` -> cancelled or parked, depending on Hive stop reason
- `failed` -> error with `turn.error` surfaced and persisted

Do not treat every `turn/completed` notification as success.

### 4. Tighten approvals and permissions behavior

Hive currently wants permissive execution without approval UX. That is fine, but it must be explicit and auditable.

Required behavior:

- Send `approvalPolicy: "never"` and full-access sandbox configuration consistently.
- If App Server still requests approval, either auto-accept only the known command/file approval requests or fail loudly with a configuration error.
- Handle or explicitly reject newer server requests:
  - `item/permissions/requestApproval`
  - `item/tool/requestUserInput`
  - `mcpServer/elicitation/request`
  - `item/tool/call`

Auto-accepting everything would be a weak security boundary and a bad future default.

### 5. Improve App Server protocol coverage

Map these App Server notifications into normalized events:

- `item/started`
- `item/*/delta`
- `item/completed`
- `turn/plan/updated`
- `turn/diff/updated`
- `thread/tokenUsage/updated`
- `serverRequest/resolved`
- `warning`, `configWarning`, `deprecationNotice`

Command execution should preserve:

- command
- cwd
- status
- live output deltas
- exit code
- duration

File changes should preserve:

- path
- unified diff
- status
- patch failure details

### 6. Make App Server lifecycle robust

Add coverage for:

- App Server process restart after crash
- resuming stored `providerSessionId`
- stop during initialization
- stop before `turn/started`
- stop after `turn/started`
- park behavior
- malformed JSON-RPC lines
- pending JSON-RPC requests rejected on process exit
- no duplicate listeners across multiple turns

Keep `providerSessionId` as the canonical metadata field. Continue reading `claudeSessionId` for compatibility and write both until all clients are migrated.

## Frontend UX Work Remaining

### 1. Activity timeline

Evolve `ToolCallList` toward a generic `AgentActivityList`, but keep the existing visual language.

The target UX should show a single timeline with:

- assistant text
- reasoning summaries
- command execution
- file changes
- MCP/tool calls
- plan updates
- warnings and errors

Avoid a second parallel Codex-only stream.

### 2. Command activity

Add a command activity renderer with:

- command and cwd
- running/completed/failed state
- live output
- exit code and duration
- collapsed output by default when long

The user should be able to scan progress without expanding every command.

### 3. File change activity

Add a native file-change renderer with:

- changed file list
- patch status
- inline unified diff preview
- clear failed/declined states

Use the existing `DiffView` where possible, but do not force Codex unified diffs through Claude-style `old_string`/`new_string` fields.

### 4. Plan activity

Map Codex plan updates into the existing plan/task UI rather than rendering them as fake tool calls long-term.

The best UX is a compact live checklist:

- pending
- in progress
- completed

This should update in place during the turn.

### 5. Stop, resume, and reconnect UX

Interactive Codex chat needs reliable user controls:

- stop should interrupt the active turn and surface a clear cancelled state
- reconnect should replay the current accumulated snapshot
- after an interrupted turn, the next message should continue on the same Codex thread
- process crashes should show a recoverable error, not a silent done state

### 6. Later UX opportunities

These should wait until the core stream is stable:

- `turn/steer` support for sending follow-up guidance during a running turn
- `thread/shellCommand` support for user-triggered `!` commands
- `model/list` support for Codex-native model discovery
- thread compaction activity rendering
- richer MCP elicitation UI if Hive chooses to support interactive tool prompts

## Test Plan

Backend:

- runner selection: Codex chat -> App Server, Codex automation -> exec
- `ConversationSession` with fake runner events
- `ProcessAgentRunner` tests for existing CLI behavior
- `CodexAppServerRunner` tests with fake JSON-RPC process
- failed/interrupted/completed turn status handling
- approval request handling
- metadata compatibility: `claudeSessionId` -> `providerSessionId`
- automation regression: one-shot exec path only

Frontend:

- reducer handling for new normalized websocket events
- command activity rendering
- file change rendering
- plan update rendering
- reconnect snapshot rendering
- no regression for existing Claude/Gemini tool calls

Validation:

- `npm run lint`
- `npm run typecheck`
- targeted backend tests
- targeted frontend tests
- one manual Codex chat smoke test through Hive
- one automation run smoke test confirming `codex exec --json`

## Suggested PR Split

PR 1:

- `sessionKind`
- `providerSessionId`
- runner interface
- `ProcessAgentRunner`
- no App Server behavior change by default
- fake runner tests

PR 2:

- `CodexAppServerRunner`
- Codex chat runner selection
- App Server lifecycle hardening
- feature flag if needed
- backend protocol tests

PR 3:

- richer activity events
- command/file/plan renderers
- no redesign
- frontend reducer and DOM tests

PR 4:

- metadata cleanup
- dead code removal
- broader regression tests
- optional model discovery and later UX improvements

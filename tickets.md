# Tickets: Backend-authoritative unread conversations

Build one globally synchronized unread-conversation model for the backend, web, and iOS, capturing the decisions made for the current unread-state PR.

Work the **frontier**: this single ticket can start immediately.

## Synchronize backend-authoritative unread conversations across web and iOS

**What to build:** Make the backend the only source of truth for unread conversations so reading on web clears iOS, reading on iOS clears web, and reconnecting after backgrounding or terminating a client restores the correct state. Keep the implementation deliberately mono-user, remove local and legacy unread mechanisms, and do not introduce APNs.

**Blocked by:** None — can start immediately.

- [ ] Persist `assistantMessageCount` and `readAssistantMessageCount` for every chat conversation; a conversation is unread exactly when the assistant count is greater than the read count.
- [ ] Count only persisted, user-visible assistant chat messages. User messages, streaming deltas, reasoning, tool activity, metadata, and failures without a persisted assistant message do not create unread state.
- [ ] A cancelled or failed turn creates unread state only when it persists a visible assistant message, including the synthetic cancellation message when applicable.
- [ ] Include regular workspace chats and Brain conversations in the model, while excluding terminal sessions.
- [ ] Preserve existing conversations through a one-time migration that maps the old count to both new counters, marks existing history as read, removes the old field, and leaves no permanent runtime fallback.
- [ ] Persist the assistant message first, then durably update serialized metadata, then emit terminal and unread events so clients never observe unread state for an unpersisted response.
- [ ] Add the client command `{ type: "mark_read", sessionId, throughCount }`, where `throughCount` is the number of assistant messages actually rendered by that client.
- [ ] Validate `throughCount` as a non-negative integer no greater than the authoritative assistant count, and advance read progress monotonically with `max(current, throughCount)`.
- [ ] Publish full replacement snapshots as `{ type: "unread_state", sessions: [...] }`, containing only currently unread, non-terminal conversations.
- [ ] Send ordered authoritative snapshots after bootstrap, reconnect, persisted assistant completion, successful reads, conversation deletion, and conversion to terminal.
- [ ] Serialize all snapshot broadcasts per workspace so an older full snapshot can never overwrite a newer state on a client.
- [ ] Web and iOS replace their complete per-workspace unread map from every snapshot; they never merge snapshots or derive unread state from `done`, `cancelled`, streaming, or local timestamps.
- [ ] Mark a conversation read only after its history is loaded and assistant messages are rendered while the conversation is visible and the app or browser window is active.
- [ ] Do not mark a conversation read while a file tab covers it, while the app is inactive, or while the browser is hidden or unfocused.
- [ ] Do not clear badges optimistically. Keep unread indicators until the backend acknowledges the read through a replacement snapshot.
- [ ] If a read cannot be sent offline, do not queue a local acknowledgement. Retry from the authoritative snapshot when the same conversation is still visible after reconnecting.
- [ ] When every client is closed or killed, continue accumulating unread state on the backend and restore it on the next connection; do not add APNs or promise a live device badge while the app is terminated.
- [ ] Show unread dots on conversation rows and tabs. Streaming has visual priority, but it must not erase the underlying unread state, which reappears after streaming ends until acknowledged.
- [ ] The Hub numeric badge counts unread workspace conversations, not unread workspaces, and excludes Brain conversations.
- [ ] Brain exposes its own numeric unread-conversation badge. Workspace, project, and folder aggregation remains dot-based rather than numeric.
- [ ] Remove local and persisted legacy unread mechanisms, including completed-workspace state, local clear helpers, background-stream completion heuristics, and client-side unread derivation.
- [ ] Keep backend, web, and iOS protocol definitions aligned and cover migration, persistence ordering, validation, snapshot replacement, lifecycle gating, reconnect behavior, badge aggregation, deletion, and terminal conversion with tests.

# Tickets: Native output styles

Add native, conversation-scoped response-style selection across Hive's supported interactive harnesses and clients.

Work the **frontier**: any ticket whose blockers are all done.

## Expose native Claude/Kimi output styles in interactive web conversations

**What to build:** Let web and desktop users choose a native Claude Code output style before sending the first message of an interactive Claude or Kimi conversation. The selection defaults to Claude Code's standard behavior, is persisted with the conversation, and remains visible but disabled after the first message.

**Blocked by:** None — can start immediately.

- [x] The model catalog advertises `Default`, `Proactive`, `Concise`, `Explanatory`, and `Learning` for Claude and Kimi models.
- [x] The selected style is validated, persisted in the conversation's last run options, and applied through the Claude Code settings override without breaking fast mode.
- [x] The web composer resets an incompatible selection to `Default`, sends the selection on the first message, and only disables the dropdown after that message.
- [x] Backend and frontend tests cover catalog exposure, runtime translation, defaults, persistence, switching, and locking.

## Expose supported Codex personalities as output styles

**What to build:** Let web and desktop users select Codex's native response personalities through the same output-style control when the selected Codex model supports them, while models without native personality support show no style control.

**Blocked by:** Expose native Claude/Kimi output styles in interactive web conversations.

- [x] Supported Codex models advertise `Default`, `Friendly`, `Pragmatic`, and `None`; unsupported models advertise no styles.
- [x] The app-server receives the selected native personality when starting or resuming a thread, while `Default` preserves Codex's native behavior.
- [x] The backend rejects unsupported personality/model combinations and preserves the conversation-scoped lock.
- [x] Provider, app-server, catalog, and web tests cover supported and unsupported Codex models.

## Bring output-style selection to iOS

**What to build:** Give iOS users the same native output-style selection as web and desktop for interactive conversations, driven entirely by the shared model catalog and conversation options.

**Blocked by:** Expose native Claude/Kimi output styles in interactive web conversations.

- [x] iOS decodes provider-specific style options from the shared model catalog and sends the selected value with the first message.
- [x] The composer defaults or resets to `Default` when needed and restores the persisted conversation selection.
- [x] The style dropdown stays visible but is simply disabled after the first message.
- [x] Swift tests cover decoding, selection, provider/model switching, sending, restoration, and locking.

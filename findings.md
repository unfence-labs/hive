# Findings — iOS feedback fixes (branch ios-hub-feedback-fixes)

Work in progress, interrupted by machine shutdown. Feedback source: Lenny (Telegram, 2026-07-10). Handle all items on this one branch/PR.

## Context

- PR #334 (issue #331, script log viewer) is merged-ready and separate; this branch is cut from main and covers 4 feedback items.
- Orchestration state: dev agent had item 1 implemented (working tree: `ios/HiveMobile/Views/Components/StatusDot.swift`, `ios/HiveMobile/Views/Hub/HubRows.swift`, `ios/HiveMobile/Views/Chat/ConversationRow.swift`), items 2-3 characterized in the simulator, item 4 re-scoped (see below).
- Working-tree code changes at shutdown time are committed on this branch right after this file (WIP commit). swift test / xcodebuild NOT yet re-verified on them.

## Item 1 — Restore blinking streaming dot on Hub rows (WIP code present)

- Regression suspected from PR #329 (whole-app audit polish, commit 70f6a3f): the status dot stopped pulsing while an agent streams; only the conversation streaming indicator remained.
- Expected semantics (mirror web frontend): dot PULSES while streaming/running; dot SOLID (no pulse) when conversation has unread updates; nothing when read + idle.
- WIP touches StatusDot.swift (+38 lines: pulse animation), HubRows.swift, ConversationRow.swift.
- TODO next session: get dev's root-cause confirmation, verify frontend parity, run swift test + xcodebuild, verify visually in sim.

## Item 2 — UI flash when switching Brain <-> Hub tabs (characterized, not fixed)

- Reproduced and characterized in the simulator by the sim agent (evidence gathered before shutdown; details were in the dev agent's session — re-investigate from Views root tab structure: HiveApp.swift, HubView.swift, Brain views; suspect state resets / loading placeholders flashing on tab switch despite cached data).
- TODO: root cause + fix (keep views alive or avoid flashing loading states when cache exists).

## Item 3 — Pull-to-refresh on Hub leaves a big gap under the Search bar (characterized, not fixed)

- Reproduced in the simulator. Likely refreshable/searchable/ScrollView layout interaction in HubView.
- TODO: root cause + fix.

## Item 4 — Markdown render toggle (re-scoped, not started)

- There is NO standalone file viewer on iOS — the praised "view file" is the diff viewer (WorkspaceFileDiffView, PR #326). No file-content API in APIClient.
- Scope decided: in the EXISTING diff viewer, for .md files only, small toolbar toggle diff <-> rendered markdown (reuse SelectableMarkdownText). Default: diff. Render new/current content (old if deleted).
- Content source: look for an existing backend REST endpoint using backend/src/utils/repo-files.ts helpers (used by web file tree). If none exists and the diff payload lacks full text, SKIP item 4 (nice-to-have; backend changes off-limits).

## Non-item (informational)

- The "4" badge on the Hub tab = conversations with unseen updates. Lenny found it confusing at first; no change requested yet — he'll report back after more use.

## Process notes for next session

- Repo rules: zero code comments, no pbxproj edits (fileSystemSynchronizedGroups), parser-style pure logic goes in ios/Package.swift sources + tests in ios/Tests/ChatDraftStoreTests.
- Verify: `cd ios && swift test` AND `xcodebuild -project HiveMobile.xcodeproj -scheme HiveMobile -destination 'generic/platform=iOS Simulator' build`.
- Sim testing recipe (mock backend on 3456, app-container plist, cfprefsd host-process kill, axe CLI) is in session memory `ios-sim-visual-testing`.
- Delete this file before opening the final PR.

# Findings — iOS feedback fixes (branch ios-hub-feedback-fixes)

Work in progress, interrupted by machine shutdown 2026-07-10. Feedback source: Lenny (Telegram). Handle all items on this one branch/PR. State verified at shutdown: xcodebuild BUILD SUCCEEDED, swift test 292/292 pass, working tree has item 1 only (3 files, uncommitted).

## Item 1 — Blinking streaming dot on Hub rows: DONE (code in working tree, uncommitted)

- Root cause: PR #329 (commit 70f6a3f) replaced the pulsing dot with the static AgentActivityIndicator grid in HubRows.swift and ConversationRow.swift.
- Changed:
  - `ios/HiveMobile/Views/Components/StatusDot.swift`: added StreamingDot (accent dot + animate-ping ring; static halo under Reduce Motion).
  - `ios/HiveMobile/Views/Hub/HubRows.swift`: workspace row + folder/project icon overlay use StreamingDot when streaming.
  - `ios/HiveMobile/Views/Chat/ConversationRow.swift`: session row streaming uses StreamingDot.
- Parity with frontend SidebarActivityDot: pulse = streaming, solid = unread (UnreadDot unchanged). One deviation: idle keeps the audit's faint gray StatusDot (frontend shows nothing) — trivial to remove for exact parity if wanted.
- Verified rendering in sim (green dots). Remaining: final sim pass + light/dark check.

## Item 2 — UI flash on Brain <-> Hub tab switch: root-caused, NOT fixed

- Root cause (confirmed by simulator repro): iOS 26 TabView cross-dissolve, NOT a state reset or skeleton flash. Tab roots have transparent identically-colored backgrounds, so during the ~0.3s cross-fade both tabs' content ghost through each other. Views ARE kept alive (value-based Tab items in HiveApp.swift; stores persist; no skeleton).
- Fix: give each tab's root an OPAQUE background so the incoming view occludes the outgoing one during the dissolve — HiveApp.swift, the NavigationStack content inside each Tab (~lines 36-57).
- Do NOT touch loading/skeleton logic — it is already correct. Purely visual fix.

## Item 3 — Pull-to-refresh gap under Hub search bar: root-caused, NOT fixed

- Root cause: `.searchable(.navigationBarDrawer(displayMode: .automatic))` + `.refreshable` on a ScrollView (HubView.swift:49 searchable, :55-62 refreshable, :95-111 empty safeAreaInset cloning banner). After pull-to-refresh the search drawer is left EXPANDED BUT EMPTY (~50pt), persists indefinitely, and only collapses when the user scrolls the content up. The search field itself never renders inside the band. Known iOS 26 regression already noted in the comment at HubView.swift:56-57.
- Fix direction: attach .searchable/.refreshable directly to the ScrollView, or convert the Hub scroll to a List (List handles searchable+refreshable without the residual drawer inset). Needs sim verification after.

## Item 4 — Markdown render toggle in diff viewer: scoped, NOT started

- There is NO standalone file viewer on iOS — the praised "view file" is the diff viewer (WorkspaceFileDiffView in `ios/HiveMobile/Views/Chat/WorkspaceDiffViews.swift`, PR #326). APIClient has no file-content method (only fetchFileCompletions).
- Scope: in the existing diff viewer, for .md files only, a small toolbar toggle diff <-> rendered markdown of the file's new/current content (old if deleted). Default: diff. Reuse SelectableMarkdownText. Not needed in any other surface.
- FIRST CHECK next session: the parsed diff (api.fetchWorkspaceDiff -> DiffResponse -> ParsedFileDiff.lines) only carries changed hunks, so it likely cannot reconstruct full file text. Look for an existing backend REST route serving file content (uses backend/src/utils/repo-files.ts path-safety helpers; the web file tree has one). If found: add an APIClient method + use it. If NOT found: SKIP item 4 entirely (nice-to-have; backend code changes are off-limits).

## Non-item (informational)

- The "4" badge on the Hub tab = conversations with unseen updates. No change requested; Lenny will report back after more use.

## Gotchas for next session

- Item 2: resist "fixing the loading state" — the fix is the opaque background only.
- Item 3: the gap persists and only clears on scroll-up; verify the fix with a real pull-to-refresh in the sim.
- Sim driving: use `axe tap --label "Hub"/"Brain"` (reliable); coordinate clicks via cliclick were flaky. Evidence PNGs were in the session scratchpad (gone after shutdown).
- Memory `ios-sim-visual-testing` was updated with the working sim-driving pipeline.
- Repo rules: zero code comments, no pbxproj edits (fileSystemSynchronizedGroups), verify with `cd ios && swift test` AND `xcodebuild -project HiveMobile.xcodeproj -scheme HiveMobile -destination 'generic/platform=iOS Simulator' build`.
- Delete this file before opening the final PR.

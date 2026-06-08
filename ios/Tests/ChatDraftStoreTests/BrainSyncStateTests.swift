import Foundation
import Testing
@testable import HiveMobileStoresCore

struct BrainSyncStateTests {
    @Test
    func savingTakesPrecedenceOverEverything() {
        let state = brainSyncState(
            statusLoading: true,
            statusError: true,
            saveIndicator: .saving,
            pendingCount: 5,
            unpushedCommitCount: 2
        )
        #expect(state == .saving)
        #expect(state.label == "Saving…")
    }

    @Test
    func pushFailedBeatsStatusErrorAndLoading() {
        let state = brainSyncState(
            statusLoading: true,
            statusError: true,
            saveIndicator: .pushFailed,
            pendingCount: 0,
            unpushedCommitCount: 0
        )
        #expect(state == .pushFailed)
        #expect(state.label == "Push failed")
    }

    @Test
    func statusErrorBeatsLoading() {
        let state = brainSyncState(
            statusLoading: true,
            statusError: true,
            saveIndicator: .idle,
            pendingCount: 0,
            unpushedCommitCount: 0
        )
        #expect(state == .error)
        #expect(state.label == "Status unavailable")
    }

    @Test
    func loadingWhenNoSaveActivity() {
        let state = brainSyncState(
            statusLoading: true,
            statusError: false,
            saveIndicator: .idle,
            pendingCount: 3,
            unpushedCommitCount: 0
        )
        #expect(state == .loading)
    }

    @Test
    func savedShownAfterLoadCompletes() {
        let state = brainSyncState(
            statusLoading: false,
            statusError: false,
            saveIndicator: .saved,
            pendingCount: 0,
            unpushedCommitCount: 1
        )
        #expect(state == .saved)
        #expect(state.label == "Saved")
    }

    @Test
    func pendingWhenChangesPresentAndIdle() {
        let state = brainSyncState(
            statusLoading: false,
            statusError: false,
            saveIndicator: .idle,
            pendingCount: 2,
            unpushedCommitCount: 1
        )
        #expect(state == .pending)
        #expect(state.label == "Unsaved changes")
    }

    @Test
    func syncedWhenCleanAndIdle() {
        let state = brainSyncState(
            statusLoading: false,
            statusError: false,
            saveIndicator: .idle,
            pendingCount: 0,
            unpushedCommitCount: 0
        )
        #expect(state == .synced)
        #expect(state.label == "Up to date")
    }

    @Test
    func unpushedWhenNoPendingChangesButLocalCommitsExist() {
        let state = brainSyncState(
            statusLoading: false,
            statusError: false,
            saveIndicator: .idle,
            pendingCount: 0,
            unpushedCommitCount: 2
        )
        #expect(state == .unpushed)
        #expect(state.label == "Not pushed")
    }

    @Test
    func decodesConnectedBrainState() throws {
        let data = """
        {
          "exists": true,
          "repoUrl": "git@github.com:user/brain.git",
          "createdAt": "2026-06-08T10:00:00.000Z",
          "lastSyncedAt": "2026-06-08T10:30:00.000Z"
        }
        """.data(using: .utf8)!

        let state = try JSONDecoder().decode(BrainState.self, from: data)

        #expect(state.exists)
        #expect(state.repoUrl == "git@github.com:user/brain.git")
        #expect(state.createdAt == "2026-06-08T10:00:00.000Z")
        #expect(state.lastSyncedAt == "2026-06-08T10:30:00.000Z")
    }

    @Test
    func decodesDisconnectedBrainState() throws {
        let data = #"{ "exists": false }"#.data(using: .utf8)!

        let state = try JSONDecoder().decode(BrainState.self, from: data)

        #expect(!state.exists)
        #expect(state.repoUrl == nil)
        #expect(state.createdAt == nil)
        #expect(state.lastSyncedAt == nil)
    }

    @Test
    func decodesSaveResponsePushFailure() throws {
        let data = """
        { "committed": true, "pushed": false, "error": "permission denied" }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(BrainSaveResponse.self, from: data)

        #expect(response.committed)
        #expect(!response.pushed)
        #expect(response.lastSyncedAt == nil)
        #expect(response.error == "permission denied")
    }

    @Test
    func decodesSaveResponseWithLastSync() throws {
        let data = """
        { "committed": true, "pushed": true, "lastSyncedAt": "2026-06-08T11:00:00.000Z" }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(BrainSaveResponse.self, from: data)

        #expect(response.committed)
        #expect(response.pushed)
        #expect(response.lastSyncedAt == "2026-06-08T11:00:00.000Z")
    }

    @Test
    func decodesStatusResponse() throws {
        let data = """
        {
          "files": [
            { "path": "notes/a.md", "status": "untracked" },
            { "path": "notes/b.md", "status": "modified" },
            { "path": "old.md", "status": "renamed", "renamedFrom": "older.md" }
          ],
          "count": 3,
          "upstream": "origin/main",
          "lastSyncedAt": "2026-06-08T12:00:00.000Z",
          "unpushedCommitCount": 2
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(BrainStatusResponse.self, from: data)

        #expect(response.count == 3)
        #expect(response.files.count == 3)
        #expect(response.files[0].status == .untracked)
        #expect(response.files[2].status == .renamed)
        #expect(response.files[2].renamedFrom == "older.md")
        #expect(response.upstream == "origin/main")
        #expect(response.lastSyncedAt == "2026-06-08T12:00:00.000Z")
        #expect(response.unpushedCommitCount == 2)
    }

    @Test
    func decodesBrainDiffResponse() throws {
        let data = """
        {
          "diff": "diff --git a/a.md b/a.md\\n--- a/a.md\\n+++ b/a.md\\n@@ -1 +1,2 @@\\n-old\\n+new\\n+extra",
          "omittedFileCount": 1
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(BrainDiffResponse.self, from: data)

        #expect(response.omittedFileCount == 1)
        #expect(response.diff.contains("+extra"))
    }

    @Test
    func saveFailureMessagePrefersBackendError() {
        let response = BrainSaveResponse(
            committed: true,
            pushed: false,
            lastSyncedAt: nil,
            error: "permission denied"
        )

        let message = brainSaveFailureMessage(result: response)

        #expect(message == "permission denied")
    }

    @Test
    func saveFailureMessageExplainsLocalCommitWithoutBackendError() {
        let response = BrainSaveResponse(
            committed: true,
            pushed: false,
            lastSyncedAt: nil,
            error: nil
        )

        let message = brainSaveFailureMessage(result: response)

        #expect(message == "Brain was saved locally, but push failed.")
    }

    @Test
    func saveFailureMessageUsesThrownErrorFallback() {
        let message = brainSaveFailureMessage(fallbackErrorDescription: "HTTP 409: Brain is not connected")

        #expect(message == "HTTP 409: Brain is not connected")
    }

    @Test
    func detectsBrainWorkspaceId() {
        #expect(isBrainWorkspaceId("brain"))
        #expect(!isBrainWorkspaceId("workspace-1"))
    }

    @Test
    func conversationLabelsAreWorkspaceAndBrainSpecific() {
        #expect(ConversationsSectionLabels.workspace.errorTitle == "Workspace Error")
        #expect(ConversationsSectionLabels.workspace.emptyDescription.contains("workspace"))
        #expect(ConversationsSectionLabels.brain.errorTitle == "Brain Error")
        #expect(ConversationsSectionLabels.brain.emptyDescription.contains("Brain"))
    }
}

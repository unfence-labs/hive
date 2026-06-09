import Testing
@testable import HiveMobileStoresCore

@Suite("Conversation surface models")
struct ConversationSurfaceModelsTests {
    @Test("Brain workspace uses the shared workspace conversation surface")
    func brainWorkspaceUsesSharedWorkspaceSurface() {
        let state = BrainState(
            exists: true,
            repoUrl: "https://github.com/example/brain",
            createdAt: "2026-06-09T15:00:00.000Z",
            lastSyncedAt: "2026-06-09T15:05:00.000Z"
        )

        let workspace = makeBrainWorkspace(from: state)

        #expect(workspace.id == BRAIN_WORKSPACE_ID)
        #expect(isBrainWorkspaceId(workspace.id))
        #expect(workspace.name == "Brain")
        #expect(workspace.projectName == "Brain")
        #expect(workspace.branch == "main")
        #expect(workspace.status == .idle)
        #expect(workspace.createdAt == state.createdAt)
        #expect(workspace.activeSessionId == nil)
        #expect(workspace.defaultBranch == nil)
    }

    @Test("Brain workspace tolerates missing state while loading")
    func brainWorkspaceToleratesMissingState() {
        let workspace = makeBrainWorkspace(from: nil)

        #expect(workspace.id == BRAIN_WORKSPACE_ID)
        #expect(workspace.createdAt == "")
    }
}

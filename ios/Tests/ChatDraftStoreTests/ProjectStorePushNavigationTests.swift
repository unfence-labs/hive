import Testing
@testable import HiveMobileStoresCore

@MainActor
private final class NoopHubConnection: HubConnectionClient {
    func connect() {}
    func cancel() {}
    func forceReconnect() {}
    func send(_ message: HubIncoming) async -> Bool { true }
    func sendSync(_ payload: HubSyncPayload, forceBootstrap: Bool) {}
    func probeLiveness() {}
}

@MainActor
private final class FetchRecorder {
    private let results: [[Project]]
    private(set) var callCount = 0

    init(_ results: [[Project]]) {
        self.results = results
    }

    func next() -> [Project] {
        let result = results[min(callCount, results.count - 1)]
        callCount += 1
        return result
    }
}

@MainActor
struct ProjectStorePushNavigationTests {
    @Test
    func resolvesLoadedWorkspaceWithoutRefreshing() async {
        let recorder = FetchRecorder([[project("p1", workspace: "ws-1")]])
        let store = makeStore(recorder)
        await store.refresh(force: true)

        let target = await store.resolvePushTarget(workspaceId: "ws-1", sessionId: "sess-1")

        #expect(target?.workspace.id == "ws-1")
        #expect(target?.sessionId == "sess-1")
        #expect(recorder.callCount == 1)
    }

    @Test
    func refreshesThenRetriesForUnknownWorkspace() async {
        let recorder = FetchRecorder([
            [project("p1", workspace: "ws-1")],
            [project("p1", workspace: "ws-1"), project("p2", workspace: "ws-2")]
        ])
        let store = makeStore(recorder)
        await store.refresh(force: true)

        let target = await store.resolvePushTarget(workspaceId: "ws-2", sessionId: nil)

        #expect(target?.workspace.id == "ws-2")
        #expect(target?.sessionId == nil)
        #expect(recorder.callCount == 2)
    }

    @Test
    func fallsBackSilentlyWhenWorkspaceStaysUnresolved() async {
        let recorder = FetchRecorder([[project("p1", workspace: "ws-1")]])
        let store = makeStore(recorder)
        await store.refresh(force: true)

        let target = await store.resolvePushTarget(workspaceId: "ws-archived", sessionId: "sess-x")

        #expect(target == nil)
        #expect(recorder.callCount == 2)
    }

    @Test
    func coldLaunchResolvesByRefreshingEmptyProjects() async {
        let recorder = FetchRecorder([[project("p1", workspace: "ws-1")]])
        let store = makeStore(recorder)

        let target = await store.resolvePushTarget(workspaceId: "ws-1", sessionId: nil)

        #expect(target?.workspace.id == "ws-1")
        #expect(recorder.callCount == 1)
    }

    private func makeStore(_ recorder: FetchRecorder) -> ProjectStore {
        let cache = ConversationStoreCache()
        let monitor = HubStatusMonitor(storeCache: cache) { _ in NoopHubConnection() }
        return ProjectStore(
            storeCache: cache,
            statusMonitor: monitor,
            fetchProjects: { recorder.next() },
            fetchPreferences: { .empty }
        )
    }

    private func project(_ id: String, workspace workspaceId: String) -> Project {
        Project(
            id: id,
            name: id,
            url: "https://github.com/acme/\(id).git",
            createdAt: "2026-01-01T00:00:00Z",
            workspaces: [
                Workspace(
                    id: workspaceId,
                    name: workspaceId,
                    branch: "main",
                    status: .idle,
                    createdAt: "2026-01-01T00:00:00Z",
                    activeSessionId: nil,
                    projectName: id,
                    defaultBranch: "main",
                    sessionCount: 1,
                    projectId: id,
                    hasFavicon: false
                )
            ],
            hasFavicon: false
        )
    }
}

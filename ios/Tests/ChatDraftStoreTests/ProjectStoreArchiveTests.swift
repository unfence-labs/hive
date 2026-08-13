import Foundation
import Testing
@testable import HiveMobileStoresCore

private struct ArchiveError: Error {}

@MainActor
private final class ArchiveFakeHubConnection: HubConnectionClient {
    func connect() {}
    func cancel() {}
    func forceReconnect() {}
    func send(_ message: HubIncoming) async -> Bool { true }
    func sendSync(_ payload: HubSyncPayload, forceBootstrap: Bool) {}
    func probeLiveness() {}
}

/// Holds an archive request open until the test resolves it, so mid-flight
/// state can be asserted deterministically.
@MainActor
private final class ArchiveGate {
    private var continuation: CheckedContinuation<Void, any Error>?
    private var pendingResult: Result<Void, any Error>?

    func wait() async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, any Error>) in
            if let result = pendingResult {
                pendingResult = nil
                cont.resume(with: result)
            } else {
                continuation = cont
            }
        }
    }

    func resume(_ result: Result<Void, any Error> = .success(())) {
        if let cont = continuation {
            continuation = nil
            cont.resume(with: result)
        } else {
            pendingResult = result
        }
    }
}

@MainActor
struct ProjectStoreArchiveTests {
    private func sampleWorkspace(id: String) -> Workspace {
        Workspace(
            id: id,
            name: "Workspace \(id)",
            branch: "hive/\(id)",
            status: .idle,
            createdAt: "2026-01-01T00:00:00.000Z",
            activeSessionId: nil,
            projectName: "Project p1",
            defaultBranch: "main",
            sessionCount: 0,
            projectId: "p1",
            hasFavicon: nil
        )
    }

    private func sampleProject() -> Project {
        Project(
            id: "p1",
            name: "Project p1",
            url: nil,
            createdAt: "2026-01-01T00:00:00.000Z",
            workspaces: [
                sampleWorkspace(id: "w1"),
                sampleWorkspace(id: "w2"),
                sampleWorkspace(id: "w3")
            ]
        )
    }

    private func makeStore(
        archiveWorkspace: @escaping @MainActor (String) async throws -> Void
    ) -> (store: ProjectStore, cache: ConversationStoreCache) {
        let cache = ConversationStoreCache()
        let monitor = HubStatusMonitor(storeCache: cache) { _ in ArchiveFakeHubConnection() }
        let store = ProjectStore(
            storeCache: cache,
            statusMonitor: monitor,
            fetchProjects: { [self.sampleProject()] },
            fetchPreferences: { .empty },
            archiveWorkspace: archiveWorkspace
        )
        return (store, cache)
    }

    private func workspaceIds(_ store: ProjectStore) -> [String] {
        store.projects.first?.workspaces.map(\.id) ?? []
    }

    @Test
    func optimisticRemovalHidesWorkspaceWhileRequestInFlight() async {
        let gate = ArchiveGate()
        let (store, _) = makeStore(archiveWorkspace: { _ in try await gate.wait() })
        await store.refresh()
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])

        let task = Task { await store.archiveWorkspace(id: "w2") }
        for _ in 0..<5 { await Task.yield() }

        #expect(workspaceIds(store) == ["w1", "w3"])
        #expect(store.pendingArchiveIds == ["w2"])

        gate.resume()
        await task.value

        #expect(workspaceIds(store) == ["w1", "w3"])
        #expect(store.pendingArchiveIds.isEmpty)
    }

    @Test
    func successfulArchiveKeepsRemovalAndEvictsConversationStore() async {
        let (store, cache) = makeStore(archiveWorkspace: { _ in })
        await store.refresh()
        _ = cache.getOrCreate("w2")
        #expect(cache.stores["w2"] != nil)

        await store.archiveWorkspace(id: "w2")

        #expect(workspaceIds(store) == ["w1", "w3"])
        #expect(store.pendingArchiveIds.isEmpty)
        #expect(store.archiveFailed == false)
        #expect(cache.stores["w2"] == nil)
    }

    @Test
    func failedArchiveRestoresWorkspaceBetweenSiblings() async {
        let (store, _) = makeStore(archiveWorkspace: { _ in throw ArchiveError() })
        await store.refresh()

        await store.archiveWorkspace(id: "w2")

        #expect(workspaceIds(store) == ["w1", "w2", "w3"])
        #expect(store.pendingArchiveIds.isEmpty)
        #expect(store.archiveFailed == true)
    }

    @Test
    func refreshMidFlightDoesNotResurrectPendingArchive() async {
        let gate = ArchiveGate()
        let (store, _) = makeStore(archiveWorkspace: { _ in try await gate.wait() })
        await store.refresh()

        let task = Task { await store.archiveWorkspace(id: "w2") }
        for _ in 0..<5 { await Task.yield() }
        #expect(workspaceIds(store) == ["w1", "w3"])

        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w3"])

        gate.resume()
        await task.value

        #expect(workspaceIds(store) == ["w1", "w3"])
        #expect(store.pendingArchiveIds.isEmpty)
        #expect(store.archiveFailed == false)
    }

    @Test
    func acknowledgeArchiveFailureClearsFlag() async {
        let (store, _) = makeStore(archiveWorkspace: { _ in throw ArchiveError() })
        await store.refresh()

        await store.archiveWorkspace(id: "w2")
        #expect(store.archiveFailed == true)

        store.acknowledgeArchiveFailure()
        #expect(store.archiveFailed == false)
    }
}

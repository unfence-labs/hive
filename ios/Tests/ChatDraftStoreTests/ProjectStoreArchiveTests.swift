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
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var hasEntered = false

    func wait() async throws {
        hasEntered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, any Error>) in
            if let result = pendingResult {
                pendingResult = nil
                cont.resume(with: result)
            } else {
                continuation = cont
            }
        }
    }

    /// Suspends until `wait()` has been entered, so tests assert in-flight
    /// state against a guaranteed interleaving instead of arbitrary yields.
    func entered() async {
        if hasEntered { return }
        await withCheckedContinuation { enteredContinuation = $0 }
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
private final class Counter {
    var value = 0
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

    private func sampleProject(workspaceIds: [String] = ["w1", "w2", "w3"]) -> Project {
        Project(
            id: "p1",
            name: "Project p1",
            url: nil,
            createdAt: "2026-01-01T00:00:00.000Z",
            workspaces: workspaceIds.map { sampleWorkspace(id: $0) }
        )
    }

    /// Builds a fetch closure that returns `payloads` in order, repeating the
    /// last one once the sequence is exhausted.
    private func sequencedFetch(_ payloads: [[Project]]) -> @MainActor () async throws -> [Project] {
        let fetchCount = Counter()
        return {
            let index = min(fetchCount.value, payloads.count - 1)
            fetchCount.value += 1
            return payloads[index]
        }
    }

    private func makeStore(
        archiveWorkspace: @escaping @MainActor (String) async throws -> Void,
        fetchProjects: (@MainActor () async throws -> [Project])? = nil
    ) -> (store: ProjectStore, cache: ConversationStoreCache) {
        let cache = ConversationStoreCache()
        let monitor = HubStatusMonitor(storeCache: cache) { _ in ArchiveFakeHubConnection() }
        let store = ProjectStore(
            storeCache: cache,
            statusMonitor: monitor,
            fetchProjects: fetchProjects ?? { [self.sampleProject()] },
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
        await gate.entered()

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
        await gate.entered()
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
    func staleRefreshResolvingAfterArchiveSuccessDoesNotResurrect() async {
        let fetchGate = ArchiveGate()
        let fetchCount = Counter()
        let staleProjects = [sampleProject()]
        let (store, _) = makeStore(
            archiveWorkspace: { _ in },
            fetchProjects: {
                fetchCount.value += 1
                if fetchCount.value > 1 {
                    try await fetchGate.wait()
                }
                return staleProjects
            }
        )
        await store.refresh()
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])

        // Second refresh suspends on a fetch whose snapshot still contains w2,
        // while the archive completes and clears its pending id underneath.
        let refreshTask = Task { await store.refresh(force: true) }
        await fetchGate.entered()

        await store.archiveWorkspace(id: "w2")
        #expect(workspaceIds(store) == ["w1", "w3"])

        fetchGate.resume()
        await refreshTask.value

        #expect(workspaceIds(store) == ["w1", "w3"])
        #expect(store.pendingArchiveIds.isEmpty)
    }

    @Test
    func failedArchiveIsNotTombstonedByLaterRefresh() async {
        let (store, _) = makeStore(archiveWorkspace: { _ in throw ArchiveError() })
        await store.refresh()

        await store.archiveWorkspace(id: "w2")
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])

        // A failed archive leaves the workspace alive server-side; it must
        // survive subsequent refreshes, not be treated as archived.
        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])
    }

    @Test
    func tombstoneDropsOnceServerConfirmsRemovalSoRestoreShowsWorkspace() async {
        let (store, _) = makeStore(
            archiveWorkspace: { _ in },
            fetchProjects: sequencedFetch([
                [sampleProject()],
                [sampleProject(workspaceIds: ["w1", "w3"])],
                [sampleProject()]
            ])
        )
        await store.refresh()
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])

        await store.archiveWorkspace(id: "w2")
        #expect(workspaceIds(store) == ["w1", "w3"])

        // The server no longer returns w2: the archive is confirmed and the
        // tombstone is dropped.
        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w3"])

        // w2 was restored on another client with the same id; it must show.
        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w2", "w3"])
    }

    @Test
    func staleRefreshStillContainingArchivedIdKeepsItHidden() async {
        let (store, _) = makeStore(archiveWorkspace: { _ in })
        await store.refresh()

        await store.archiveWorkspace(id: "w2")
        #expect(workspaceIds(store) == ["w1", "w3"])

        // Every refresh still returns w2 (stale snapshots): the tombstone
        // stays in place until the server stops returning the id.
        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w3"])

        await store.refresh(force: true)
        #expect(workspaceIds(store) == ["w1", "w3"])
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

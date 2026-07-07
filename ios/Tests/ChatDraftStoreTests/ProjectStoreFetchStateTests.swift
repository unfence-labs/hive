import Foundation
import Testing
@testable import HiveMobileStoresCore

@MainActor
struct ProjectStoreFetchStateTests {
    private func sampleProject(id: String = "p1") -> Project {
        Project(
            id: id,
            name: "Project \(id)",
            url: nil,
            createdAt: "2026-01-01T00:00:00.000Z",
            workspaces: []
        )
    }

    private func makeStore(
        fetchProjects: @escaping () async throws -> [Project],
        fetchUiPreferences: @escaping () async throws -> UiPreferencesPayload = { .empty }
    ) -> ProjectStore {
        ProjectStore(
            storeCache: ConversationStoreCache(),
            fetchProjects: fetchProjects,
            fetchPreferences: fetchUiPreferences
        )
    }

    @Test
    func emptyPlusUnreachableFailureClassifiesUnreachable() async {
        let store = makeStore(fetchProjects: {
            throw APIError.networkError(URLError(.cannotConnectToHost))
        })

        await store.refresh()

        #expect(store.projects.isEmpty)
        #expect(store.fetchFailure == .unreachable)
        #expect(store.hasLoadedSuccessfully == false)
        #expect(store.refreshFailedWithCachedData == false)
        #expect(store.isLoading == false)
    }

    @Test
    func emptyPlusUnauthorizedFailureClassifiesAuthentication() async {
        let store = makeStore(fetchProjects: {
            throw APIError.httpError(statusCode: 401, message: "unauthorized")
        })

        await store.refresh()

        #expect(store.projects.isEmpty)
        #expect(store.fetchFailure == .authentication)
        #expect(store.hasLoadedSuccessfully == false)
    }

    @Test
    func serverErrorClassifiesOther() async {
        let store = makeStore(fetchProjects: {
            throw APIError.httpError(statusCode: 500, message: "boom")
        })

        await store.refresh()

        #expect(store.fetchFailure == .other)
    }

    @Test
    func forbiddenFailureClassifiesAuthentication() async {
        let store = makeStore(fetchProjects: {
            throw APIError.httpError(statusCode: 403, message: "forbidden")
        })

        await store.refresh()

        #expect(store.fetchFailure == .authentication)
    }

    @Test
    func decodingFailureClassifiesOther() async {
        let store = makeStore(fetchProjects: {
            throw APIError.decodingError(URLError(.cannotDecodeContentData))
        })

        await store.refresh()

        #expect(store.fetchFailure == .other)
    }

    @Test
    func emptyPlusSuccessSelectsOnboardingNotFailure() async {
        let store = makeStore(fetchProjects: { [] })

        await store.refresh()

        #expect(store.projects.isEmpty)
        #expect(store.fetchFailure == nil)
        #expect(store.hasLoadedSuccessfully == true)
    }

    @Test
    func cachedDataFailedRefreshKeepsCacheAndSignalsFailure() async {
        var shouldFail = false
        let store = makeStore(fetchProjects: {
            if shouldFail { throw APIError.networkError(URLError(.timedOut)) }
            return [self.sampleProject()]
        })

        await store.refresh()
        #expect(store.projects.count == 1)
        #expect(store.fetchFailure == nil)

        shouldFail = true
        await store.refresh(force: true, userInitiated: true)

        #expect(store.projects.count == 1)
        #expect(store.fetchFailure == .unreachable)
        #expect(store.refreshFailedWithCachedData == true)

        store.acknowledgeRefreshFailure()
        #expect(store.refreshFailedWithCachedData == false)
    }

    @Test
    func backgroundRefreshFailureWithCacheStaysSilent() async {
        var shouldFail = false
        let store = makeStore(fetchProjects: {
            if shouldFail { throw APIError.networkError(URLError(.timedOut)) }
            return [self.sampleProject()]
        })

        await store.refresh()
        shouldFail = true
        await store.refresh(force: true)

        #expect(store.projects.count == 1)
        #expect(store.fetchFailure == .unreachable)
        #expect(store.refreshFailedWithCachedData == false)
    }

    @Test
    func successAfterFailureClearsAllFailureState() async {
        var shouldFail = true
        let store = makeStore(fetchProjects: {
            if shouldFail { throw APIError.networkError(URLError(.notConnectedToInternet)) }
            return [self.sampleProject()]
        })

        await store.refresh()
        #expect(store.fetchFailure == .unreachable)
        #expect(store.projects.isEmpty)

        shouldFail = false
        await store.refresh(force: true)

        #expect(store.fetchFailure == nil)
        #expect(store.projects.count == 1)
        #expect(store.hasLoadedSuccessfully == true)
        #expect(store.isLoading == false)
    }

    @Test
    func retryShowsInFlightLoadingBeforeResolving() async {
        final class Box { var store: ProjectStore? }
        let box = Box()
        var loadingDuringFetch = false
        let store = makeStore(fetchProjects: {
            loadingDuringFetch = box.store?.isLoading ?? false
            return [self.sampleProject()]
        })
        box.store = store

        await store.refresh()

        #expect(loadingDuringFetch == true)
        #expect(store.isLoading == false)
        #expect(store.fetchFailure == nil)
    }

    @Test
    func retryFailingAgainPreservesFailureState() async {
        let store = makeStore(fetchProjects: {
            throw APIError.networkError(URLError(.cannotConnectToHost))
        })

        await store.refresh()
        #expect(store.fetchFailure == .unreachable)

        await store.refresh(force: true)
        #expect(store.fetchFailure == .unreachable)
        #expect(store.projects.isEmpty)
    }
}

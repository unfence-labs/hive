import Foundation
import Observation

/// App-level store for projects and live workspace monitoring.
///
/// Lives in the SwiftUI environment so data survives navigation cycles.
/// Uses a stale-while-revalidate pattern: existing data stays visible
/// while a background refresh is in flight.
@MainActor
@Observable
final class ProjectStore {
    /// Why the last project fetch failed, classified so the Hub can show
    /// accurate copy. `nil` once a fetch succeeds.
    enum FetchFailure: Equatable {
        case unreachable
        case authentication
        case other
    }

    private(set) var projects: [Project] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var fetchFailure: FetchFailure?
    private(set) var refreshFailedWithCachedData = false
    private(set) var creatingWorkspaceProjectIds: Set<String> = []
    private(set) var isCreatingProject = false
    private(set) var cloningRepoName: String?
    private(set) var uiPreferences: UiPreferencesPayload = .empty

    /// Set after workspace creation so HiveApp can navigate to it.
    var pendingNavigation: Workspace?

    /// Set alongside `pendingNavigation` when a push tap targets a specific session.
    var pendingSessionNavigation: PendingSessionNavigation?

    let statusMonitor: HubStatusMonitor

    private let api: APIClient
    private let fetchProjectsClosure: @MainActor () async throws -> [Project]
    private let fetchPreferencesClosure: @MainActor () async throws -> UiPreferencesPayload
    private var hasFetchedOnce = false
    private var lastRefreshedAt = Date.distantPast

    init(
        storeCache: ConversationStoreCache,
        statusMonitor: HubStatusMonitor? = nil,
        fetchProjects: (@MainActor () async throws -> [Project])? = nil,
        fetchPreferences: (@MainActor () async throws -> UiPreferencesPayload)? = nil
    ) {
        let client = APIClient()
        self.api = client
        self.statusMonitor = statusMonitor ?? HubStatusMonitor(storeCache: storeCache)
        self.fetchProjectsClosure = fetchProjects ?? { try await client.fetchProjects() }
        self.fetchPreferencesClosure = fetchPreferences ?? { try await client.fetchUiPreferences() }
    }

    /// Whether the store has never successfully loaded data yet.
    var isInitialLoad: Bool { !hasFetchedOnce }

    /// Whether a fetch has ever succeeded — gates the No Projects onboarding
    /// state so it never masquerades as a failed fetch.
    var hasLoadedSuccessfully: Bool { hasFetchedOnce }

    /// Sync the hub monitor with every workspace plus the synthetic Brain id, so
    /// the Brain always stays subscribed (streaming/done events, send wiring) and
    /// is never evicted by `sync`.
    private func syncMonitoredWorkspaces() {
        let ids = projects.flatMap(\.workspaces).map(\.id) + [BRAIN_WORKSPACE_ID]
        statusMonitor.sync(workspaceIds: ids)
    }

    func createWorkspace(in projectId: String) async {
        guard !creatingWorkspaceProjectIds.contains(projectId) else { return }

        creatingWorkspaceProjectIds.insert(projectId)
        errorMessage = nil
        defer { creatingWorkspaceProjectIds.remove(projectId) }

        do {
            let created = try await api.createWorkspace(projectId: projectId)
            guard let projectIndex = projects.firstIndex(where: { $0.id == projectId }) else {
                return
            }

            let project = projects[projectIndex]
            let workspace = Workspace(
                id: created.id,
                name: created.name,
                branch: created.branch,
                status: created.status,
                createdAt: created.createdAt,
                activeSessionId: created.activeSessionId,
                projectName: project.name,
                defaultBranch: created.defaultBranch,
                sessionCount: 0,
                projectId: project.id,
                hasFavicon: project.hasFavicon
            )

            if !projects[projectIndex].workspaces.contains(where: { $0.id == workspace.id }) {
                projects[projectIndex].workspaces.append(workspace)
            }

            statusMonitor.seedLastActivityDates(from: [workspace])
            syncMonitoredWorkspaces()
            pendingNavigation = workspace
        } catch is CancellationError {
            // Ignore cancelled create requests when leaving the screen.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createProject(url: String) async {
        await createProjectWithWorkspace(displayName: Self.extractRepoName(from: url)) {
            try await api.createProject(url: url)
        }
    }

    func createNewProject(name: String, visibility: String?) async {
        await createProjectWithWorkspace(displayName: name) {
            try await api.createNewProject(name: name, visibility: visibility)
        }
    }

    private func createProjectWithWorkspace(
        displayName: String,
        apiCall: () async throws -> Project
    ) async {
        guard !isCreatingProject else { return }

        isCreatingProject = true
        cloningRepoName = displayName
        errorMessage = nil

        do {
            let project = try await apiCall()
            let created = try await api.createWorkspace(projectId: project.id)

            let workspace = Workspace(
                id: created.id,
                name: created.name,
                branch: created.branch,
                status: created.status,
                createdAt: created.createdAt,
                activeSessionId: created.activeSessionId,
                projectName: project.name,
                defaultBranch: created.defaultBranch,
                sessionCount: 0,
                projectId: project.id,
                hasFavicon: project.hasFavicon
            )

            var newProject = project
            newProject.workspaces = [workspace]
            statusMonitor.seedLastActivityDates(from: [workspace])
            projects.insert(newProject, at: 0)

            syncMonitoredWorkspaces()
            pendingNavigation = workspace
        } catch is CancellationError {
            // Ignore
        } catch {
            errorMessage = error.localizedDescription
        }

        cloningRepoName = nil
        isCreatingProject = false
    }

    func archiveWorkspace(id: String) async {
        do {
            try await api.archiveWorkspace(workspaceId: id)
            for i in projects.indices {
                projects[i].workspaces.removeAll { $0.id == id }
            }
            syncMonitoredWorkspaces()
        } catch is CancellationError {
            // Ignore
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Refresh projects from the API. Shows existing data while loading.
    /// `userInitiated` marks an explicit pull-to-refresh so a failure over
    /// cached data can surface a transient notice.
    func refresh(force: Bool = false, userInitiated: Bool = false) async {
        if !force, hasFetchedOnce, Date().timeIntervalSince(lastRefreshedAt) < 45 { return }
        isLoading = true
        errorMessage = nil
        refreshFailedWithCachedData = false
        do {
            async let projectsTask = fetchProjectsClosure()
            async let preferencesTask = fetchPreferencesClosure()

            var fresh = try await projectsTask
            let preferences = (try? await preferencesTask) ?? .empty

            // Enrich workspaces with parent project metadata for downstream views.
            for i in fresh.indices {
                for j in fresh[i].workspaces.indices {
                    fresh[i].workspaces[j].projectId = fresh[i].id
                    fresh[i].workspaces[j].hasFavicon = fresh[i].hasFavicon
                }
            }
            statusMonitor.seedLastActivityDates(from: fresh.flatMap(\.workspaces))
            projects = fresh
            uiPreferences = preferences
            hasFetchedOnce = true
            lastRefreshedAt = Date()
            fetchFailure = nil
            syncMonitoredWorkspaces()
        } catch is CancellationError {
            // View disappeared — ignore
        } catch {
            fetchFailure = Self.classify(error)
            if !projects.isEmpty, userInitiated {
                refreshFailedWithCachedData = true
            }
        }
        isLoading = false
    }

    func resolvePushTarget(workspaceId: String, sessionId: String?) async -> PushNavigationTarget? {
        if let target = Self.findTarget(workspaceId: workspaceId, sessionId: sessionId, in: projects) {
            return target
        }
        await refresh(force: true)
        return Self.findTarget(workspaceId: workspaceId, sessionId: sessionId, in: projects)
    }

    static func findTarget(workspaceId: String, sessionId: String?, in projects: [Project]) -> PushNavigationTarget? {
        for project in projects {
            if let workspace = project.workspaces.first(where: { $0.id == workspaceId }) {
                return PushNavigationTarget(workspace: workspace, sessionId: sessionId)
            }
        }
        return nil
    }

    /// Dismiss the transient pull-to-refresh failure notice.
    func acknowledgeRefreshFailure() {
        refreshFailedWithCachedData = false
    }

    private static func classify(_ error: Error) -> FetchFailure {
        if let apiError = error as? APIError {
            switch apiError {
            case .httpError(let statusCode, _):
                return statusCode == 401 || statusCode == 403 ? .authentication : .other
            case .networkError, .invalidURL:
                return .unreachable
            case .decodingError:
                return .other
            }
        }
        if error is URLError {
            return .unreachable
        }
        return .other
    }

    private static func extractRepoName(from url: String) -> String {
        let trimmed = url.hasSuffix("/") ? String(url.dropLast()) : url
        guard let last = trimmed.split(separator: "/").last else { return "repository" }
        var name = String(last)
        if name.hasSuffix(".git") { name = String(name.dropLast(4)) }
        return name.isEmpty ? "repository" : name
    }
}

struct PushNavigationTarget: Equatable {
    let workspace: Workspace
    let sessionId: String?
}

struct PendingSessionNavigation: Equatable {
    let workspaceId: String
    let sessionId: String
}

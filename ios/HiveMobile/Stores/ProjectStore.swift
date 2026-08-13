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
    private(set) var pendingArchiveIds: Set<String> = []
    private(set) var archiveFailed = false
    private(set) var isCreatingProject = false
    private(set) var cloningRepoName: String?
    private(set) var uiPreferences: UiPreferencesPayload = .empty

    /// Set after workspace creation so HiveApp can navigate to it.
    var pendingNavigation: Workspace?

    let statusMonitor: HubStatusMonitor

    private let api: APIClient
    private let fetchProjectsClosure: @MainActor () async throws -> [Project]
    private let fetchPreferencesClosure: @MainActor () async throws -> UiPreferencesPayload
    private let archiveWorkspaceClosure: @MainActor (String) async throws -> Void
    private var hasFetchedOnce = false
    private var lastRefreshedAt = Date.distantPast
    /// Session-lifetime tombstones for successfully archived workspaces. There
    /// is no restore path and ids are never reused, so an archived id can never
    /// legitimately reappear; stripping these from refresh results guards
    /// against a stale snapshot fetched before the archive completed.
    private var archivedIds: Set<String> = []

    init(
        storeCache: ConversationStoreCache,
        statusMonitor: HubStatusMonitor? = nil,
        fetchProjects: (@MainActor () async throws -> [Project])? = nil,
        fetchPreferences: (@MainActor () async throws -> UiPreferencesPayload)? = nil,
        archiveWorkspace: (@MainActor (String) async throws -> Void)? = nil
    ) {
        let client = APIClient()
        self.api = client
        self.statusMonitor = statusMonitor ?? HubStatusMonitor(storeCache: storeCache)
        self.fetchProjectsClosure = fetchProjects ?? { try await client.fetchProjects() }
        self.fetchPreferencesClosure = fetchPreferences ?? { try await client.fetchUiPreferences() }
        self.archiveWorkspaceClosure = archiveWorkspace ?? { try await client.archiveWorkspace(workspaceId: $0) }
    }

    /// Whether the store has never successfully loaded data yet.
    var isInitialLoad: Bool { !hasFetchedOnce }

    /// Whether a fetch has ever succeeded — gates the No Projects onboarding
    /// state so it never masquerades as a failed fetch.
    var hasLoadedSuccessfully: Bool { hasFetchedOnce }

    /// Sync the hub monitor with every workspace plus the synthetic Brain id, so
    /// the Brain always stays subscribed (streaming/done events, send wiring) and
    /// is never evicted by `sync`. Workspaces with an in-flight archive stay
    /// subscribed so their ConversationStore survives until the outcome is known.
    private func syncMonitoredWorkspaces() {
        let ids = projects.flatMap(\.workspaces).map(\.id) + pendingArchiveIds + [BRAIN_WORKSPACE_ID]
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

    func createProject(url: String) async -> String? {
        await createProjectWithWorkspace(displayName: Self.extractRepoName(from: url)) {
            try await api.createProject(url: url)
        }
    }

    func createNewProject(name: String, visibility: String?) async -> String? {
        await createProjectWithWorkspace(displayName: name) {
            try await api.createNewProject(name: name, visibility: visibility)
        }
    }

    private func createProjectWithWorkspace(
        displayName: String,
        apiCall: () async throws -> Project
    ) async -> String? {
        guard !isCreatingProject else { return "A project is already being created." }

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
            cloningRepoName = nil
            isCreatingProject = false
            return nil
        } catch is CancellationError {
            cloningRepoName = nil
            isCreatingProject = false
            return nil
        } catch {
            cloningRepoName = nil
            isCreatingProject = false
            return error.localizedDescription
        }
    }

    func archiveWorkspace(id: String) async {
        guard !pendingArchiveIds.contains(id) else { return }
        guard
            let projectIndex = projects.firstIndex(where: { project in
                project.workspaces.contains(where: { $0.id == id })
            }),
            let workspaceIndex = projects[projectIndex].workspaces.firstIndex(where: { $0.id == id })
        else { return }

        // Capture removal context, then remove optimistically before the request.
        let projectId = projects[projectIndex].id
        let siblings = projects[projectIndex].workspaces
        let workspace = siblings[workspaceIndex]
        let previousId = workspaceIndex > 0 ? siblings[workspaceIndex - 1].id : nil
        let nextId = workspaceIndex < siblings.count - 1 ? siblings[workspaceIndex + 1].id : nil

        projects[projectIndex].workspaces.remove(at: workspaceIndex)
        pendingArchiveIds.insert(id)
        archiveFailed = false

        do {
            try await archiveWorkspaceClosure(id)
            pendingArchiveIds.remove(id)
            archivedIds.insert(id)
            syncMonitoredWorkspaces()
        } catch {
            pendingArchiveIds.remove(id)
            restoreWorkspace(
                workspace,
                inProject: projectId,
                previousId: previousId,
                nextId: nextId,
                originalIndex: workspaceIndex
            )
            if !(error is CancellationError) {
                archiveFailed = true
            }
        }
    }

    /// Re-insert a workspace after a failed archive. Anchoring on siblings
    /// (rather than a raw index) keeps concurrent failed archives converging
    /// to the original order.
    private func restoreWorkspace(
        _ workspace: Workspace,
        inProject projectId: String,
        previousId: String?,
        nextId: String?,
        originalIndex: Int
    ) {
        guard let projectIndex = projects.firstIndex(where: { $0.id == projectId }) else { return }
        guard !projects[projectIndex].workspaces.contains(where: { $0.id == workspace.id }) else { return }

        let workspaces = projects[projectIndex].workspaces
        let insertionIndex: Int
        if let nextId, let nextIndex = workspaces.firstIndex(where: { $0.id == nextId }) {
            insertionIndex = nextIndex
        } else if let previousId, let previousIndex = workspaces.firstIndex(where: { $0.id == previousId }) {
            insertionIndex = previousIndex + 1
        } else {
            insertionIndex = min(originalIndex, workspaces.count)
        }
        projects[projectIndex].workspaces.insert(workspace, at: insertionIndex)
    }

    /// Dismiss the transient archive failure notice.
    func acknowledgeArchiveFailure() {
        archiveFailed = false
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
            // A refresh must not resurrect an archived workspace: neither one
            // whose archive is still in flight, nor one from a stale snapshot
            // fetched before an archive completed.
            let hiddenIds = pendingArchiveIds.union(archivedIds)
            if !hiddenIds.isEmpty {
                for i in fresh.indices {
                    fresh[i].workspaces.removeAll { hiddenIds.contains($0.id) }
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

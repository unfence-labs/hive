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
    private(set) var projects: [Project] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var creatingWorkspaceProjectIds: Set<String> = []

    let statusMonitor = HubStatusMonitor()

    private let api = APIClient()
    private var hasFetchedOnce = false

    /// Whether the store has never successfully loaded data yet.
    var isInitialLoad: Bool { !hasFetchedOnce }

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

            let allWorkspaceIds = projects.flatMap(\.workspaces).map(\.id)
            statusMonitor.sync(workspaceIds: allWorkspaceIds)
        } catch is CancellationError {
            // Ignore cancelled create requests when leaving the screen.
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Refresh projects from the API. Shows existing data while loading.
    func refresh() async {
        isLoading = true
        errorMessage = nil
        do {
            var fresh = try await api.fetchProjects()
            // Enrich workspaces with parent project metadata for downstream views.
            for i in fresh.indices {
                for j in fresh[i].workspaces.indices {
                    fresh[i].workspaces[j].projectId = fresh[i].id
                    fresh[i].workspaces[j].hasFavicon = fresh[i].hasFavicon
                }
            }
            projects = fresh
            hasFetchedOnce = true
            let allWorkspaceIds = fresh.flatMap(\.workspaces).map(\.id)
            statusMonitor.sync(workspaceIds: allWorkspaceIds)
        } catch is CancellationError {
            // View disappeared — ignore
        } catch {
            // Only surface error if we have no cached data to show
            if projects.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}

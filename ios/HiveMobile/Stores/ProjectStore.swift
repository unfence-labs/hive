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

    let statusMonitor = HubStatusMonitor()

    private let api = APIClient()
    private var hasFetchedOnce = false

    /// Whether the store has never successfully loaded data yet.
    var isInitialLoad: Bool { !hasFetchedOnce }

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

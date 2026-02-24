import Foundation
import Observation

/// Lightweight bridge for push notification taps → HubStatusMonitor.
///
/// When a push notification is tapped (possibly from a killed state), the AppDelegate
/// inserts the workspace ID here. On next app launch, HiveApp merges these into
/// HubStatusMonitor.completedWorkspaces so the green dot appears.
@MainActor
@Observable
final class CompletedWorkspacesStore {
    static let shared = CompletedWorkspacesStore()

    private(set) var pending: Set<String>

    private let key = "pushCompletedWorkspaces"

    private init() {
        let stored = UserDefaults.standard.stringArray(forKey: key) ?? []
        pending = Set(stored)
    }

    func insert(_ workspaceId: String) {
        pending.insert(workspaceId)
        persist()
    }

    func clearAll() {
        guard !pending.isEmpty else { return }
        pending.removeAll()
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(Array(pending), forKey: key)
    }
}

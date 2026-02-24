import Foundation
import Observation

/// App-level cache for ConversationStore instances, keyed by workspace ID.
///
/// Stores survive navigation (ChatView mount/unmount) so streaming state
/// is preserved when the user navigates back to the Hub and returns.
/// Injected via `@Environment` and also held by `HubStatusMonitor` for
/// event routing.
@MainActor
@Observable
final class ConversationStoreCache {
    private(set) var stores: [String: ConversationStore] = [:]

    /// Returns the cached store or creates a new one.
    func getOrCreate(_ workspaceId: String) -> ConversationStore {
        if let store = stores[workspaceId] { return store }
        let store = ConversationStore()
        stores[workspaceId] = store
        return store
    }

    /// Removes the store for a workspace (on archive/delete).
    func evict(_ workspaceId: String) {
        stores.removeValue(forKey: workspaceId)
    }
}

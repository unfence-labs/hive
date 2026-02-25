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

    /// Called when a new store is created, so HubStatusMonitor can wire the send closure.
    var onStoreCreated: ((String, ConversationStore) -> Void)?

    /// Returns the cached store or creates a new one.
    func getOrCreate(_ workspaceId: String) -> ConversationStore {
        if let store = stores[workspaceId] { return store }
        let store = ConversationStore()
        stores[workspaceId] = store
        onStoreCreated?(workspaceId, store)
        return store
    }

    /// Removes the store for a workspace (on archive/delete).
    func evict(_ workspaceId: String) {
        stores.removeValue(forKey: workspaceId)
    }

    /// Clear all streaming state from every cached store.
    /// Called before force-reconnect so bootstrap data writes into a clean slate.
    func clearAllStreamingState() {
        for store in stores.values {
            store.sessionStreams.removeAll()
        }
    }
}

import Foundation
import Observation
import UIKit

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

    init() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                for store in self.stores.values { store.handleMemoryWarning() }
            }
        }
    }

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
}

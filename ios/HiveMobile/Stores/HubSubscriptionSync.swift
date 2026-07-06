import Foundation

struct HubSyncPayload: Equatable {
    let workspaceIds: [String]
    let focusWorkspaces: [String]
    let prWorkspaces: [String]
}

struct HubSubscriptionSync {
    private(set) var subscribedWorkspaceIds: Set<String> = []
    private(set) var visiblePrWorkspaceIds: Set<String> = []
    private(set) var viewingWorkspaceId: String?

    var prWorkspaces: Set<String> {
        var ids = visiblePrWorkspaceIds
        if let viewingWorkspaceId, viewingWorkspaceId != BRAIN_WORKSPACE_ID {
            ids.insert(viewingWorkspaceId)
        }
        ids.remove(BRAIN_WORKSPACE_ID)
        return ids
    }

    var payload: HubSyncPayload {
        HubSyncPayload(
            workspaceIds: subscribedWorkspaceIds.sorted(),
            focusWorkspaces: viewingWorkspaceId.map { [$0] } ?? [],
            prWorkspaces: prWorkspaces.sorted()
        )
    }

    mutating func setSubscriptions(_ desired: Set<String>) -> (removed: Set<String>, payload: HubSyncPayload)? {
        guard desired != subscribedWorkspaceIds else { return nil }
        let removed = subscribedWorkspaceIds.subtracting(desired)
        subscribedWorkspaceIds = desired
        return (removed, payload)
    }

    mutating func setViewingWorkspace(_ id: String?) -> HubSyncPayload? {
        changedPayload { $0.viewingWorkspaceId = id }
    }

    mutating func setVisiblePrWorkspaces(_ ids: Set<String>) -> HubSyncPayload? {
        changedPayload { $0.visiblePrWorkspaceIds = ids }
    }

    mutating func returnToHub(visiblePrWorkspaces ids: Set<String>) -> HubSyncPayload? {
        changedPayload {
            $0.viewingWorkspaceId = nil
            $0.visiblePrWorkspaceIds = ids
        }
    }

    private mutating func changedPayload(_ mutate: (inout Self) -> Void) -> HubSyncPayload? {
        let before = payload
        mutate(&self)
        let after = payload
        return after == before ? nil : after
    }
}

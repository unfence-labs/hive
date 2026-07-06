import Testing
@testable import HiveMobileStoresCore

struct HubSubscriptionSyncTests {
    @Test
    func unchangedSubscriptionSetReturnsNil() {
        var sync = HubSubscriptionSync()
        _ = sync.setSubscriptions(["ws-1", "ws-2"])

        #expect(sync.setSubscriptions(["ws-1", "ws-2"]) == nil)
    }

    @Test
    func changedSubscriptionSetReturnsRemovedIdsAndOnePayload() {
        var sync = HubSubscriptionSync()
        _ = sync.setSubscriptions(["ws-1", "ws-2"])

        let result = sync.setSubscriptions(["ws-2", "ws-3"])

        #expect(result?.removed == ["ws-1"])
        #expect(result?.payload.workspaceIds == ["ws-2", "ws-3"])
        #expect(result?.payload.focusWorkspaces == [])
        #expect(result?.payload.prWorkspaces == [])
    }

    @Test
    func returnToHubEmitsExactlyOnePayloadCarryingBothChanges() {
        var sync = HubSubscriptionSync()
        _ = sync.setViewingWorkspace("ws-1")

        var sent: [HubSyncPayload] = []
        if let payload = sync.returnToHub(visiblePrWorkspaces: ["ws-2"]) {
            sent.append(payload)
        }
        if let payload = sync.returnToHub(visiblePrWorkspaces: ["ws-2"]) {
            sent.append(payload)
        }

        #expect(sent.count == 1)
        #expect(sent.first?.focusWorkspaces == [])
        #expect(sent.first?.prWorkspaces == ["ws-2"])
    }

    @Test
    func viewingWorkspaceEntersFocusAndPrListsExcludingBrain() {
        var sync = HubSubscriptionSync()

        let payload = sync.setViewingWorkspace("ws-1")
        #expect(payload?.focusWorkspaces == ["ws-1"])
        #expect(payload?.prWorkspaces == ["ws-1"])

        let brainPayload = sync.setViewingWorkspace(BRAIN_WORKSPACE_ID)
        #expect(brainPayload?.focusWorkspaces == [BRAIN_WORKSPACE_ID])
        #expect(brainPayload?.prWorkspaces == [])
    }

    @Test
    func stateChangeWithIdenticalPayloadReturnsNil() {
        var sync = HubSubscriptionSync()
        _ = sync.setViewingWorkspace("ws-1")

        #expect(sync.setVisiblePrWorkspaces(["ws-1"]) == nil)
    }
}

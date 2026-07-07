import Foundation
import Testing
@testable import HiveMobileStoresCore

@MainActor
private final class FakeHubConnection: HubConnectionClient {
    private(set) var connectCount = 0
    private(set) var cancelCount = 0
    private(set) var forceReconnectCount = 0
    private(set) var probeLivenessCount = 0
    private(set) var syncCalls: [(payload: HubSyncPayload, forceBootstrap: Bool)] = []
    private(set) var sentMessages: [HubIncoming] = []
    var sendResult = true

    func connect() {
        connectCount += 1
    }

    func cancel() {
        cancelCount += 1
    }

    func forceReconnect() {
        forceReconnectCount += 1
    }

    func send(_ message: HubIncoming) async -> Bool {
        sentMessages.append(message)
        return sendResult
    }

    func sendSync(_ payload: HubSyncPayload, forceBootstrap: Bool) {
        syncCalls.append((payload, forceBootstrap))
    }

    func probeLiveness() {
        probeLivenessCount += 1
    }
}

@MainActor
struct HubStatusMonitorTests {
    private func makeMonitor() -> (HubStatusMonitor, ConversationStoreCache, FakeHubConnection) {
        let cache = ConversationStoreCache()
        let connection = FakeHubConnection()
        let monitor = HubStatusMonitor(storeCache: cache) { _ in connection }
        return (monitor, cache, connection)
    }

    @Test
    func syncRemovingWorkspaceClearsWorkspaceStateAndEvictsStore() {
        let (monitor, cache, connection) = makeMonitor()
        _ = cache.getOrCreate("ws-removed")

        monitor.sync(workspaceIds: ["ws-removed", "ws-kept"])
        monitor.didReceiveStreaming(true, for: "ws-removed", sessionId: "session-1")
        monitor.didReceiveDone(for: "ws-removed", sessionId: "session-1", markWorkspaceCompleted: true)
        monitor.didReceiveDiffStats(DiffStatResponse(committed: [], uncommitted: []), for: "ws-removed")
        monitor.didReceiveBranchInfo(
            BranchInfo(name: "feature", lastSyncedAt: "2026-01-01T00:00:00.000Z"),
            for: "ws-removed"
        )
        monitor.didReceiveScriptStatus(scriptType: "test", state: "running", exitCode: nil, for: "ws-removed")

        #expect(connection.connectCount == 1)
        #expect(monitor.isStreaming("ws-removed"))
        #expect(monitor.hasUnreadSessions("ws-removed"))
        #expect(monitor.diffStats(for: "ws-removed") != nil)
        #expect(cache.stores["ws-removed"] != nil)

        monitor.sync(workspaceIds: ["ws-kept"])

        #expect(monitor.isStreaming("ws-removed") == false)
        #expect(monitor.hasUnreadSessions("ws-removed") == false)
        #expect(monitor.diffStats(for: "ws-removed") == nil)
        #expect(monitor.branchInfo(for: "ws-removed") == nil)
        #expect(monitor.scriptStatus(for: "ws-removed").isEmpty)
        #expect(monitor.isCompleted("ws-removed") == false)
        #expect(cache.stores["ws-removed"] == nil)
        #expect(connection.syncCalls.last?.payload.workspaceIds == ["ws-kept"])
    }

    @Test
    func viewingWorkspaceUpdatesFocusPayloadWithoutSendingForSessionOnlyChanges() throws {
        let (monitor, _, connection) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-focus"])

        monitor.setViewingWorkspace("ws-focus", sessionId: "session-1")

        let firstSync = try #require(connection.syncCalls.last)
        #expect(firstSync.payload.focusWorkspaces == ["ws-focus"])
        #expect(firstSync.payload.prWorkspaces == ["ws-focus"])
        #expect(firstSync.forceBootstrap == false)

        let syncCount = connection.syncCalls.count
        monitor.setViewingWorkspace("ws-focus", sessionId: "session-2")

        #expect(monitor.viewingSessionId == "session-2")
        #expect(connection.syncCalls.count == syncCount)

        monitor.clearViewingSession(workspaceId: "ws-focus", sessionId: "session-1")
        #expect(monitor.viewingSessionId == "session-2")

        monitor.clearViewingSession(workspaceId: "ws-focus", sessionId: "session-2")
        #expect(monitor.viewingSessionId == nil)
        #expect(connection.syncCalls.count == syncCount)
    }

    @Test
    func routedDoneForVisibleSessionDoesNotCreateUnreadOrCompletedState() {
        let (monitor, _, _) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-visible"])
        monitor.setViewingWorkspace("ws-visible", sessionId: "session-1")
        monitor.didReceiveStreaming(true, for: "ws-visible", sessionId: "session-1")

        HubEventRouter.route(
            HubOutgoing(
                workspaceId: "ws-visible",
                event: .done(
                    sessionId: "session-1",
                    durationMs: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    contextUsedTokens: nil,
                    contextWindowTokens: nil,
                    pendingToolName: nil
                )
            ),
            to: monitor
        )

        #expect(monitor.isStreaming(workspaceId: "ws-visible", sessionId: "session-1") == false)
        #expect(monitor.isUnread(workspaceId: "ws-visible", sessionId: "session-1") == false)
        #expect(monitor.isCompleted("ws-visible") == false)
    }

    @Test
    func forceRefreshDelegatesToHubConnectionProbe() {
        let (monitor, _, connection) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-1"])

        monitor.forceRefresh()

        #expect(connection.probeLivenessCount == 1)
    }

    @Test
    func initialConnectionStateIsConnecting() {
        let (monitor, _, _) = makeMonitor()

        #expect(monitor.connectionState == .connecting)
    }

    @Test
    func didChangeConnectionStateUpdatesState() {
        let (monitor, _, _) = makeMonitor()

        monitor.didChangeConnectionState(.connected)
        #expect(monitor.connectionState == .connected)

        monitor.didChangeConnectionState(.disconnected)
        #expect(monitor.connectionState == .disconnected)
    }

    @Test
    func reconnectNowDelegatesToForceReconnect() {
        let (monitor, _, connection) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-1"])

        monitor.reconnectNow()

        #expect(connection.forceReconnectCount == 1)
    }

    @Test
    func reconnectNowIsSafeNoOpWhenNothingSubscribed() {
        let (monitor, _, connection) = makeMonitor()
        monitor.disconnectAll()
        monitor.reconnectNow()
        #expect(connection.connectCount == 0)
        #expect(connection.forceReconnectCount == 0)
    }

    @Test
    func firstSendResubscribesBeforeEventThenNot() async {
        let (monitor, cache, connection) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-1"])
        let store = cache.getOrCreate("ws-1")

        _ = await store.send?(.stop(sessionId: "s1"))

        #expect(connection.sentMessages.count == 2)
        if case .syncWorkspaces = connection.sentMessages.first {} else {
            Issue.record("first sent message should be the resubscribe sync_workspaces")
        }
        if case .workspaceEvent = connection.sentMessages.last {} else {
            Issue.record("second sent message should be the workspace event")
        }

        _ = await store.send?(.stop(sessionId: "s2"))
        #expect(connection.sentMessages.count == 3)
    }

    @Test
    func failedWorkspaceSendProbesLiveness() async {
        let (monitor, cache, connection) = makeMonitor()
        connection.sendResult = false
        monitor.sync(workspaceIds: ["ws-1"])
        let store = cache.getOrCreate("ws-1")

        let sent = await store.send?(.stop(sessionId: "s1")) ?? true

        #expect(sent == false)
        #expect(connection.probeLivenessCount == 1)
    }

    @Test
    func staleConnectedSendWaitsForFreshConnectionThenRetrySucceeds() async {
        let (monitor, cache, connection) = makeMonitor()
        monitor.sync(workspaceIds: ["ws-1"])
        let store = cache.getOrCreate("ws-1")

        // Simulate a live socket (generation 1) whose first send fails because it
        // died silently — connectionState is still the stale `.connected`.
        monitor.didChangeConnectionState(.connected)
        connection.sendResult = false

        let sendTask = Task { await store.send?(.stop(sessionId: "s1")) ?? false }

        // Let the closure reach its wait loop.
        try? await Task.sleep(for: .milliseconds(150))

        // A fresh reconnect completes (generation 2) and the new socket sends fine.
        connection.sendResult = true
        monitor.didChangeConnectionState(.connecting)
        monitor.didChangeConnectionState(.connected)

        let sent = await sendTask.value
        #expect(sent == true)
        #expect(connection.probeLivenessCount == 1)
    }
}

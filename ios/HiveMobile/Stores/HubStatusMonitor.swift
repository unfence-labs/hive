import Foundation
import Network
import Observation

enum HubConnectionState { case connecting; case connected; case disconnected }

private struct MarkReadRequest: Hashable {
    let workspaceId: String
    let sessionId: String
    let throughCount: Int
}

@MainActor
protocol HubConnectionClient: AnyObject {
    func connect()
    func cancel()
    func forceReconnect()
    @discardableResult
    func send(_ message: HubIncoming) async -> Bool
    func sendSync(_ payload: HubSyncPayload, forceBootstrap: Bool)
    func probeLiveness()
}

extension HubConnectionClient {
    func sendSync(_ payload: HubSyncPayload) {
        sendSync(payload, forceBootstrap: false)
    }
}

/// Monitors real-time status for all workspaces via a single multiplexed hub WebSocket.
///
/// A single `HubConnection` fully decodes ALL WS events wrapped in `HubOutgoing` envelopes:
/// - Hub-level events (status, diff_stats, branch_info) update monitor properties.
/// - ALL events are forwarded to the workspace's `ConversationStore` (via `ConversationStoreCache`).
@MainActor
@Observable
final class HubStatusMonitor {
    /// Per-workspace, per-session streaming tracking.
    /// Key = workspaceId, Value = set of sessionIds currently streaming.
    private(set) var streamingSessions: [String: Set<String>] = [:]
    /// Full authoritative unread snapshot per workspace, keyed by session ID.
    private(set) var unreadSessions: [String: [String: UnreadSessionState]] = [:]
    private(set) var workspaceDiffStats: [String: DiffStatResponse] = [:]
    private(set) var workspaceBranchInfo: [String: BranchInfo] = [:]
    private(set) var workspacePrStatus: [String: PrStatusResponse] = [:]
    private(set) var workspaceScriptStatus: [String: [String: ScriptStatusInfo]] = [:]
    private(set) var workspaceLastActivityAt: [String: Date] = [:]
    private var lastViewedSessionByWorkspace: [String: String] = [:]
    private(set) var connectionState: HubConnectionState = .connecting
    private(set) var isAppActive = true

    /// True while the device reports a usable network path. Airplane mode flips
    /// this instantly — long before a socket send or the 30s ping would notice —
    /// so sends fail fast and the disconnect banner shows without delay.
    private(set) var isNetworkAvailable = true
    @ObservationIgnored private var pathMonitor: NWPathMonitor?

    /// Bumped each time the hub transitions into `.connected`. Lets a retry
    /// distinguish a genuinely fresh connection from a stale `.connected` read.
    private(set) var connectionGeneration = 0

    /// Workspace currently visible in ChatView.
    var viewingWorkspaceId: String? { syncState.viewingWorkspaceId }
    /// Session currently visible in ChatView.
    private(set) var viewingSessionId: String?
    private var renderedAssistantCount: Int?
    private var markReadRequestsInFlight: Set<MarkReadRequest> = []

    var currentPrWorkspaces: [String] { Array(syncState.prWorkspaces) }

    fileprivate var currentSyncPayload: HubSyncPayload { syncState.payload }

    let storeCache: ConversationStoreCache

    private var hubConnection: HubConnectionClient?
    private let makeHubConnection: @MainActor (HubStatusMonitor) -> HubConnectionClient
    private var syncState = HubSubscriptionSync()
    private let isoFormatter = ISO8601DateFormatter()
    private let fractionalIsoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    convenience init(storeCache: ConversationStoreCache) {
        self.init(storeCache: storeCache, makeHubConnection: { HubConnection(monitor: $0) })
        startNetworkPathMonitoring()
    }

    private func startNetworkPathMonitoring() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                self?.setNetworkAvailable(available)
            }
        }
        monitor.start(queue: DispatchQueue.global(qos: .utility))
        pathMonitor = monitor
    }

    func setNetworkAvailable(_ available: Bool) {
        guard isNetworkAvailable != available else { return }
        isNetworkAvailable = available
        if available {
            // Network is back: probe (or create) the connection right away
            // instead of waiting for the next ping cycle.
            if hubConnection != nil {
                forceRefresh()
            } else {
                ensureConnection()
            }
        } else {
            didChangeConnectionState(.disconnected)
        }
    }

    init(
        storeCache: ConversationStoreCache,
        makeHubConnection: @escaping @MainActor (HubStatusMonitor) -> HubConnectionClient
    ) {
        self.storeCache = storeCache
        self.makeHubConnection = makeHubConnection
        storeCache.onStoreCreated = { [weak self] workspaceId, store in
            self?.wireSendClosure(for: workspaceId, on: store)
        }
    }

    /// Wire (or re-wire) the send closure for a workspace's store via the hub connection.
    fileprivate func wireSendClosure(for workspaceId: String, on store: ConversationStore) {
        store.send = { [weak self] message in
            guard let self else { return false }
            // No network path (airplane mode): fail fast so the failed-send
            // error state appears immediately instead of hanging on a dead
            // socket send that TCP won't give up on for tens of seconds.
            guard self.isNetworkAvailable else { return false }
            let event = HubIncoming.workspaceEvent(workspaceId: workspaceId, event: message)
            let generationAtSend = self.connectionGeneration
            await self.resubscribeIfNeeded()
            if await self.hubConnection?.send(event) == true { return true }
            // The socket was down, absent, or died mid-send: (re)connect and retry
            // once so a send during a brief disconnect isn't silently dropped. Wait
            // for a genuinely fresh connection (a newer generation) rather than a
            // stale `.connected` left over from the socket that just failed.
            self.handleSendFailure()
            for _ in 0..<30 {
                if !self.isNetworkAvailable { return false }
                if self.connectionState == .connected,
                   self.connectionGeneration != generationAtSend { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard self.isNetworkAvailable else { return false }
            await self.resubscribeIfNeeded()
            return await self.hubConnection?.send(event) == true
        }
    }

    /// After a (re)connect, resend our subscription before the first workspace
    /// event so the server registers it first (same ordered socket). Prevents a
    /// "Not subscribed to workspace" rejection when a send races the reconnect.
    private var needsResubscribe = true
    private func resubscribeIfNeeded() async {
        guard needsResubscribe, let hubConnection else { return }
        let payload = currentSyncPayload
        if await hubConnection.send(.syncWorkspaces(
            workspaceIds: payload.workspaceIds,
            focusWorkspaces: payload.focusWorkspaces,
            prWorkspaces: payload.prWorkspaces,
            forceBootstrap: false
        )) {
            needsResubscribe = false
        }
    }

    /// Re-wire send closures on all existing stores (e.g. after hub reconnect).
    fileprivate func rewireAllSendClosures() {
        for (workspaceId, store) in storeCache.stores {
            wireSendClosure(for: workspaceId, on: store)
        }
    }

    // MARK: - Public accessors

    func isStreaming(_ workspaceId: String) -> Bool {
        !(streamingSessions[workspaceId]?.isEmpty ?? true)
    }

    func isStreaming(workspaceId: String, sessionId: String) -> Bool {
        streamingSessions[workspaceId]?.contains(sessionId) ?? false
    }

    func isUnread(workspaceId: String, sessionId: String) -> Bool {
        unreadSessions[workspaceId]?[sessionId] != nil
    }

    func hasUnreadSessions(_ workspaceId: String) -> Bool {
        !(unreadSessions[workspaceId]?.isEmpty ?? true)
    }

    func diffStats(for workspaceId: String) -> DiffStatResponse? {
        workspaceDiffStats[workspaceId]
    }

    func lastViewedSession(for workspaceId: String) -> String? {
        lastViewedSessionByWorkspace[workspaceId]
    }

    func branchInfo(for workspaceId: String) -> BranchInfo? {
        workspaceBranchInfo[workspaceId]
    }

    func prStatus(for workspaceId: String) -> PrStatusResponse? {
        workspacePrStatus[workspaceId]
    }

    func isPrStatusLoading(_ workspaceId: String) -> Bool {
        currentPrWorkspaces.contains(workspaceId) && workspacePrStatus[workspaceId] == nil
    }

    func scriptStatus(for workspaceId: String) -> [String: ScriptStatusInfo] {
        workspaceScriptStatus[workspaceId] ?? [:]
    }

    /// Number of authoritative unread conversations in real workspaces.
    var hubBadgeCount: Int {
        unreadSessions.reduce(into: 0) { count, entry in
            if entry.key != BRAIN_WORKSPACE_ID {
                count += entry.value.count
            }
        }
    }

    /// Number of authoritative unread Brain conversations.
    var brainBadgeCount: Int {
        unreadSessions[BRAIN_WORKSPACE_ID]?.count ?? 0
    }

    func lastActivityDate(for workspaceId: String) -> Date? {
        workspaceLastActivityAt[workspaceId]
    }

    func seedLastActivityDates(from workspaces: [Workspace]) {
        for workspace in workspaces {
            let rawDate = workspace.lastActivityAt ?? workspace.createdAt
            guard let date = parseTimestamp(rawDate) else { continue }
            markActivity(for: workspace.id, at: date)
        }
    }

    // MARK: - Sync

    private func ensureConnection() {
        guard hubConnection == nil, !currentSyncPayload.workspaceIds.isEmpty else { return }
        let conn = makeHubConnection(self)
        hubConnection = conn
        conn.connect()
    }

    /// Sync monitored workspaces — manages hub connection and subscriptions.
    func sync(workspaceIds: [String]) {
        let desired = Set(workspaceIds)
        let change = syncState.setSubscriptions(desired)
        if let (removed, _) = change {
            for id in removed {
                streamingSessions.removeValue(forKey: id)
                unreadSessions.removeValue(forKey: id)
                workspaceDiffStats.removeValue(forKey: id)
                workspaceBranchInfo.removeValue(forKey: id)
                workspacePrStatus.removeValue(forKey: id)
                workspaceScriptStatus.removeValue(forKey: id)
                workspaceLastActivityAt.removeValue(forKey: id)
                storeCache.evict(id)
            }
        }

        if desired.isEmpty {
            hubConnection?.cancel()
            hubConnection = nil
            connectionState = .disconnected
        } else if hubConnection == nil {
            ensureConnection()
        } else if let (_, payload) = change {
            hubConnection?.sendSync(payload)
        }
    }

    func syncVisiblePrWorkspaces(_ workspaceIds: [String]) {
        if let payload = syncState.setVisiblePrWorkspaces(Set(workspaceIds)) {
            hubConnection?.sendSync(payload)
        }
    }

    func setViewingWorkspace(_ id: String?, sessionId: String?) {
        if id != viewingWorkspaceId || sessionId != viewingSessionId {
            renderedAssistantCount = nil
        }
        viewingSessionId = sessionId
        if let id, let sessionId {
            lastViewedSessionByWorkspace[id] = sessionId
        }
        if let payload = syncState.setViewingWorkspace(id) {
            hubConnection?.sendSync(payload)
        }
    }

    func clearViewingSession(workspaceId: String, sessionId: String) {
        guard viewingWorkspaceId == workspaceId, viewingSessionId == sessionId else { return }
        viewingSessionId = nil
        renderedAssistantCount = nil
    }

    /// Report how many assistant messages the visible ChatView actually renders.
    /// The authoritative unread snapshot is only cleared after the backend echoes
    /// a replacement `unread_state` snapshot.
    func updateRenderedAssistantCount(workspaceId: String, sessionId: String, count: Int) {
        guard viewingWorkspaceId == workspaceId, viewingSessionId == sessionId else { return }
        renderedAssistantCount = count
        requestMarkReadIfNeeded()
    }

    func returnToHub(visiblePrWorkspaces ids: [String]) {
        viewingSessionId = nil
        renderedAssistantCount = nil
        if let payload = syncState.returnToHub(visiblePrWorkspaces: Set(ids)) {
            hubConnection?.sendSync(payload)
        }
    }

    /// Disconnect everything.
    func disconnectAll() {
        hubConnection?.cancel()
        hubConnection = nil
        connectionState = .disconnected
        syncState = HubSubscriptionSync()
        streamingSessions.removeAll()
        unreadSessions.removeAll()
        workspaceDiffStats.removeAll()
        workspaceBranchInfo.removeAll()
        workspaceLastActivityAt.removeAll()
        workspaceScriptStatus.removeAll()
        workspacePrStatus.removeAll()
        lastViewedSessionByWorkspace.removeAll()
        viewingSessionId = nil
        renderedAssistantCount = nil
        markReadRequestsInFlight.removeAll()
        needsResubscribe = true
    }

    // MARK: - Called by HubConnection

    func didChangeConnectionState(_ state: HubConnectionState) {
        if state == .connecting { needsResubscribe = true }
        guard connectionState != state else { return }
        connectionState = state
        if state == .connected {
            connectionGeneration += 1
            requestMarkReadIfNeeded()
        }
    }

    func reconnectNow() {
        if let hubConnection {
            hubConnection.forceReconnect()
        } else {
            ensureConnection()
        }
    }

    /// A workspace send failed: probe the socket so the UI (and disconnect banner)
    /// reconcile with reality, reconnecting if the connection silently dropped.
    private func handleSendFailure() {
        if hubConnection != nil {
            forceRefresh()
        } else {
            ensureConnection()
        }
    }

    func didReceiveStreaming(_ streaming: Bool, for workspaceId: String, sessionId: String?) {
        if streaming {
            var sessions = streamingSessions[workspaceId] ?? []
            if let sid = sessionId { sessions.insert(sid) }
            streamingSessions[workspaceId] = sessions
        } else {
            if let sid = sessionId {
                streamingSessions[workspaceId]?.remove(sid)
            } else {
                // No sessionId (e.g. status with streaming=false) — clear all sessions for this workspace
                streamingSessions[workspaceId]?.removeAll()
            }
            // Clean up empty entries
            if streamingSessions[workspaceId]?.isEmpty == true {
                streamingSessions.removeValue(forKey: workspaceId)
            }
        }
    }

    func didReceiveUnreadState(_ sessions: [UnreadSessionState], for workspaceId: String) {
        if sessions.isEmpty {
            unreadSessions.removeValue(forKey: workspaceId)
        } else {
            unreadSessions[workspaceId] = Dictionary(uniqueKeysWithValues: sessions.map { ($0.sessionId, $0) })
        }
        requestMarkReadIfNeeded()
    }

    func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        workspaceDiffStats[workspaceId] = stats
    }

    func didReceivePrStatus(_ status: PrStatusResponse, for workspaceId: String) {
        workspacePrStatus[workspaceId] = status
    }

    func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        workspaceBranchInfo[workspaceId] = info
    }

    func didReceiveScriptStatus(scriptType: String, state: String, exitCode: Int?, for workspaceId: String) {
        guard let scriptState = ScriptState(rawValue: state) else { return }
        var statuses = workspaceScriptStatus[workspaceId] ?? [:]
        statuses[scriptType] = ScriptStatusInfo(state: scriptState, exitCode: exitCode)
        workspaceScriptStatus[workspaceId] = statuses
    }

    func didReceiveActivity(_ event: WsOutgoing, for workspaceId: String) {
        switch hubActivityMarking(for: event) {
        case .ignore:
            break
        case .markNow:
            markActivity(for: workspaceId)
        case .markLatestMessageTimestamp:
            guard case .history(let messages, _) = event,
                  let latest = messages.compactMap({ parseTimestamp($0.timestamp) }).max() else {
                return
            }
            markActivity(for: workspaceId, at: latest)
        case .markIfStreaming:
            guard case .status(_, _, let streaming, _, _) = event, streaming == true else { return }
            markActivity(for: workspaceId)
        }
    }

    private func markActivity(for workspaceId: String, at date: Date = Date()) {
        if let current = workspaceLastActivityAt[workspaceId], current >= date {
            return
        }
        workspaceLastActivityAt[workspaceId] = date
    }

    private func parseTimestamp(_ value: String) -> Date? {
        fractionalIsoFormatter.date(from: value) ?? isoFormatter.date(from: value)
    }

    /// Ensure a ConversationStore exists for a workspace (eager creation on streaming).
    func ensureStoreExists(for workspaceId: String) {
        _ = storeCache.getOrCreate(workspaceId)
    }

    func forward(_ event: WsOutgoing, for workspaceId: String) {
        storeCache.stores[workspaceId]?.handle(event)
    }

    private func requestMarkReadIfNeeded() {
        guard isAppActive,
              connectionState == .connected,
              let workspaceId = viewingWorkspaceId,
              let sessionId = viewingSessionId,
              let renderedAssistantCount,
              let unread = unreadSessions[workspaceId]?[sessionId] else {
            return
        }

        // Clamp to the authoritative snapshot count as a guard against stale-snapshot
        // races (client refetched history before the newest unread snapshot arrived).
        let clamped = min(renderedAssistantCount, unread.assistantMessageCount)
        guard clamped > 0, clamped > unread.readAssistantMessageCount else { return }

        let request = MarkReadRequest(
            workspaceId: workspaceId,
            sessionId: sessionId,
            throughCount: clamped
        )
        guard markReadRequestsInFlight.insert(request).inserted else { return }

        Task { [weak self] in
            guard let self else { return }
            let message = HubIncoming.workspaceEvent(
                workspaceId: workspaceId,
                event: .markRead(sessionId: sessionId, throughCount: clamped)
            )
            await self.resubscribeIfNeeded()
            let sent = await self.hubConnection?.send(message) == true
            self.markReadRequestsInFlight.remove(request)
            if !sent {
                self.handleSendFailure()
            }
        }
    }

    // MARK: - App lifecycle

    func forceRefresh() {
        hubConnection?.probeLiveness()
    }

    func appDidBecomeActive() {
        isAppActive = true
        requestMarkReadIfNeeded()
        forceRefresh()
    }

    func appDidBecomeInactive() {
        isAppActive = false
    }
}

extension HubStatusMonitor: HubEventSink {}

// MARK: - Single hub WebSocket connection

@MainActor
private final class HubConnection: HubConnectionClient {
    private weak var monitor: HubStatusMonitor?

    private var wsTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var probeTimeoutTask: Task<Void, Never>?
    private var intentionallyClosed = false
    private var backoff: UInt64 = 1
    private var pipeline: HubFramePipeline?

    private let encoder = JSONEncoder()

    init(monitor: HubStatusMonitor) {
        self.monitor = monitor
    }

    func connect() {
        intentionallyClosed = false
        pipeline = HubFramePipeline { [weak self] envelope in self?.dispatch(envelope) }
        performConnect()
    }

    func cancel() {
        intentionallyClosed = true
        let pipeline = pipeline
        self.pipeline = nil
        Task { await pipeline?.cancel() }
        receiveTask?.cancel()
        pingTask?.cancel()
        reconnectTask?.cancel()
        probeTimeoutTask?.cancel()
        probeTimeoutTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
    }

    /// Send a hub-level message (sync_workspaces or workspace event).
    /// Returns `true` if the message was successfully handed to the WebSocket.
    @discardableResult
    func send(_ message: HubIncoming) async -> Bool {
        guard let wsTask else { return false }
        guard let data = try? encoder.encode(message),
              let string = String(data: data, encoding: .utf8) else { return false }
        do {
            try await wsTask.send(.string(string))
            return true
        } catch {
            return false
        }
    }

    /// Send sync_workspaces with the given payload.
    /// `forceBootstrap` asks the server to resend full bootstrap for already
    /// subscribed workspaces over the existing socket (no reconnect).
    func sendSync(_ payload: HubSyncPayload, forceBootstrap: Bool = false) {
        Task {
            await send(.syncWorkspaces(
                workspaceIds: payload.workspaceIds,
                focusWorkspaces: payload.focusWorkspaces,
                prWorkspaces: payload.prWorkspaces,
                forceBootstrap: forceBootstrap
            ))
        }
    }

    private func performConnect() {
        guard let url = ServerEndpoint.webSocketURL(path: "/ws/hub") else { return }

        receiveTask?.cancel()
        pingTask?.cancel()
        probeTimeoutTask?.cancel()
        probeTimeoutTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)

        let task = HiveHTTP.session.webSocketTask(with: url)
        task.maximumMessageSize = 10 * 1024 * 1024
        self.wsTask = task
        task.resume()
        monitor?.didChangeConnectionState(.connecting)

        // Re-wire send closures on all existing stores so they target the fresh socket.
        // We deliberately do NOT wipe streaming state here: the reconnect is
        // non-destructive (issue #259). The visible conversation stays as-is and is
        // reconciled silently from authoritative bootstrap events plus REST history
        // refreshes (stream_snapshot replaces active streams; REST history drops
        // stale finalized stream slots).
        monitor?.rewireAllSendClosures()

        startReceiving()
        startPinging()

        // Send sync_workspaces to subscribe to all tracked workspaces
        if let monitor {
            sendSync(monitor.currentSyncPayload)
        }
    }

    // MARK: - Receive loop

    private func startReceiving() {
        receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let task = self.wsTask else { break }
                do {
                    let message = try await task.receive()
                    self.backoff = 1
                    self.monitor?.didChangeConnectionState(.connected)
                    await self.pipeline?.submit(message)
                } catch {
                    if !Task.isCancelled, self.wsTask === task {
                        self.handleDisconnect()
                    }
                    break
                }
            }
        }
    }

    private func dispatch(_ envelope: HubOutgoing) {
        guard !intentionallyClosed, let monitor else { return }
        HubEventRouter.route(envelope, to: monitor)
    }

    // MARK: - Ping keepalive

    private func startPinging() {
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                guard let task = self?.wsTask else { break }
                task.sendPing { error in
                    guard error != nil else { return }
                    Task { @MainActor [weak self] in
                        guard let self, self.wsTask === task else { return }
                        self.handleDisconnect()
                    }
                }
            }
        }
    }

    // MARK: - Reconnect

    func forceReconnect() {
        guard !intentionallyClosed else { return }
        receiveTask?.cancel()
        pingTask?.cancel()
        reconnectTask?.cancel()
        probeTimeoutTask?.cancel()
        probeTimeoutTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        backoff = 1
        performConnect()
    }

    func probeLiveness() {
        guard !intentionallyClosed else { return }
        guard let task = wsTask else {
            performConnect()
            return
        }
        probeTimeoutTask?.cancel()
        let timeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled else { return }
            if self.wsTask === task { self.forceReconnect() }
        }
        probeTimeoutTask = timeout
        task.sendPing { [weak self] error in
            Task { @MainActor in
                guard let self, self.wsTask === task else { return }
                self.probeTimeoutTask?.cancel()
                self.probeTimeoutTask = nil
                if error != nil {
                    self.forceReconnect()
                } else {
                    // Socket is alive: ask it to resend bootstrap for already
                    // subscribed workspaces instead of reconnecting.
                    if let monitor = self.monitor {
                        self.sendSync(monitor.currentSyncPayload, forceBootstrap: true)
                    }
                }
            }
        }
    }

    private func handleDisconnect() {
        receiveTask?.cancel()
        pingTask?.cancel()
        probeTimeoutTask?.cancel()
        probeTimeoutTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil

        guard !intentionallyClosed else { return }
        monitor?.didChangeConnectionState(.disconnected)

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            let delay = self.backoff
            self.backoff = min(self.backoff * 2, 60)
            let jitterMs = UInt64.random(in: 0...500)
            try? await Task.sleep(for: .seconds(delay) + .milliseconds(jitterMs))
            guard !Task.isCancelled, !self.intentionallyClosed else { return }
            self.performConnect()
        }
    }
}

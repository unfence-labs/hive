import Foundation
import Observation

enum HubConnectionState { case connecting; case connected; case disconnected }

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
    /// Per-workspace, per-session unread tracking.
    /// Key = workspaceId, Value = set of sessionIds with unread completed turns.
    private(set) var unreadSessions: [String: Set<String>] = [:]
    private(set) var workspaceDiffStats: [String: DiffStatResponse] = [:]
    private(set) var workspaceBranchInfo: [String: BranchInfo] = [:]
    private(set) var workspacePrStatus: [String: PrStatusResponse] = [:]
    private(set) var workspaceScriptStatus: [String: [String: ScriptStatusInfo]] = [:]
    private(set) var workspaceLastActivityAt: [String: Date] = [:]
    private(set) var completedWorkspaces: Set<String> = [] {
        didSet { persistCompleted() }
    }
    private(set) var connectionState: HubConnectionState = .connecting

    /// Workspace currently visible in ChatView (suppresses unread badge).
    var viewingWorkspaceId: String? { syncState.viewingWorkspaceId }
    /// Session currently visible in ChatView (suppresses unread badge for that session).
    private(set) var viewingSessionId: String?

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

    private static let completedKey = "completedWorkspaces"

    convenience init(storeCache: ConversationStoreCache) {
        self.init(storeCache: storeCache, makeHubConnection: { HubConnection(monitor: $0) })
    }

    init(
        storeCache: ConversationStoreCache,
        makeHubConnection: @escaping @MainActor (HubStatusMonitor) -> HubConnectionClient
    ) {
        self.storeCache = storeCache
        self.makeHubConnection = makeHubConnection
        // Restore persisted completed set (survives app kill)
        let stored = UserDefaults.standard.stringArray(forKey: Self.completedKey) ?? []
        self.completedWorkspaces = Set(stored)
        storeCache.onStoreCreated = { [weak self] workspaceId, store in
            self?.wireSendClosure(for: workspaceId, on: store)
        }
    }

    /// Wire (or re-wire) the send closure for a workspace's store via the hub connection.
    fileprivate func wireSendClosure(for workspaceId: String, on store: ConversationStore) {
        store.send = { [weak self] message in
            await self?.hubConnection?.send(.workspaceEvent(workspaceId: workspaceId, event: message)) ?? false
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
        unreadSessions[workspaceId]?.contains(sessionId) ?? false
    }

    func hasUnreadSessions(_ workspaceId: String) -> Bool {
        !(unreadSessions[workspaceId]?.isEmpty ?? true)
    }

    func diffStats(for workspaceId: String) -> DiffStatResponse? {
        workspaceDiffStats[workspaceId]
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

    func isCompleted(_ workspaceId: String) -> Bool {
        completedWorkspaces.contains(workspaceId)
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

    func clearCompleted(_ workspaceId: String) {
        completedWorkspaces.remove(workspaceId)
    }

    func clearUnread(workspaceId: String, sessionId: String) {
        unreadSessions[workspaceId]?.remove(sessionId)
        if unreadSessions[workspaceId]?.isEmpty == true {
            unreadSessions.removeValue(forKey: workspaceId)
        }
    }

    /// Called from HiveApp to merge push-delivered completions on launch.
    func markCompletedFromPush(_ workspaceId: String) {
        completedWorkspaces.insert(workspaceId)
    }

    private func persistCompleted() {
        UserDefaults.standard.set(Array(completedWorkspaces), forKey: Self.completedKey)
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
                completedWorkspaces.remove(id)
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
        viewingSessionId = sessionId
        if let payload = syncState.setViewingWorkspace(id) {
            hubConnection?.sendSync(payload)
        }
    }

    func clearViewingSession(workspaceId: String, sessionId: String) {
        guard viewingWorkspaceId == workspaceId, viewingSessionId == sessionId else { return }
        viewingSessionId = nil
    }

    func returnToHub(visiblePrWorkspaces ids: [String]) {
        viewingSessionId = nil
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
        completedWorkspaces.removeAll()
    }

    // MARK: - Called by HubConnection

    func didChangeConnectionState(_ state: HubConnectionState) {
        guard connectionState != state else { return }
        connectionState = state
    }

    func reconnectNow() {
        if let hubConnection {
            hubConnection.forceReconnect()
        } else {
            ensureConnection()
        }
    }

    /// Workspaces that were streaming when the app entered background.
    /// Used to detect streaming→idle transitions after reconnect and mark them as completed.
    private var streamingBeforeBackground: Set<String> = []

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

    /// Handle background→foreground streaming transition for a workspace.
    /// Only called from status events (bootstrap), not from done/cancelled.
    func checkBackgroundCompletion(for workspaceId: String) {
        if !isStreaming(workspaceId), streamingBeforeBackground.remove(workspaceId) != nil {
            didReceiveDone(for: workspaceId, sessionId: nil, markWorkspaceCompleted: true)
        }
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

    func didReceiveDone(for workspaceId: String, sessionId: String?, markWorkspaceCompleted: Bool) {
        if let sessionId,
           workspaceId == viewingWorkspaceId,
           sessionId == viewingSessionId {
            clearUnread(workspaceId: workspaceId, sessionId: sessionId)
            return
        }

        if let sessionId {
            var sessions = unreadSessions[workspaceId] ?? []
            sessions.insert(sessionId)
            unreadSessions[workspaceId] = sessions
        }

        guard markWorkspaceCompleted else { return }
        guard workspaceId != viewingWorkspaceId else { return }
        completedWorkspaces.insert(workspaceId)
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

    // MARK: - App lifecycle

    func forceRefresh() {
        hubConnection?.probeLiveness()
    }

    /// Called when the app returns to foreground after a non-trivial background period.
    func appDidBecomeActive() {
        // Snapshot workspace IDs that had any streaming session
        streamingBeforeBackground = Set(streamingSessions.keys)
        forceRefresh()
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
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""
        guard !host.isEmpty, let portInt = Int(port) else { return }

        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = portInt
        components.path = "/ws/hub"
        if !token.isEmpty {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }

        guard let url = components.url else {
            return
        }

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

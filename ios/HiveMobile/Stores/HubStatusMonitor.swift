import Foundation
import Observation

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
    private(set) var workspaceDiffStats: [String: DiffStatResponse] = [:]
    private(set) var workspaceBranchInfo: [String: BranchInfo] = [:]
    private(set) var workspacePrStatus: [String: PrStatusResponse] = [:]
    private(set) var completedWorkspaces: Set<String> = [] {
        didSet { persistCompleted() }
    }

    /// Workspace currently visible in ChatView (suppresses unread badge).
    var viewingWorkspaceId: String?

    let storeCache: ConversationStoreCache

    private var hubConnection: HubConnection?
    fileprivate var subscribedWorkspaceIds: Set<String> = []
    private var bulkPrPollTask: Task<Void, Never>?
    private var prPollingIds: Set<String> = []
    private let apiClient = APIClient()

    private static let completedKey = "completedWorkspaces"

    init(storeCache: ConversationStoreCache) {
        self.storeCache = storeCache
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

    func diffStats(for workspaceId: String) -> DiffStatResponse? {
        workspaceDiffStats[workspaceId]
    }

    func branchInfo(for workspaceId: String) -> BranchInfo? {
        workspaceBranchInfo[workspaceId]
    }

    func prStatus(for workspaceId: String) -> PrStatusResponse? {
        workspacePrStatus[workspaceId]
    }

    func isCompleted(_ workspaceId: String) -> Bool {
        completedWorkspaces.contains(workspaceId)
    }

    func clearCompleted(_ workspaceId: String) {
        completedWorkspaces.remove(workspaceId)
    }

    /// Called from HiveApp to merge push-delivered completions on launch.
    func markCompletedFromPush(_ workspaceId: String) {
        completedWorkspaces.insert(workspaceId)
    }

    private func persistCompleted() {
        UserDefaults.standard.set(Array(completedWorkspaces), forKey: Self.completedKey)
    }

    // MARK: - Sync

    /// Sync monitored workspaces — manages hub connection and subscriptions.
    func sync(workspaceIds: [String]) {
        let desired = Set(workspaceIds)

        // Clean up removed workspaces
        for id in subscribedWorkspaceIds.subtracting(desired) {
            streamingSessions.removeValue(forKey: id)
            workspaceDiffStats.removeValue(forKey: id)
            workspaceBranchInfo.removeValue(forKey: id)
            workspacePrStatus.removeValue(forKey: id)
            storeCache.evict(id)
            completedWorkspaces.remove(id)
        }

        subscribedWorkspaceIds = desired

        if desired.isEmpty {
            hubConnection?.cancel()
            hubConnection = nil
        } else if hubConnection == nil {
            let conn = HubConnection(monitor: self)
            hubConnection = conn
            conn.connect()
        } else {
            hubConnection?.sendSyncWorkspaces(Array(subscribedWorkspaceIds))
        }
    }

    /// Disconnect everything.
    func disconnectAll() {
        hubConnection?.cancel()
        hubConnection = nil
        subscribedWorkspaceIds.removeAll()
        streamingSessions.removeAll()
        workspaceDiffStats.removeAll()
        workspaceBranchInfo.removeAll()
        bulkPrPollTask?.cancel()
        bulkPrPollTask = nil
        prPollingIds.removeAll()
        workspacePrStatus.removeAll()
        completedWorkspaces.removeAll()
    }

    // MARK: - PR Status Polling (Bulk)

    /// Start/stop PR status polling to match the given workspace IDs.
    /// Uses a single bulk request instead of per-workspace polling.
    func syncPrPolling(visibleWorkspaceIds: [String]) {
        let desired = Set(visibleWorkspaceIds)

        // Clean up removed workspaces
        for id in prPollingIds.subtracting(desired) {
            workspacePrStatus.removeValue(forKey: id)
        }

        prPollingIds = desired

        // Cancel existing poll and restart with updated IDs
        bulkPrPollTask?.cancel()

        guard !desired.isEmpty else {
            bulkPrPollTask = nil
            return
        }

        bulkPrPollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let ids = Array(self.prPollingIds)
                guard !ids.isEmpty else { break }
                do {
                    let response = try await self.apiClient.fetchBulkPrStatus(workspaceIds: ids)
                    for (wsId, status) in response.results {
                        self.workspacePrStatus[wsId] = status
                    }
                } catch {
                    // Silently ignore — cards show stale or "No PR"
                }
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    // MARK: - Called by HubConnection

    /// Workspaces that were streaming when the app entered background.
    /// Used to detect streaming→idle transitions after reconnect and mark them as completed.
    private var streamingBeforeBackground: Set<String> = []

    fileprivate func didReceiveStreaming(_ streaming: Bool, for workspaceId: String, sessionId: String?) {
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
    fileprivate func checkBackgroundCompletion(for workspaceId: String) {
        if !isStreaming(workspaceId), streamingBeforeBackground.remove(workspaceId) != nil {
            didReceiveDone(for: workspaceId)
        }
    }

    fileprivate func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        workspaceDiffStats[workspaceId] = stats
    }

    fileprivate func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        workspaceBranchInfo[workspaceId] = info
    }

    fileprivate func didReceiveDone(for workspaceId: String) {
        guard workspaceId != viewingWorkspaceId else { return }
        completedWorkspaces.insert(workspaceId)
    }

    /// Ensure a ConversationStore exists for a workspace (eager creation on streaming).
    fileprivate func ensureStoreExists(for workspaceId: String) {
        _ = storeCache.getOrCreate(workspaceId)
    }

    // MARK: - App lifecycle

    /// Force a full WS reconnect to get fresh bootstrap data for all workspaces.
    /// Used by pull-to-refresh so the backend re-sends status, history, branch_info,
    /// diff_stats, and script_status for every subscribed workspace.
    func forceRefresh() {
        storeCache.clearAllStreamingState()
        hubConnection?.forceReconnect()
    }

    /// Called when the app returns to foreground after a non-trivial background period.
    /// Clears stale streaming state and forces an immediate hub reconnect so the
    /// backend bootstrap (status + history) writes into a clean slate.
    func appDidBecomeActive() {
        // Snapshot workspace IDs that had any streaming session
        streamingBeforeBackground = Set(streamingSessions.keys)
        forceRefresh()
    }
}

// MARK: - Single hub WebSocket connection

@MainActor
private final class HubConnection {
    private weak var monitor: HubStatusMonitor?

    private var wsTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var intentionallyClosed = false
    private var backoff: UInt64 = 1

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(monitor: HubStatusMonitor) {
        self.monitor = monitor
    }

    func connect() {
        intentionallyClosed = false
        performConnect()
    }

    func cancel() {
        intentionallyClosed = true
        receiveTask?.cancel()
        pingTask?.cancel()
        reconnectTask?.cancel()
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

    /// Send sync_workspaces with the given workspace IDs.
    func sendSyncWorkspaces(_ workspaceIds: [String]) {
        Task {
            await send(.syncWorkspaces(workspaceIds: workspaceIds))
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

        let task = URLSession.shared.webSocketTask(with: url)
        task.maximumMessageSize = 10 * 1024 * 1024
        self.wsTask = task
        task.resume()
        backoff = 1

        // Re-wire send closures on all existing stores (handles reconnects)
        monitor?.rewireAllSendClosures()

        startReceiving()
        startPinging()

        // Send sync_workspaces to subscribe to all tracked workspaces
        if let workspaceIds = monitor?.subscribedWorkspaceIds {
            sendSyncWorkspaces(Array(workspaceIds))
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
                    self.handleFrame(message)
                } catch {
                    if !Task.isCancelled { self.handleDisconnect() }
                    break
                }
            }
        }
    }

    private func handleFrame(_ message: URLSessionWebSocketTask.Message) {
        let data: Data?
        switch message {
        case .string(let text): data = text.data(using: .utf8)
        case .data(let d): data = d
        @unknown default: data = nil
        }
        guard let data else { return }

        // Decode hub envelope
        guard let envelope = try? decoder.decode(HubOutgoing.self, from: data) else { return }

        let workspaceId = envelope.workspaceId
        let event = envelope.event

        // Hub-level processing
        switch event {
        case .status(_, let sessionId, let streaming, _, _):
            let isStreaming = streaming ?? false
            monitor?.didReceiveStreaming(isStreaming, for: workspaceId, sessionId: sessionId)
            if isStreaming {
                monitor?.ensureStoreExists(for: workspaceId)
            }
            // Only status events (bootstrap) check background completion,
            // not done/cancelled — those handle completion directly.
            if !isStreaming {
                monitor?.checkBackgroundCompletion(for: workspaceId)
            }

        case .diffStats(let stats):
            monitor?.didReceiveDiffStats(stats, for: workspaceId)

        case .branchInfo(let info):
            monitor?.didReceiveBranchInfo(info, for: workspaceId)

        case .done(let sessionId, _, _, _, _):
            monitor?.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)
            monitor?.didReceiveDone(for: workspaceId)

        case .cancelled(let sessionId, _, _, _):
            // Clear streaming for this session but don't mark as completed —
            // cancelled turns may require tool input or were user-interrupted.
            monitor?.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)

        default:
            break
        }

        // Forward ALL events to the ConversationStore (if one exists).
        monitor?.storeCache.stores[workspaceId]?.handle(event)
    }

    // MARK: - Ping keepalive

    private func startPinging() {
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                self?.wsTask?.sendPing { error in
                    if error != nil {
                        Task { @MainActor [weak self] in
                            self?.handleDisconnect()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Reconnect

    /// Force an immediate reconnect, bypassing exponential backoff.
    /// Used when the app returns from background and the connection is likely dead.
    func forceReconnect() {
        guard !intentionallyClosed else { return }
        receiveTask?.cancel()
        pingTask?.cancel()
        reconnectTask?.cancel()
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        backoff = 1
        performConnect()
    }

    private func handleDisconnect() {
        receiveTask?.cancel()
        pingTask?.cancel()
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil

        guard !intentionallyClosed else { return }

        reconnectTask = Task { [weak self] in
            guard let self else { return }
            let delay = self.backoff
            self.backoff = min(self.backoff * 2, 30)
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, !self.intentionallyClosed else { return }
            self.performConnect()
        }
    }
}

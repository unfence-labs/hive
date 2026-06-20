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

    /// Workspace currently visible in ChatView (suppresses unread badge).
    var viewingWorkspaceId: String?
    /// Session currently visible in ChatView (suppresses unread badge for that session).
    var viewingSessionId: String?

    let storeCache: ConversationStoreCache

    private var hubConnection: HubConnection?
    fileprivate var subscribedWorkspaceIds: Set<String> = []
    private var bulkPrPollTask: Task<Void, Never>?
    private var prPollingIds: Set<String> = []
    private let apiClient = APIClient()
    private let prPollInterval: Duration = .seconds(15)
    private let isoFormatter = ISO8601DateFormatter()
    private let fractionalIsoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

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

    /// Re-pull focus after a (re)connect by re-sending `switch_session` for any
    /// store that currently has a focused session (PRD #254). The backend
    /// activates the session and replays `status` + `stream_snapshot`, so the
    /// in-flight turn is recovered deterministically. Snapshot apply is REPLACE,
    /// so this is safe to issue on every reconnect.
    fileprivate func refocusFocusedSessions() {
        for store in storeCache.stores.values {
            guard let sessionId = store.sessionId else { continue }
            let send = store.send
            Task { _ = await send?(.switchSession(sessionId: sessionId)) }
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

    /// Sync monitored workspaces — manages hub connection and subscriptions.
    func sync(workspaceIds: [String]) {
        let desired = Set(workspaceIds)

        // Clean up removed workspaces
        for id in subscribedWorkspaceIds.subtracting(desired) {
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
        unreadSessions.removeAll()
        workspaceDiffStats.removeAll()
        workspaceBranchInfo.removeAll()
        workspaceLastActivityAt.removeAll()
        workspaceScriptStatus.removeAll()
        bulkPrPollTask?.cancel()
        bulkPrPollTask = nil
        prPollingIds.removeAll()
        workspacePrStatus.removeAll()
        completedWorkspaces.removeAll()
    }

    // MARK: - PR Status Polling (Bulk)

    /// Start/stop PR status polling to match the given workspace IDs.
    /// Uses a single bulk request instead of per-workspace polling.
    func syncPrPolling(workspaceIds: [String]) {
        let desired = Set(workspaceIds)

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
                try? await Task.sleep(for: self.prPollInterval)
            }
        }
    }

    func syncPrPolling(visibleWorkspaceIds: [String]) {
        syncPrPolling(workspaceIds: visibleWorkspaceIds)
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
            didReceiveDone(for: workspaceId, sessionId: nil, markWorkspaceCompleted: true)
        }
    }

    fileprivate func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        workspaceDiffStats[workspaceId] = stats
    }

    fileprivate func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        workspaceBranchInfo[workspaceId] = info
    }

    fileprivate func didReceiveScriptStatus(scriptType: String, state: String, exitCode: Int?, for workspaceId: String) {
        guard let scriptState = ScriptState(rawValue: state) else { return }
        var statuses = workspaceScriptStatus[workspaceId] ?? [:]
        statuses[scriptType] = ScriptStatusInfo(state: scriptState, exitCode: exitCode)
        workspaceScriptStatus[workspaceId] = statuses
    }

    fileprivate func didReceiveDone(for workspaceId: String, sessionId: String?, markWorkspaceCompleted: Bool) {
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

    fileprivate func didReceiveActivity(_ event: WsOutgoing, for workspaceId: String) {
        switch event {
        case .history(let messages, _):
            guard let latest = messages.compactMap({ parseTimestamp($0.timestamp) }).max() else {
                return
            }
            markActivity(for: workspaceId, at: latest)
        case .status(_, _, let streaming, _, _):
            if streaming == true {
                markActivity(for: workspaceId)
            }
        case .branchInfo, .diffStats, .scriptStatus, .planModeChanged:
            break
        default:
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
    fileprivate func ensureStoreExists(for workspaceId: String) {
        _ = storeCache.getOrCreate(workspaceId)
    }

    // MARK: - App lifecycle

    /// Force a full WS reconnect to get fresh bootstrap data for all workspaces.
    /// Used by pull-to-refresh so the backend re-sends status, branch_info,
    /// diff_stats, and script_status for every subscribed workspace (history is
    /// REST-only now, PRD #254; the reconnect path re-pulls focus for live turns).
    func forceRefresh() {
        hubConnection?.forceReconnect()
    }

    /// Called when the app returns to foreground after a non-trivial background period.
    /// Forces an immediate hub reconnect; the reconnect path re-pulls focus so the
    /// backend replays status + a consolidated stream_snapshot for the live turn
    /// (PRD #254), recovering in-flight content without clearing accumulators.
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

        // Re-wire send closures on all existing stores so they hit the new
        // connection. The pre-disconnect "clear all streaming state" hack is
        // gone (PRD #254): the consolidated `stream_snapshot` now REPLACES the
        // session's accumulators idempotently, so re-pulling focus after
        // reconnect cannot duplicate tool calls or garble text.
        monitor?.rewireAllSendClosures()

        startReceiving()
        startPinging()

        // Send sync_workspaces to subscribe to all tracked workspaces
        if let workspaceIds = monitor?.subscribedWorkspaceIds {
            sendSyncWorkspaces(Array(workspaceIds))
        }

        // Re-pull focus for any session currently displayed: re-sending
        // switch_session makes the backend replay status + stream_snapshot for
        // the live turn, so reconnect deterministically recovers in-flight
        // content (PRD #254) instead of relying on the old clear-then-bootstrap.
        monitor?.refocusFocusedSessions()
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
        monitor?.didReceiveActivity(event, for: workspaceId)

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

        case .scriptStatus(let scriptType, let state, let exitCode):
            monitor?.didReceiveScriptStatus(
                scriptType: scriptType,
                state: state,
                exitCode: exitCode,
                for: workspaceId
            )

        case .done(let sessionId, _, _, _, _, _, _, _):
            monitor?.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)
            monitor?.didReceiveDone(for: workspaceId, sessionId: sessionId, markWorkspaceCompleted: true)

        case .cancelled(let sessionId, _, _, let userInitiated, _):
            // Clear streaming for this session but only mark failed background turns as unread.
            monitor?.didReceiveStreaming(false, for: workspaceId, sessionId: sessionId)
            if userInitiated != true {
                monitor?.didReceiveDone(for: workspaceId, sessionId: sessionId, markWorkspaceCompleted: false)
            }

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

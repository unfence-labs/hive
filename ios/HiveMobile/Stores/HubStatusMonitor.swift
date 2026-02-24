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
    private(set) var streamingWorkspaces: Set<String> = []
    private(set) var workspaceDiffStats: [String: DiffStatResponse] = [:]
    private(set) var workspaceBranchInfo: [String: BranchInfo] = [:]
    private(set) var workspacePrStatus: [String: PrStatusResponse] = [:]
    private(set) var completedWorkspaces: Set<String> = []

    /// Called whenever the streaming workspace set changes.
    var onStreamingChange: ((Set<String>) -> Void)?

    let storeCache: ConversationStoreCache

    private var hubConnection: HubConnection?
    fileprivate var subscribedWorkspaceIds: Set<String> = []
    private var prPollTasks: [String: Task<Void, Never>] = [:]
    private let apiClient = APIClient()

    init(storeCache: ConversationStoreCache) {
        self.storeCache = storeCache
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
        streamingWorkspaces.contains(workspaceId)
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

    // MARK: - Sync

    /// Sync monitored workspaces — manages hub connection and subscriptions.
    func sync(workspaceIds: [String]) {
        let desired = Set(workspaceIds)

        // Clean up removed workspaces
        for id in subscribedWorkspaceIds.subtracting(desired) {
            streamingWorkspaces.remove(id)
            workspaceDiffStats.removeValue(forKey: id)
            workspaceBranchInfo.removeValue(forKey: id)
            prPollTasks[id]?.cancel()
            prPollTasks.removeValue(forKey: id)
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
        streamingWorkspaces.removeAll()
        workspaceDiffStats.removeAll()
        workspaceBranchInfo.removeAll()
        for task in prPollTasks.values { task.cancel() }
        prPollTasks.removeAll()
        workspacePrStatus.removeAll()
        completedWorkspaces.removeAll()
    }

    // MARK: - PR Status Polling

    /// Start/stop PR status polling to match the given workspace IDs.
    func syncPrPolling(visibleWorkspaceIds: [String]) {
        let desired = Set(visibleWorkspaceIds)
        let current = Set(prPollTasks.keys)

        for id in current.subtracting(desired) {
            prPollTasks[id]?.cancel()
            prPollTasks.removeValue(forKey: id)
            workspacePrStatus.removeValue(forKey: id)
        }

        for id in desired.subtracting(current) {
            let task = Task { [weak self] in
                guard let self else { return }
                while !Task.isCancelled {
                    do {
                        let status = try await self.apiClient.fetchPrStatus(workspaceId: id)
                        self.workspacePrStatus[id] = status
                    } catch {
                        // Silently ignore — card shows stale or "No PR"
                    }
                    try? await Task.sleep(for: .seconds(15))
                }
            }
            prPollTasks[id] = task
        }
    }

    // MARK: - Called by HubConnection

    fileprivate func didReceiveStreaming(_ streaming: Bool, for workspaceId: String) {
        if streaming {
            streamingWorkspaces.insert(workspaceId)
        } else {
            streamingWorkspaces.remove(workspaceId)
        }
        onStreamingChange?(streamingWorkspaces)
    }

    fileprivate func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        workspaceDiffStats[workspaceId] = stats
    }

    fileprivate func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        workspaceBranchInfo[workspaceId] = info
    }

    fileprivate func didReceiveDone(for workspaceId: String) {
        completedWorkspaces.insert(workspaceId)
    }

    /// Ensure a ConversationStore exists for a workspace (eager creation on streaming).
    fileprivate func ensureStoreExists(for workspaceId: String) {
        _ = storeCache.getOrCreate(workspaceId)
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
        case .status(_, _, let streaming, _, _):
            let isStreaming = streaming ?? false
            monitor?.didReceiveStreaming(isStreaming, for: workspaceId)
            if isStreaming {
                monitor?.ensureStoreExists(for: workspaceId)
            }

        case .diffStats(let stats):
            monitor?.didReceiveDiffStats(stats, for: workspaceId)

        case .branchInfo(let info):
            monitor?.didReceiveBranchInfo(info, for: workspaceId)

        case .done:
            monitor?.didReceiveDone(for: workspaceId)

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

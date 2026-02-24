import Foundation
import Observation

/// Monitors real-time status for all workspaces via a single WebSocket per workspace.
///
/// Each `WorkspaceConnection` fully decodes ALL WS events:
/// - Hub-level events (status, diff_stats, branch_info) update monitor properties.
/// - ALL events are forwarded to the workspace's `ConversationStore` (via `ConversationStoreCache`).
///
/// This eliminates the need for a separate `WebSocketManager` in `ChatView`.
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

    private var connections: [String: WorkspaceConnection] = [:]
    private var prPollTasks: [String: Task<Void, Never>] = [:]
    private let apiClient = APIClient()

    init(storeCache: ConversationStoreCache) {
        self.storeCache = storeCache
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

    /// Sync monitored workspaces — opens new connections, closes stale ones.
    func sync(workspaceIds: [String]) {
        let desired = Set(workspaceIds)
        let current = Set(connections.keys)

        // Remove connections for workspaces no longer in the list
        for id in current.subtracting(desired) {
            connections[id]?.cancel()
            connections.removeValue(forKey: id)
            streamingWorkspaces.remove(id)
            workspaceDiffStats.removeValue(forKey: id)
            workspaceBranchInfo.removeValue(forKey: id)
            prPollTasks[id]?.cancel()
            prPollTasks.removeValue(forKey: id)
            workspacePrStatus.removeValue(forKey: id)
            storeCache.evict(id)
            completedWorkspaces.remove(id)
        }

        // Add connections for new workspaces
        for id in desired.subtracting(current) {
            let conn = WorkspaceConnection(workspaceId: id, monitor: self)
            connections[id] = conn
            conn.connect()
        }
    }

    /// Disconnect everything.
    func disconnectAll() {
        for conn in connections.values { conn.cancel() }
        connections.removeAll()
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

    // MARK: - Called by WorkspaceConnection

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
}

// MARK: - Per-workspace full connection

@MainActor
private final class WorkspaceConnection {
    let workspaceId: String
    private weak var monitor: HubStatusMonitor?

    private var wsTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var intentionallyClosed = false
    private var backoff: UInt64 = 1

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(workspaceId: String, monitor: HubStatusMonitor) {
        self.workspaceId = workspaceId
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

    /// Send a message to the backend via this workspace's WS connection.
    func send(_ message: WsIncoming) async {
        guard let wsTask else { return }
        guard let data = try? encoder.encode(message),
              let string = String(data: data, encoding: .utf8) else { return }
        try? await wsTask.send(.string(string))
    }

    private func performConnect() {
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""

        guard let url = URL(string: "ws://\(host):\(port)/ws/session/\(workspaceId)?token=\(token)") else {
            return
        }

        let task = URLSession.shared.webSocketTask(with: url)
        task.maximumMessageSize = 10 * 1024 * 1024 // 10 MB — match backend maxPayload
        self.wsTask = task
        task.resume()
        backoff = 1

        // Re-wire send closure on existing store (handles reconnects)
        wireSendClosure()

        startReceiving()
        startPinging()
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

        // Full decode — all event types are parsed.
        guard let event = try? decoder.decode(WsOutgoing.self, from: data) else { return }

        // Hub-level processing
        switch event {
        case .status(_, _, let streaming, _, _):
            let isStreaming = streaming ?? false
            monitor?.didReceiveStreaming(isStreaming, for: workspaceId)

            // Eager store creation: when streaming starts, ensure a ConversationStore
            // exists so it accumulates events even if ChatView isn't open.
            if isStreaming {
                ensureStoreExists()
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

    // MARK: - Send closure wiring

    /// Ensure a ConversationStore exists for this workspace and wire its send closure.
    private func ensureStoreExists() {
        guard let cache = monitor?.storeCache else { return }
        let store = cache.getOrCreate(workspaceId)
        if store.send == nil {
            wireSendClosure(store: store)
        }
    }

    /// Wire (or re-wire) the send closure on the store for this workspace.
    private func wireSendClosure(store: ConversationStore? = nil) {
        guard let cache = monitor?.storeCache else { return }
        let target = store ?? cache.stores[workspaceId]
        target?.send = { [weak self] message in
            await self?.send(message)
        }
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

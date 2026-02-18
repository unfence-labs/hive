import Foundation
import Observation

/// Monitors real-time streaming status, diff stats, and branch/PR info for all workspaces.
///
/// Opens a lightweight WebSocket connection per workspace, listens for `status`,
/// `diff_stats`, and `branch_info` messages. This mirrors the React frontend's
/// `useWorkspaceLiveData` approach.
@MainActor
@Observable
final class HubStatusMonitor {
    private(set) var streamingWorkspaces: Set<String> = []
    private(set) var workspaceDiffStats: [String: DiffStatResponse] = [:]
    private(set) var workspaceBranchInfo: [String: BranchInfo] = [:]

    private var connections: [String: WorkspaceConnection] = [:]
    private let decoder = JSONDecoder()

    func isStreaming(_ workspaceId: String) -> Bool {
        streamingWorkspaces.contains(workspaceId)
    }

    func diffStats(for workspaceId: String) -> DiffStatResponse? {
        workspaceDiffStats[workspaceId]
    }

    func branchInfo(for workspaceId: String) -> BranchInfo? {
        workspaceBranchInfo[workspaceId]
    }

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
    }

    // MARK: - Called by WorkspaceConnection

    fileprivate func didReceiveStreaming(_ streaming: Bool, for workspaceId: String) {
        if streaming {
            streamingWorkspaces.insert(workspaceId)
        } else {
            streamingWorkspaces.remove(workspaceId)
        }
    }

    fileprivate func didReceiveDiffStats(_ stats: DiffStatResponse, for workspaceId: String) {
        workspaceDiffStats[workspaceId] = stats
    }

    fileprivate func didReceiveBranchInfo(_ info: BranchInfo, for workspaceId: String) {
        workspaceBranchInfo[workspaceId] = info
    }
}

// MARK: - Per-workspace lightweight connection

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

    private func performConnect() {
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""

        guard let url = URL(string: "ws://\(host):\(port)/ws/session/\(workspaceId)?token=\(token)") else {
            return
        }

        let task = URLSession.shared.webSocketTask(with: url)
        self.wsTask = task
        task.resume()
        backoff = 1
        startReceiving()
        startPinging()
    }

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

        // Lightweight selective decode — only handle types the hub cares about.
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "status":
            let streaming = json["streaming"] as? Bool ?? false
            monitor?.didReceiveStreaming(streaming, for: workspaceId)
        case "diff_stats":
            if let statsJson = json["stats"],
               let statsData = try? JSONSerialization.data(withJSONObject: statsJson),
               let stats = try? decoder.decode(DiffStatResponse.self, from: statsData) {
                monitor?.didReceiveDiffStats(stats, for: workspaceId)
            }
        case "branch_info":
            if let infoJson = json["info"],
               let infoData = try? JSONSerialization.data(withJSONObject: infoJson),
               let info = try? decoder.decode(BranchInfo.self, from: infoData) {
                monitor?.didReceiveBranchInfo(info, for: workspaceId)
            }
        default:
            break
        }
    }

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

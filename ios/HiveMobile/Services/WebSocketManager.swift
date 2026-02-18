import Foundation
import Observation

enum ConnectionState {
    case disconnected
    case connecting
    case connected
}

@MainActor
@Observable
final class WebSocketManager {
    var connectionState: ConnectionState = .disconnected

    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<WsOutgoing>.Continuation?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var currentWorkspaceId: String?
    private var intentionalDisconnect = false
    private var backoffSeconds: UInt64 = 1

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Message stream

    private(set) var messages: AsyncStream<WsOutgoing> = AsyncStream { _ in }

    private func makeStream() {
        messages = AsyncStream { [weak self] continuation in
            self?.continuation = continuation
        }
    }

    // MARK: - Public API

    func connect(workspaceId: String) {
        disconnect()
        intentionalDisconnect = false
        currentWorkspaceId = workspaceId
        makeStream()
        performConnect()
    }

    func disconnect() {
        intentionalDisconnect = true
        cancelAll()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectionState = .disconnected
    }

    func send(_ message: WsIncoming) async {
        guard let task, connectionState == .connected else { return }
        guard let data = try? encoder.encode(message),
              let string = String(data: data, encoding: .utf8) else { return }
        try? await task.send(.string(string))
    }

    // MARK: - Connection

    private func performConnect() {
        guard let workspaceId = currentWorkspaceId else { return }

        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""

        guard let url = URL(string: "ws://\(host):\(port)/ws/session/\(workspaceId)?token=\(token)") else {
            return
        }

        connectionState = .connecting
        let wsTask = URLSession.shared.webSocketTask(with: url)
        self.task = wsTask
        wsTask.resume()

        connectionState = .connected
        backoffSeconds = 1

        startReceiving()
        startPinging()
    }

    // MARK: - Receive loop

    private func startReceiving() {
        receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let task = self.task else { break }
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        guard let data = text.data(using: .utf8),
                              let decoded = try? self.decoder.decode(WsOutgoing.self, from: data) else {
                            continue
                        }
                        self.continuation?.yield(decoded)
                    case .data(let data):
                        guard let decoded = try? self.decoder.decode(WsOutgoing.self, from: data) else {
                            continue
                        }
                        self.continuation?.yield(decoded)
                    @unknown default:
                        continue
                    }
                } catch {
                    if !Task.isCancelled {
                        self.handleDisconnect()
                    }
                    break
                }
            }
        }
    }

    // MARK: - Ping keepalive

    private func startPinging() {
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                self?.task?.sendPing { error in
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
        cancelAll()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectionState = .disconnected

        guard !intentionalDisconnect else { return }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectTask = Task { [weak self] in
            guard let self, let _ = self.currentWorkspaceId else { return }
            let delay = self.backoffSeconds
            self.backoffSeconds = min(self.backoffSeconds * 2, 30)
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, !self.intentionalDisconnect else { return }
            self.performConnect()
        }
    }

    // MARK: - Cleanup

    private func cancelAll() {
        receiveTask?.cancel()
        pingTask?.cancel()
        reconnectTask?.cancel()
        receiveTask = nil
        pingTask = nil
        reconnectTask = nil
    }
}

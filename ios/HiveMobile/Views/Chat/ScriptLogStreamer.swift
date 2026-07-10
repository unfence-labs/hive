import Foundation
import Observation

@MainActor
@Observable
final class ScriptLogStreamer {
    private(set) var lines: [AnsiLine] = []
    private(set) var pending: AnsiLine?
    private(set) var truncated = false

    private var parser = AnsiLogParser()
    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var intentionallyClosed = false
    private var streamEnded = false
    private var backoff: UInt64 = 1

    private var workspaceId = ""
    private var scriptType = ""

    func start(workspaceId: String, scriptType: String) {
        self.workspaceId = workspaceId
        self.scriptType = scriptType
        reconnectFresh()
    }

    func reconnectFresh() {
        intentionallyClosed = false
        streamEnded = false
        backoff = 1
        connect()
    }

    func stop() {
        intentionallyClosed = true
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveLoop?.cancel()
        receiveLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    func clear() {
        intentionallyClosed = true
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveLoop?.cancel()
        receiveLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        parser.reset()
        publish()
    }

    private func connect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveLoop?.cancel()
        task?.cancel(with: .goingAway, reason: nil)

        parser.reset()
        publish()

        guard let url = makeURL() else { return }

        let webSocketTask = HiveHTTP.session.webSocketTask(with: url)
        webSocketTask.maximumMessageSize = 10 * 1024 * 1024
        task = webSocketTask
        webSocketTask.resume()

        receiveLoop = Task { [weak self] in
            await self?.receive(on: webSocketTask)
        }
    }

    private func receive(on webSocketTask: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await webSocketTask.receive()
                guard webSocketTask === task else { return }
                switch message {
                case .data(let data):
                    parser.feed(data)
                    publish()
                case .string(let string):
                    handleControl(string)
                @unknown default:
                    break
                }
            } catch {
                if !Task.isCancelled {
                    scheduleReconnect()
                }
                return
            }
        }
    }

    private func handleControl(_ string: String) {
        guard let data = string.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }

        if type == "exit" || type == "error" {
            streamEnded = true
        }
    }

    private func scheduleReconnect() {
        guard !intentionallyClosed, !streamEnded else { return }
        reconnectTask?.cancel()
        let delay = backoff
        backoff = min(backoff * 2, 8)
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Double(delay)))
            guard !Task.isCancelled, let self, !self.intentionallyClosed, !self.streamEnded else { return }
            self.connect()
        }
    }

    private func publish() {
        lines = parser.lines
        pending = parser.pending
        truncated = parser.truncated
    }

    private func makeURL() -> URL? {
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""
        guard !host.isEmpty, let portInt = Int(port) else { return nil }

        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = portInt
        components.path = "/ws/script/\(workspaceId)"
        var query = [URLQueryItem(name: "type", value: scriptType)]
        if !token.isEmpty {
            query.append(URLQueryItem(name: "token", value: token))
        }
        components.queryItems = query
        return components.url
    }
}

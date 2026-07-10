import Foundation
import Observation

@MainActor
@Observable
final class ScriptLogStreamer {
    private(set) var lines: [AnsiLine] = []
    private(set) var pending: AnsiLine?
    private(set) var truncated = false
    private(set) var serverError: String?

    private var parser = AnsiLogParser()
    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var publishTask: Task<Void, Never>?
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
        publishTask?.cancel()
        publishTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func connect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveLoop?.cancel()
        publishTask?.cancel()
        publishTask = nil
        task?.cancel(with: .goingAway, reason: nil)

        parser.reset()
        serverError = nil
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
                    schedulePublish()
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
        guard let control = ScriptStreamControl.parse(string) else { return }
        switch control {
        case .ready:
            return
        case .exit:
            streamEnded = true
        case .error(let message):
            streamEnded = true
            serverError = message ?? "Log stream unavailable"
        }
        publishTask?.cancel()
        publishTask = nil
        publish()
    }

    private func schedulePublish() {
        guard publishTask == nil else { return }
        publishTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard let self, !Task.isCancelled else { return }
            self.publishTask = nil
            self.publish()
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
        ServerEndpoint.webSocketURL(
            path: "/ws/script/\(workspaceId)",
            queryItems: [URLQueryItem(name: "type", value: scriptType)]
        )
    }
}

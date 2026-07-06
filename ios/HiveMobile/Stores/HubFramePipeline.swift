import Foundation

final class HubFramePipeline {
    private let continuation: AsyncStream<URLSessionWebSocketTask.Message>.Continuation
    private let worker: Task<Void, Never>

    init(onEvent: @escaping @MainActor (HubOutgoing) -> Void) {
        let (frames, continuation) = AsyncStream.makeStream(of: URLSessionWebSocketTask.Message.self)
        self.continuation = continuation
        worker = Task.detached(priority: .userInitiated) {
            let decoder = JSONDecoder()
            for await frame in frames {
                guard let envelope = Self.decode(frame, using: decoder) else { continue }
                await onEvent(envelope)
            }
        }
    }

    func submit(_ frame: URLSessionWebSocketTask.Message) { continuation.yield(frame) }
    func finish() { continuation.finish() }
    func drain() async { await worker.value }

    private static func decode(_ frame: URLSessionWebSocketTask.Message, using decoder: JSONDecoder) -> HubOutgoing? {
        let data: Data?
        switch frame {
        case .string(let text): data = text.data(using: .utf8)
        case .data(let d): data = d
        @unknown default: data = nil
        }
        guard let data else { return nil }
        return try? decoder.decode(HubOutgoing.self, from: data)
    }

    deinit { continuation.finish() }
}

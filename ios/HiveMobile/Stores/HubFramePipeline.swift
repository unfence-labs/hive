import Foundation

actor HubFrameBuffer {
    private let capacity: Int
    private var queue: [URLSessionWebSocketTask.Message] = []
    private var frameWaiters: [CheckedContinuation<URLSessionWebSocketTask.Message?, Never>] = []
    private var spaceWaiters: [CheckedContinuation<Void, Never>] = []
    private var isFinished = false

    init(capacity: Int) {
        self.capacity = max(1, capacity)
    }

    @discardableResult
    func enqueue(_ frame: URLSessionWebSocketTask.Message) async -> Bool {
        while queue.count >= capacity && !isFinished && !Task.isCancelled {
            await withCheckedContinuation { continuation in
                spaceWaiters.append(continuation)
            }
        }

        // A cancelled producer (the receive loop of a socket torn down during
        // reconnect) must not inject its stale frame into the shared buffer.
        guard !isFinished, !Task.isCancelled else { return false }

        if !frameWaiters.isEmpty {
            let waiter = frameWaiters.removeFirst()
            waiter.resume(returning: frame)
        } else {
            queue.append(frame)
        }
        return true
    }

    func next() async -> URLSessionWebSocketTask.Message? {
        if !queue.isEmpty {
            let frame = queue.removeFirst()
            resumeOneSpaceWaiter()
            return frame
        }

        guard !isFinished else { return nil }

        return await withCheckedContinuation { continuation in
            frameWaiters.append(continuation)
        }
    }

    func finish() {
        isFinished = true

        let pendingFrameWaiters = frameWaiters
        frameWaiters.removeAll()
        for waiter in pendingFrameWaiters {
            waiter.resume(returning: nil)
        }

        let pendingSpaceWaiters = spaceWaiters
        spaceWaiters.removeAll()
        for waiter in pendingSpaceWaiters {
            waiter.resume()
        }
    }

    private func resumeOneSpaceWaiter() {
        guard !spaceWaiters.isEmpty else { return }
        let waiter = spaceWaiters.removeFirst()
        waiter.resume()
    }
}

final class HubFramePipeline {
    private let buffer: HubFrameBuffer
    private let worker: Task<Void, Never>

    init(maxBufferedFrames: Int = 32, onEvent: @escaping @MainActor (HubOutgoing) -> Void) {
        let buffer = HubFrameBuffer(capacity: maxBufferedFrames)
        self.buffer = buffer
        worker = Task.detached(priority: .userInitiated) {
            let decoder = JSONDecoder()
            while !Task.isCancelled {
                guard let frame = await buffer.next() else { break }
                guard let envelope = Self.decode(frame, using: decoder) else { continue }
                await onEvent(envelope)
            }
        }
    }

    @discardableResult
    func submit(_ frame: URLSessionWebSocketTask.Message) async -> Bool {
        await buffer.enqueue(frame)
    }

    func finish() async {
        await buffer.finish()
        await worker.value
    }

    func cancel() async {
        worker.cancel()
        await buffer.finish()
        await worker.value
    }

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

    deinit {
        worker.cancel()
        let buffer = buffer
        Task { await buffer.finish() }
    }
}

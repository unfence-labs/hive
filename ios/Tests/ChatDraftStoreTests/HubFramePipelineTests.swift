import Foundation
import Testing
@testable import HiveMobileStoresCore

struct HubFramePipelineTests {
    private func frame(_ event: String) -> String {
        #"{"workspaceId":"ws-1","event":\#(event)}"#
    }

    private func text(from frame: URLSessionWebSocketTask.Message?) -> String? {
        guard let frame else { return nil }
        return switch frame {
        case .string(let text): text
        case .data(let data): String(data: data, encoding: .utf8)
        @unknown default: nil
        }
    }

    @Test @MainActor
    func burstMatchesSynchronousApplication() async throws {
        let frames = [
            frame(#"{"type":"status","status":"busy","sessionId":"session-1","streaming":true}"#),
            frame(#"{"type":"text_delta","sessionId":"session-1","text":"Hello "}"#),
            frame(#"{"type":"text_delta","sessionId":"session-1","text":"streaming "}"#),
            frame(#"{"type":"text_delta","sessionId":"session-1","text":"world"}"#),
            frame(#"{"type":"tool_use","sessionId":"session-1","id":"tool-1","name":"Read","input":"{}"}"#),
            frame(#"{"type":"tool_result","sessionId":"session-1","toolUseId":"tool-1","output":"ok"}"#),
            frame(#"{"type":"stream_snapshot","sessionId":"session-1","text":"Canonical","thinking":"","toolCalls":[],"agentActivities":[],"agentPlanMode":false}"#),
            frame(#"{"type":"text_delta","sessionId":"session-1","text":" tail"}"#),
            frame(#"{"type":"done","sessionId":"session-1","durationMs":10}"#)
        ]

        let pipelineStore = ConversationStore(streamFlushInterval: nil)
        let inlineStore = ConversationStore(streamFlushInterval: nil)
        let pipeline = HubFramePipeline { envelope in
            pipelineStore.handle(envelope.event)
        }
        let decoder = JSONDecoder()
        for frame in frames {
            await pipeline.submit(.string(frame))
            let envelope = try decoder.decode(HubOutgoing.self, from: Data(frame.utf8))
            inlineStore.handle(envelope.event)
        }
        await pipeline.finish()
        pipelineStore.flushStreamingDeltas()
        inlineStore.flushStreamingDeltas()

        #expect(pipelineStore.messages.map(\.content) == inlineStore.messages.map(\.content))
        #expect(pipelineStore.messages.map(\.role) == inlineStore.messages.map(\.role))
        #expect(pipelineStore.messages.map(\.content) == ["Canonical tail"])
        #expect(pipelineStore.currentText == inlineStore.currentText)
        #expect(Set(pipelineStore.sessionStreams.keys) == Set(inlineStore.sessionStreams.keys))
    }

    @Test @MainActor
    func largeSnapshotThenDeltaStaysOrdered() async {
        let snapshotText = String(repeating: "x", count: 2_000_000)
        let store = ConversationStore(streamFlushInterval: nil)
        let pipeline = HubFramePipeline { envelope in
            store.handle(envelope.event)
        }

        await pipeline.submit(.string(frame(
            #"{"type":"stream_snapshot","sessionId":"session-1","text":"\#(snapshotText)","thinking":"","toolCalls":[],"agentActivities":[],"agentPlanMode":false}"#
        )))
        await pipeline.submit(.string(frame(#"{"type":"text_delta","sessionId":"session-1","text":"tail"}"#)))
        await pipeline.finish()
        store.flushStreamingDeltas()

        #expect(store.currentText == snapshotText + "tail")
    }

    @Test @MainActor
    func malformedFrameIsDroppedWithoutStallingDelivery() async {
        let store = ConversationStore(streamFlushInterval: nil)
        let pipeline = HubFramePipeline { envelope in
            store.handle(envelope.event)
        }

        await pipeline.submit(.string(frame(#"{"type":"status","status":"busy","sessionId":"session-1","streaming":true}"#)))
        await pipeline.submit(.string("not json"))
        await pipeline.submit(.string(frame(#"{"type":"text_delta","sessionId":"session-1","text":"after"}"#)))
        await pipeline.finish()
        store.flushStreamingDeltas()

        #expect(store.currentText == "after")
        #expect(store.sessionStreams["session-1"]?.isStreaming == true)
    }

    @Test @MainActor
    func framesSubmittedAfterFinishAreDropped() async {
        var delivered = 0
        let pipeline = HubFramePipeline { _ in delivered += 1 }

        await pipeline.submit(.string(frame(#"{"type":"text_delta","sessionId":"session-1","text":"before"}"#)))
        await pipeline.finish()
        await pipeline.submit(.string(frame(#"{"type":"text_delta","sessionId":"session-1","text":"after"}"#)))

        #expect(delivered == 1)
    }

    @Test
    func boundedBufferResumesSubmitWhenSpaceIsAvailable() async {
        let buffer = HubFrameBuffer(capacity: 1)
        await buffer.enqueue(.string("first"))

        let submitSecond = Task {
            await buffer.enqueue(.string("second"))
        }
        await Task.yield()

        let first = await buffer.next()
        let accepted = await submitSecond.value
        let second = await buffer.next()

        #expect(text(from: first) == "first")
        #expect(accepted == true)
        #expect(text(from: second) == "second")
        await buffer.finish()
    }

    @Test
    func boundedBufferRejectsSubmitAfterFinish() async {
        let buffer = HubFrameBuffer(capacity: 1)
        await buffer.enqueue(.string("first"))

        let submitSecond = Task {
            await buffer.enqueue(.string("second"))
        }
        await Task.yield()

        await buffer.finish()

        let accepted = await submitSecond.value
        let acceptedAfterFinish = await buffer.enqueue(.string("third"))

        #expect(accepted == false)
        #expect(acceptedAfterFinish == false)
    }

    @Test
    func boundedBufferRejectsSubmitFromCancelledTask() async {
        let buffer = HubFrameBuffer(capacity: 1)
        await buffer.enqueue(.string("first"))

        let submitSecond = Task {
            await buffer.enqueue(.string("second"))
        }
        await Task.yield()
        submitSecond.cancel()

        let first = await buffer.next()
        let accepted = await submitSecond.value

        #expect(text(from: first) == "first")
        #expect(accepted == false)
        await buffer.finish()
    }
}

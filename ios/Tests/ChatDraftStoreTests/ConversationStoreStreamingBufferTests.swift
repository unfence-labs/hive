import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreStreamingBufferTests {
    @Test @MainActor
    func buffersDeltasUntilFlushAppliesThemInOrder() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "A"))
        store.handle(.textDelta(sessionId: "session-1", text: "B"))
        store.handle(.textDelta(sessionId: "session-1", text: "C"))
        #expect(store.currentText == "")

        store.flushStreamingDeltas()
        #expect(store.currentText == "ABC")
    }

    @Test @MainActor
    func interleavedTextAndReasoningDeltasLandInTheirOwnBuffers() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "Hello"))
        store.handle(.thinking(sessionId: "session-1", blockId: "r", segments: [
            ReasoningSegment(id: "r:0", headline: nil, body: "Consider"),
        ]))
        store.handle(.textDelta(sessionId: "session-1", text: " world"))
        // Buffered updates for the same block coalesce: the latest state wins.
        store.handle(.thinking(sessionId: "session-1", blockId: "r", segments: [
            ReasoningSegment(id: "r:0", headline: nil, body: "Consider options"),
        ]))
        #expect(store.currentText == "")
        #expect(store.reasoningSegments.isEmpty)

        store.flushStreamingDeltas()
        #expect(store.currentText == "Hello world")
        #expect(store.reasoningSegments.map(\.body) == ["Consider options"])
    }

    @Test @MainActor
    func doneIncludesBufferedTailWithoutManualFlush() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "Partial"))
        store.handle(.textDelta(sessionId: "session-1", text: " tail"))
        store.handle(.done(
            sessionId: "session-1",
            durationMs: 100,
            inputTokens: nil,
            outputTokens: nil,
            contextUsedTokens: nil,
            contextWindowTokens: nil,
            pendingToolName: nil
        ))

        #expect(store.messages.last?.content == "Partial tail")
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @Test @MainActor
    func deltasForUnknownSessionsAreDropped() {
        let store = ConversationStore(streamFlushInterval: nil)

        store.handle(.textDelta(sessionId: "ghost", text: "x"))
        store.handle(.thinking(sessionId: "ghost", blockId: "g", segments: [
            ReasoningSegment(id: "g:0", headline: nil, body: "y"),
        ]))
        store.flushStreamingDeltas()

        #expect(store.sessionStreams["ghost"] == nil)
    }

    @Test @MainActor
    func streamSnapshotDiscardsPendingBuffers() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "buffered tail"))
        store.handle(.thinking(sessionId: "session-1", blockId: "b", segments: [
            ReasoningSegment(id: "b:0", headline: nil, body: "buffered thinking"),
        ]))
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "canonical",
            toolCalls: [],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: nil,
            reasoningSegments: [ReasoningSegment(id: "c:0", headline: "canonical thinking", body: nil)]
        ))
        store.flushStreamingDeltas()

        #expect(store.currentText == "canonical")
        #expect(store.reasoningSegments.map(\.headline) == ["canonical thinking"])
    }

    @Test @MainActor
    func errorFlushesBufferedDeltasBeforeAppendingErrorMessage() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "partial tail"))
        store.handle(.error(message: "boom", sessionId: "session-1"))

        #expect(store.currentText == "partial tail")
        #expect(store.messages.last?.content == "Error: boom")
    }

    @MainActor
    private func waitUntil(
        _ condition: @MainActor () -> Bool,
        timeout: Duration = .seconds(2)
    ) async throws {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while !condition() && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    @Test @MainActor
    func scheduledFlushAppliesDeltasWithoutManualFlush() async throws {
        let store = ConversationStore(streamFlushInterval: 0.01)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "auto"))
        store.handle(.thinking(sessionId: "session-1", blockId: "r", segments: [
            ReasoningSegment(id: "r:0", headline: nil, body: "thought"),
        ]))
        #expect(store.currentText == "")

        try await waitUntil { store.currentText == "auto" }
        #expect(store.currentText == "auto")
        #expect(store.reasoningSegments.map(\.body) == ["thought"])
    }

    @Test @MainActor
    func scheduledFlushCoalescesBurstInOrder() async throws {
        let store = ConversationStore(streamFlushInterval: 0.01)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "A"))
        store.handle(.textDelta(sessionId: "session-1", text: "B"))
        store.handle(.textDelta(sessionId: "session-1", text: "C"))

        try await waitUntil { store.currentText == "ABC" }
        #expect(store.currentText == "ABC")
    }

    @Test @MainActor
    func manualFlushDoesNotBreakSubsequentScheduling() async throws {
        let store = ConversationStore(streamFlushInterval: 0.01)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "first"))
        store.flushStreamingDeltas()
        #expect(store.currentText == "first")

        store.handle(.textDelta(sessionId: "session-1", text: " second"))
        try await waitUntil { store.currentText == "first second" }
        #expect(store.currentText == "first second")
    }
}

extension ConversationStoreStreamingBufferTests {
    @Test @MainActor
    func uiHoldKeepsBufferingUntilReleased() async throws {
        let store = ConversationStore(streamFlushInterval: 0.01)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.setStreamingUIHold(true)
        store.handle(.textDelta(sessionId: "session-1", text: "held"))
        try await Task.sleep(for: .milliseconds(60))
        #expect(store.currentText == "")

        store.handle(.textDelta(sessionId: "session-1", text: " too"))
        store.setStreamingUIHold(false)
        #expect(store.currentText == "held too")

        store.handle(.textDelta(sessionId: "session-1", text: ", resumed"))
        try await waitUntil { store.currentText == "held too, resumed" }
    }
}

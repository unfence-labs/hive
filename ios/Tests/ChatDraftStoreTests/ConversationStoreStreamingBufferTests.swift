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
    func interleavedTextAndThinkingDeltasLandInTheirOwnBuffers() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.textDelta(sessionId: "session-1", text: "Hello"))
        store.handle(.thinking(sessionId: "session-1", text: "Consider"))
        store.handle(.textDelta(sessionId: "session-1", text: " world"))
        store.handle(.thinking(sessionId: "session-1", text: " options"))
        #expect(store.currentText == "")
        #expect(store.currentThinking == "")

        store.flushStreamingDeltas()
        #expect(store.currentText == "Hello world")
        #expect(store.currentThinking == "Consider options")
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
        store.handle(.thinking(sessionId: "ghost", text: "y"))
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
        store.handle(.thinking(sessionId: "session-1", text: "buffered thinking"))
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "canonical",
            thinking: "canonical thinking",
            toolCalls: [],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: nil
        ))
        store.flushStreamingDeltas()

        #expect(store.currentText == "canonical")
        #expect(store.currentThinking == "canonical thinking")
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
        store.handle(.thinking(sessionId: "session-1", text: "thought"))
        #expect(store.currentText == "")

        try await waitUntil { store.currentText == "auto" }
        #expect(store.currentText == "auto")
        #expect(store.currentThinking == "thought")
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

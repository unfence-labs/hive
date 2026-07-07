import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreForegroundReconcileTests {
    /// The agent finishes its turn while the app is backgrounded, so the client
    /// never receives `done`. On foreground the hub bootstrap only resends
    /// `status: idle` for the finished session. The streaming indicator must
    /// clear AND the finalized last message must be reconciled from REST — the
    /// store has to request a history refetch (onTurnCompleted), otherwise the
    /// last agent message stays missing until the conversation view reloads.
    @Test @MainActor
    func backgroundedTurnCompletionRequestsHistoryReconcileOnForeground() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s")

        store.handle(.status(status: .busy, sessionId: "s", streaming: true,
                             streamingStartedAt: nil, lockedProvider: nil))
        store.handle(.textDelta(sessionId: "s", text: "partial"))
        store.flushStreamingDeltas()
        #expect(store.isStreaming)

        var reconciledSession: String?
        store.onTurnCompleted = { reconciledSession = $0 }

        store.handle(.status(status: .idle, sessionId: "s", streaming: false,
                             streamingStartedAt: nil, lockedProvider: nil))

        #expect(!store.isStreaming)
        #expect(reconciledSession == "s")
    }

    /// A plain idle status for a session that was never streaming must NOT
    /// request a refetch — only a genuine streaming→idle transition does.
    @Test @MainActor
    func idleStatusForNonStreamingSessionDoesNotReconcile() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s")

        var reconciledSession: String?
        store.onTurnCompleted = { reconciledSession = $0 }

        store.handle(.status(status: .idle, sessionId: "s", streaming: false,
                             streamingStartedAt: nil, lockedProvider: nil))

        #expect(reconciledSession == nil)
    }

    /// A normal live turn ends via `done`, which removes the stream slot before
    /// any trailing `status: idle`. That trailing idle must not fire a second
    /// reconcile (the slot is already gone).
    @Test @MainActor
    func trailingIdleAfterDoneDoesNotReconcileTwice() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s")

        store.handle(.status(status: .busy, sessionId: "s", streaming: true,
                             streamingStartedAt: nil, lockedProvider: nil))
        store.handle(.textDelta(sessionId: "s", text: "answer"))
        store.handle(.done(sessionId: "s", durationMs: 10, inputTokens: nil,
                           outputTokens: nil, contextUsedTokens: nil,
                           contextWindowTokens: nil, pendingToolName: nil))

        var reconciledCount = 0
        store.onTurnCompleted = { _ in reconciledCount += 1 }

        store.handle(.status(status: .idle, sessionId: "s", streaming: false,
                             streamingStartedAt: nil, lockedProvider: nil))

        #expect(reconciledCount == 0)
    }
}

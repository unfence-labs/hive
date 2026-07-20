import Foundation
import Observation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreHistoryFailureTests {
    private func message(id: String, sessionId: String) -> ChatMessage {
        ChatMessage(
            id: id,
            sessionId: sessionId,
            role: .assistant,
            content: "hello",
            images: nil,
            toolCalls: nil,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )
    }

    @Test @MainActor
    func failedFetchMarksSessionAsFailed() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        await store.loadHistoryIfNeeded(for: "s1") { _ in
            throw URLError(.notConnectedToInternet)
        }
        #expect(store.historyLoadFailed(for: "s1"))
        #expect(!store.historyLoadFailed(for: "s2"))
    }

    @Test @MainActor
    func successfulRetryClearsFailureAndAppliesMessages() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        await store.loadHistoryIfNeeded(for: "s1") { _ in
            throw URLError(.timedOut)
        }
        #expect(store.historyLoadFailed(for: "s1"))

        await store.loadHistoryIfNeeded(for: "s1") { _ in
            [self.message(id: "m1", sessionId: "s1")]
        }
        #expect(!store.historyLoadFailed(for: "s1"))
        #expect(store.cachedMessages(for: "s1")?.isEmpty == false)
    }

    @Test @MainActor
    func cancellationDoesNotMarkFailure() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        await store.loadHistoryIfNeeded(for: "s1") { _ in
            throw CancellationError()
        }
        #expect(!store.historyLoadFailed(for: "s1"))
    }

    @Test @MainActor
    func staleRequestDoesNotMarkFailure() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        await store.loadHistoryIfNeeded(for: "s1") { _ in
            store.bumpHistoryToken(for: "s1")
            throw URLError(.notConnectedToInternet)
        }
        #expect(!store.historyLoadFailed(for: "s1"))
    }

    @Test @MainActor
    func removeSessionStateClearsFailure() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        await store.loadHistoryIfNeeded(for: "s1") { _ in
            throw URLError(.notConnectedToInternet)
        }
        #expect(store.historyLoadFailed(for: "s1"))

        store.removeSessionState("s1", fallbackSessionId: nil)
        #expect(!store.historyLoadFailed(for: "s1"))
    }
}

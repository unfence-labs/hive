import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreHistoryLoadTests {
    private func message(_ id: String, content: String? = nil) -> ChatMessage {
        ChatMessage(
            id: id,
            sessionId: "session-1",
            role: .user,
            content: content ?? "Message \(id)",
            images: nil,
            toolCalls: nil,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )
    }

    @MainActor
    private func seededStore() -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-1")
        store.applyFetchedHistory([message("m1"), message("m2")], for: "session-1")
        return store
    }

    @Test @MainActor
    func freshCacheSkipsFetch() async {
        let store = seededStore()
        var fetchCount = 0

        await store.loadHistoryIfNeeded(for: "session-1") { _ in
            fetchCount += 1
            return []
        }

        #expect(fetchCount == 0)
        #expect(store.messages.map(\.id) == ["m1", "m2"])
    }

    @Test @MainActor
    func staleTailGoesIncrementalAndMerges() async {
        let store = seededStore()
        var seenSince: [String?] = []

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { since in
            seenSince.append(since)
            return [self.message("m3")]
        }

        #expect(seenSince == ["m2"])
        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
        #expect(store.cachedMessages(for: "session-1")?.map(\.id) == ["m1", "m2", "m3"])
        #expect(store.lastServerMessageId(for: "session-1") == "m3")
    }

    @Test @MainActor
    func noTailFallsBackToFullFetch() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-1")
        var seenSince: [String?] = []

        await store.loadHistoryIfNeeded(for: "session-1") { since in
            seenSince.append(since)
            return [self.message("m1"), self.message("m2")]
        }

        #expect(seenSince == [nil])
        #expect(store.messages.map(\.id) == ["m1", "m2"])
    }

    @Test @MainActor
    func overlappingResponseReplacesInsteadOfMerging() async {
        let store = seededStore()

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { _ in
            [
                self.message("m1", content: "Server m1"),
                self.message("m2"),
                self.message("m3")
            ]
        }

        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
        #expect(store.messages.first?.content == "Server m1")
    }

    @Test @MainActor
    func crossClientInvalidationForcesRefetch() async {
        let store = seededStore()
        store.handle(.done(
            sessionId: "session-1",
            durationMs: nil,
            inputTokens: nil,
            outputTokens: nil,
            contextUsedTokens: nil,
            contextWindowTokens: nil,
            pendingToolName: nil
        ))
        var seenSince: [String?] = []

        await store.loadHistoryIfNeeded(for: "session-1") { since in
            seenSince.append(since)
            return [self.message("m3")]
        }

        #expect(seenSince == ["m2"])
        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
    }

    @Test @MainActor
    func staleTokenDiscardsResult() async {
        let store = seededStore()

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { _ in
            store.bumpHistoryToken(for: "session-1")
            return [self.message("m3")]
        }

        #expect(store.messages.map(\.id) == ["m1", "m2"])
        #expect(store.lastServerMessageId(for: "session-1") == "m2")
    }

    @Test @MainActor
    func fetchFailureLeavesStateIntactAndRetrySucceeds() async {
        struct FetchError: Error {}
        let store = seededStore()
        var fetchCount = 0

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { _ in
            fetchCount += 1
            throw FetchError()
        }

        #expect(fetchCount == 1)
        #expect(store.messages.map(\.id) == ["m1", "m2"])
        #expect(store.lastServerMessageId(for: "session-1") == "m2")

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { since in
            fetchCount += 1
            #expect(since == "m2")
            return [self.message("m3")]
        }

        #expect(fetchCount == 2)
        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
    }

    @Test @MainActor
    func doneDuringInFlightFetchDiscardsStaleResponse() async {
        let store = seededStore()

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { _ in
            store.handle(.done(
                sessionId: "session-1",
                durationMs: nil,
                inputTokens: nil,
                outputTokens: nil,
                contextUsedTokens: nil,
                contextWindowTokens: nil,
                pendingToolName: nil
            ))
            return [self.message("m3")]
        }

        #expect(store.messages.map(\.id) == ["m1", "m2"])
        #expect(store.lastServerMessageId(for: "session-1") == "m2")

        var seenSince: [String?] = []
        var fetchCount = 0
        await store.loadHistoryIfNeeded(for: "session-1") { since in
            fetchCount += 1
            seenSince.append(since)
            return [self.message("m3"), self.message("m4")]
        }

        #expect(fetchCount == 1)
        #expect(seenSince == ["m2"])
        #expect(store.messages.map(\.id) == ["m1", "m2", "m3", "m4"])
    }

    @Test @MainActor
    func legacyHistoryFrameDuringInFlightFetchWins() async {
        let store = seededStore()

        await store.loadHistoryIfNeeded(for: "session-1", freshnessWindow: 0) { _ in
            store.handle(.history(
                messages: [self.message("m1"), self.message("m2"), self.message("m3")],
                sessionId: "session-1"
            ))
            return [self.message("m3")]
        }

        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
    }
}

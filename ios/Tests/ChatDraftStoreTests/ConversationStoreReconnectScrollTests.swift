import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Covers the two PRD #254 second-audit fixes:
/// 1. Reconnect refetches REST history so a turn that COMPLETED while
///    backgrounded (no live snapshot) is recovered.
/// 2. "Load earlier" (prepend) must NOT scroll to the bottom, while an append
///    (new turn) still does.
struct ConversationStoreReconnectScrollTests {
    private func message(_ id: String, role: MessageRole = .assistant) -> ChatMessage {
        ChatMessage(
            id: id,
            sessionId: "session-1",
            role: role,
            content: "msg-\(id)",
            images: nil,
            toolCalls: nil,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )
    }

    // MARK: - #1 reconnect REST refetch

    @Test @MainActor
    func reconnectRefetchReplacesFocusedHistory() async {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        // Initial window: only the user's prompt is visible (the completed turn
        // arrived while the app was backgrounded, so it isn't here yet).
        store.applyMessagesPage(MessagesPage(messages: [message("u1", role: .user)], hasMore: false))
        #expect(store.messages.count == 1)

        // Reconnect path refetches REST and the page now includes the completed
        // assistant turn that the live snapshot never delivered.
        await store.refetchFocusedHistory { sessionId in
            #expect(sessionId == "session-1")
            return MessagesPage(
                messages: [message("u1", role: .user), message("a1")],
                hasMore: false
            )
        }

        #expect(store.messages.map(\.id) == ["u1", "a1"])
    }

    @Test @MainActor
    func reconnectRefetchSkipsWhenNoFocusedSession() async {
        let store = ConversationStore()
        // No focused session id — nothing to refetch, fetch must not be invoked.
        var fetchCalled = false
        await store.refetchFocusedHistory { _ in
            fetchCalled = true
            return MessagesPage(messages: [], hasMore: false)
        }
        #expect(fetchCalled == false)
        #expect(store.messages.isEmpty)
    }

    @Test @MainActor
    func reconnectRefetchDropsResultWhenHistoryTokenBumpedMidFlight() async {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.applyMessagesPage(MessagesPage(messages: [message("a1")], hasMore: false))

        // Simulate a newer event (send / session switch) bumping the token while
        // the refetch is in flight: the stale page must be discarded.
        await store.refetchFocusedHistory { sessionId in
            store.bumpHistoryToken(for: sessionId)
            return MessagesPage(messages: [message("stale")], hasMore: false)
        }

        #expect(store.messages.map(\.id) == ["a1"])
    }

    @Test @MainActor
    func reconnectRefetchDropsResultWhenFocusChangedMidFlight() async {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.applyMessagesPage(MessagesPage(messages: [message("a1")], hasMore: false))

        await store.refetchFocusedHistory { _ in
            // Focus moved to another session before the page lands.
            store.setFocusedSessionId("session-2")
            return MessagesPage(messages: [message("stale")], hasMore: false)
        }

        // session-1 window untouched (the apply guards on unchanged focus).
        #expect(store.messages.map(\.id) == ["a1"])
    }

    // MARK: - #2 prepend vs append scroll decision

    @Test
    func appendScrollsToBottom() {
        // New turn appended at the tail: head id unchanged, count grew.
        #expect(ConversationStore.shouldScrollToBottom(
            prevFirstId: "a1", newFirstId: "a1", prevCount: 3, newCount: 4
        ) == true)
    }

    @Test
    func prependDoesNotScrollToBottom() {
        // Load-earlier inserts older messages at index 0: head id changed even
        // though the count grew — must NOT scroll.
        #expect(ConversationStore.shouldScrollToBottom(
            prevFirstId: "a1", newFirstId: "older-1", prevCount: 3, newCount: 6
        ) == false)
    }

    @Test
    func initialPopulationScrollsToBottom() {
        // First history load from empty: prevFirstId is nil — land at the bottom.
        #expect(ConversationStore.shouldScrollToBottom(
            prevFirstId: nil, newFirstId: "a1", prevCount: 0, newCount: 5
        ) == true)
    }

    @Test
    func noGrowthDoesNotScroll() {
        // A clear/replace that shrinks or keeps the count must not chase bottom.
        #expect(ConversationStore.shouldScrollToBottom(
            prevFirstId: "a1", newFirstId: "a1", prevCount: 4, newCount: 4
        ) == false)
        #expect(ConversationStore.shouldScrollToBottom(
            prevFirstId: "a1", newFirstId: nil, prevCount: 4, newCount: 0
        ) == false)
    }
}

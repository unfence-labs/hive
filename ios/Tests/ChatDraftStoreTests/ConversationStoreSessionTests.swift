import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreSessionTests {
    @Test @MainActor
    func prepareSessionSwitchClearsVisibleStateAndInvalidatesHistoryTokens() {
        let store = ConversationStore()
        store.handle(.history(messages: [
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Hello",
                images: nil,
                toolCalls: nil,
                thinkingContent: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], sessionId: "session-1"))
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: "codex"
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Streaming in the background"))
        store.handle(.status(
            status: .busy,
            sessionId: "session-2",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        let previousToken = store.historyToken(for: "session-1")
        let newToken = store.historyToken(for: "session-2")

        #expect(store.messages.count == 1)
        #expect(store.lockedProvider == "codex")

        store.prepareSessionSwitch("session-2")

        #expect(store.sessionId == "session-2")
        #expect(store.messages.isEmpty)
        #expect(store.displayMessages.isEmpty)
        #expect(store.lockedProvider == nil)
        #expect(store.historyToken(for: "session-1") == previousToken + 1)
        #expect(store.historyToken(for: "session-2") == newToken + 1)
        #expect(store.sessionStreams["session-1"]?.currentText == "Streaming in the background")
        #expect(store.sessionStreams["session-1"]?.isStreaming == true)
        #expect(store.sessionStreams["session-2"]?.isStreaming == true)
    }
}

import Foundation
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

    @Test @MainActor
    func removeActiveSessionStateFallsBackToNextSession() {
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
        store.handle(.status(
            status: .busy,
            sessionId: "session-2",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        let fallbackToken = store.historyToken(for: "session-2")

        store.removeSessionState("session-1", fallbackSessionId: "session-2")

        #expect(store.sessionId == "session-2")
        #expect(store.messages.isEmpty)
        #expect(store.lockedProvider == nil)
        #expect(store.sessionStreams["session-1"] == nil)
        #expect(store.sessionStreams["session-2"]?.isStreaming == true)
        #expect(store.historyToken(for: "session-1") == 0)
        #expect(store.historyToken(for: "session-2") == fallbackToken + 1)
    }

    @Test @MainActor
    func removeActiveSessionStateClearsFocusWithoutFallback() {
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

        store.removeSessionState("session-1", fallbackSessionId: nil)

        #expect(store.sessionId == nil)
        #expect(store.messages.isEmpty)
        #expect(store.displayMessages.isEmpty)
        #expect(store.lockedProvider == nil)
        #expect(store.sessionStreams["session-1"] == nil)
        #expect(store.historyToken(for: "session-1") == 0)
    }

    @Test @MainActor
    func removeBackgroundSessionStateKeepsActiveConversation() {
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
            sessionId: "session-2",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.removeSessionState("session-2", fallbackSessionId: nil)

        #expect(store.sessionId == "session-1")
        #expect(store.messages.count == 1)
        #expect(store.sessionStreams["session-2"] == nil)
    }

    @Test @MainActor
    func statusStreamingClearsPendingToolInputs() {
        let store = ConversationStore()
        store.handle(.status(
            status: .idle,
            sessionId: "session-1",
            streaming: false,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.toolInputRequired(
            sessionId: "session-1",
            requestId: "req-1",
            toolName: "AskUserQuestion",
            toolUseId: "tool-1",
            input: "{}"
        ))
        #expect(store.pendingToolInputs.count == 1)

        // The question was answered on another client; the turn resumes streaming.
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        #expect(store.pendingToolInputs.isEmpty)
        #expect(store.isStreaming == true)
    }

    @Test @MainActor
    func toolInputResolvedClearsPendingToolInputs() throws {
        let store = ConversationStore()
        store.handle(.status(
            status: .idle,
            sessionId: "session-1",
            streaming: false,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.toolInputRequired(
            sessionId: "session-1",
            requestId: "req-1",
            toolName: "AskUserQuestion",
            toolUseId: "tool-1",
            input: "{}"
        ))
        #expect(store.pendingToolInputs.count == 1)

        // Decode from raw JSON so the wire format is covered too.
        let json = Data(#"{"type":"tool_input_resolved","sessionId":"session-1"}"#.utf8)
        let event = try JSONDecoder().decode(WsOutgoing.self, from: json)
        store.handle(event)

        #expect(store.pendingToolInputs.isEmpty)
        #expect(store.isStreaming == false)
    }
}

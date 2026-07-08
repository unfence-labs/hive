import Observation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreDerivationTests {
    private func message(
        id: String,
        role: MessageRole,
        content: String,
        toolCalls: [ToolCall]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: id,
            sessionId: "session-1",
            role: role,
            content: content,
            images: nil,
            toolCalls: toolCalls,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )
    }

    @Test @MainActor
    func derivationsSkipNonActiveSessions() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy, sessionId: "session-1", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))
        store.handle(.status(
            status: .busy, sessionId: "session-2", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))
        let base = store.derivationRunCount

        store.handle(.toolUse(sessionId: "session-2", id: "tool-1", name: "Read", input: "{}", parentToolUseId: nil))
        store.handle(.toolResult(sessionId: "session-2", toolUseId: "tool-1", output: "ok"))
        store.handle(.agentActivity(sessionId: "session-2", activity: .commandExecution(.init(
            id: "cmd-1", command: "ls", cwd: nil, status: "completed",
            output: nil, exitCode: 0, durationMs: nil
        ))))
        store.handle(.streamSnapshot(
            sessionId: "session-2", text: "background", thinking: "",
            toolCalls: [], agentActivities: [], agentPlanMode: false, streamingStartedAt: nil
        ))
        #expect(store.derivationRunCount == base)

        store.handle(.toolUse(sessionId: "session-1", id: "tool-2", name: "Read", input: "{}", parentToolUseId: nil))
        #expect(store.derivationRunCount == base + 1)
    }

    @Test @MainActor
    func historyApplicationRecomputesExactlyOnce() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-1")
        let base = store.derivationRunCount

        store.applyFetchedHistory([
            message(id: "message-1", role: .user, content: "Hello")
        ], for: "session-1")

        #expect(store.derivationRunCount == base + 1)
        #expect(store.messages.count == 1)
    }

    @Test
    func deriveDismissedToolCallIdsHandlesEmptyHistory() {
        #expect(deriveDismissedToolCallIds(from: []).isEmpty)
    }

    @Test @MainActor
    func emptyHistoryWithStreamingStatusFromAnotherClientDoesNotTrap() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-1")

        store.handle(.status(
            status: .busy, sessionId: "session-1", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))

        #expect(store.messages.isEmpty)
        #expect(store.dismissedToolCallIds.isEmpty)
    }

    @Test @MainActor
    func detectsDismissedAskUserQuestionToolCalls() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-1")
        let history = [
            message(id: "message-1", role: .assistant, content: "Which option?", toolCalls: [
                ToolCall(id: "ask-1", name: "AskUserQuestion", input: "{}", output: nil, parentToolUseId: nil),
                ToolCall(id: "read-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)
            ]),
            message(id: "message-2", role: .user, content: "Question dismissed.")
        ]

        #expect(deriveDismissedToolCallIds(from: history) == ["ask-1"])

        store.applyFetchedHistory(history, for: "session-1")
        #expect(store.dismissedToolCallIds == ["ask-1"])
    }
}

extension ConversationStoreDerivationTests {
    @Test @MainActor
    func toolEventsDoNotRerunHistoryDerivations() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .assistant, content: "done",
                images: nil,
                toolCalls: [ToolCall(id: "t0", name: "TaskCreate", input: "{\"subject\":\"Old\"}", output: "Task #1 created", parentToolUseId: nil)],
                thinkingContent: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")
        store.handle(.status(status: .busy, sessionId: "s1", streaming: true, streamingStartedAt: nil, lockedProvider: nil))
        let base = store.historyDerivationRunCount

        store.handle(.toolUse(sessionId: "s1", id: "t1", name: "TaskCreate", input: "{\"subject\":\"New\"}", parentToolUseId: nil))
        store.handle(.toolResult(sessionId: "s1", toolUseId: "t1", output: "Task #2 created"))
        store.handle(.toolUse(sessionId: "s1", id: "t2", name: "Read", input: "{}", parentToolUseId: nil))

        #expect(store.historyDerivationRunCount == base)
        #expect(store.tasksState.tasks.map(\.subject) == ["Old", "New"])

        store.applyFetchedHistory([], for: "s1")
        #expect(store.historyDerivationRunCount == base + 1)
    }

    @Test @MainActor
    func unchangedDerivationsDoNotNotifyObservers() async {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("s1")
        store.handle(.status(status: .busy, sessionId: "s1", streaming: true, streamingStartedAt: nil, lockedProvider: nil))

        var tasksChanged = false
        withObservationTracking {
            _ = store.tasksState
        } onChange: {
            tasksChanged = true
        }

        store.handle(.toolUse(sessionId: "s1", id: "t1", name: "Read", input: "{}", parentToolUseId: nil))

        #expect(store.derivationRunCount > 0)
        #expect(!tasksChanged)
    }
}

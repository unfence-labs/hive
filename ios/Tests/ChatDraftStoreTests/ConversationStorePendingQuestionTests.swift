import Foundation
import Testing
@testable import HiveMobileStoresCore

/// #288 reopenable pending-question chip: pending questions are store-owned and
/// only cleared by answering or turn end — never by dismissing the sheet — and
/// reconcile to a single set with no duplicates.
struct ConversationStorePendingQuestionTests {
    @MainActor
    private func storeWithQuestion(session: String, requestId: String = "req-1") -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId(session)
        store.handle(.toolInputRequired(
            sessionId: session, requestId: requestId,
            toolName: "AskUserQuestion", toolUseId: "tool-1", input: "{}"
        ))
        return store
    }

    private func done(_ session: String) -> WsOutgoing {
        .done(
            sessionId: session, durationMs: 100,
            inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil, pendingToolName: nil
        )
    }

    @Test @MainActor
    func redeliveredRequestDoesNotDuplicate() {
        let store = storeWithQuestion(session: "s1")
        // Reconnect replays the same request.
        store.handle(.toolInputRequired(
            sessionId: "s1", requestId: "req-1",
            toolName: "AskUserQuestion", toolUseId: "tool-1", input: "{}"
        ))
        #expect(store.pendingToolInputs.count == 1)
    }

    @Test @MainActor
    func turnEndClearsPendingQuestions() {
        let store = storeWithQuestion(session: "s1")
        #expect(store.pendingToolInputs.count == 1)
        store.handle(done("s1"))
        #expect(store.pendingToolInputs.isEmpty)
    }

    @Test @MainActor
    func answeringClearsPendingQuestions() {
        let store = storeWithQuestion(session: "s1")
        store.clearPendingToolInputs()
        #expect(store.pendingToolInputs.isEmpty)
    }

    @Test @MainActor
    func pendingQuestionSurvivesSessionSwitch() {
        let store = storeWithQuestion(session: "s1")
        // Navigate to another session and back.
        store.setFocusedSessionId("s2")
        #expect(store.pendingToolInputs.isEmpty)
        store.setFocusedSessionId("s1")
        #expect(store.pendingToolInputs.count == 1)
    }

    @Test @MainActor
    func toolInputResolvedFromAnotherClientClears() {
        let store = storeWithQuestion(session: "s1")
        store.handle(.toolInputResolved(sessionId: "s1"))
        #expect(store.pendingToolInputs.isEmpty)
    }
}

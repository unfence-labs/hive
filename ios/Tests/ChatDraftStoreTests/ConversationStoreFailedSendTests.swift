import Foundation
import Testing
@testable import HiveMobileStoresCore

/// #287 retryable failed sends: a failed send is a store-owned error state, not
/// a synthetic assistant message. It survives history refetches and is resolved
/// only by retry-success or discard.
struct ConversationStoreFailedSendTests {
    @MainActor
    private func store(session: String) -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId(session)
        return store
    }

    private func messageFailure(session: String, content: String) -> FailedSend {
        FailedSend(
            id: "failed-1",
            sessionId: session,
            content: content,
            reason: "Disconnected from server",
            retry: .message(content: content, images: nil, options: nil)
        )
    }

    @Test @MainActor
    func recordingCreatesErrorStateWithoutSyntheticMessage() {
        let store = store(session: "s1")
        store.recordFailedSend(messageFailure(session: "s1", content: "hello agent"))

        #expect(store.failedSend?.content == "hello agent")
        #expect(store.messages.isEmpty)
    }

    @Test @MainActor
    func retrySuccessClearsState() async {
        let store = store(session: "s1")
        store.send = { _ in true }
        store.recordFailedSend(messageFailure(session: "s1", content: "hi"))

        let resolved = await store.retryFailedSend(for: "s1")

        #expect(resolved)
        #expect(store.failedSend == nil)
    }

    @Test @MainActor
    func retryFailurePreservesState() async {
        let store = store(session: "s1")
        store.send = { _ in false }
        store.recordFailedSend(messageFailure(session: "s1", content: "hi"))

        let resolved = await store.retryFailedSend(for: "s1")

        #expect(!resolved)
        #expect(store.failedSend?.content == "hi")
    }

    @Test @MainActor
    func failedSendSurvivesHistoryRefetch() {
        let store = store(session: "s1")
        store.recordFailedSend(messageFailure(session: "s1", content: "keep me"))

        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "earlier",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: ConversationStore.timestamp(), cancelled: nil, durationMs: nil
            )
        ], for: "s1")

        #expect(store.failedSend?.content == "keep me")
        #expect(store.messages.count == 1)
    }

    @Test @MainActor
    func discardRemovesState() {
        let store = store(session: "s1")
        store.recordFailedSend(messageFailure(session: "s1", content: "bye"))

        store.discardFailedSend(for: "s1")

        #expect(store.failedSend == nil)
    }

    @Test @MainActor
    func toolInputFailureRetryRepresentsQuestion() async {
        let store = store(session: "s1")
        let pending = PendingToolInput(
            sessionId: "s1", requestId: "req-1", toolName: "AskUserQuestion",
            toolUseId: "tu-1", input: "{}"
        )
        store.recordFailedSend(FailedSend(
            id: "failed-tool", sessionId: "s1",
            content: "Answer to the agent's question",
            reason: "Disconnected from server",
            retry: .toolInput(pending)
        ))

        let resolved = await store.retryFailedSend(for: "s1")

        #expect(resolved)
        #expect(store.failedSend == nil)
        #expect(store.pendingToolInputs.contains(pending))
    }
}

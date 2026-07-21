import Foundation
import Testing
@testable import HiveMobileStoresCore

/// #287 + optimistic sends: a user message appears in the transcript the moment
/// it is sent, the server echo confirms it (no duplicate), and a failed send is
/// kept on the bubble with retry/discard — the text is never lost. Failed
/// tool-input answers stay a store-owned error state that re-presents the
/// question on retry.
struct ConversationStoreFailedSendTests {
    @MainActor
    private func store(session: String) -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId(session)
        return store
    }

    private func serverEcho(_ content: String, session: String) -> WsOutgoing {
        .userMessage(message: ChatMessage(
            id: "srv-1", sessionId: session, role: .user, content: content,
            images: nil, toolCalls: nil,
            timestamp: "2026-07-08T10:00:00.000Z", cancelled: nil, durationMs: nil
        ))
    }

    @Test @MainActor
    func optimisticMessageAppearsImmediately() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "hello", images: nil, options: nil, sessionId: "s1"
        )

        #expect(store.messages.count == 1)
        #expect(store.messages[0].content == "hello")
        #expect(store.sendState(for: localId) == .sending)
    }

    @Test @MainActor
    func serverEchoConfirmsWithoutDuplicate() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "hello", images: nil, options: nil, sessionId: "s1"
        )

        store.handle(serverEcho("hello", session: "s1"))

        #expect(store.messages.count == 1)
        #expect(store.messages[0].id == "srv-1")
        #expect(store.sendState(for: localId) == nil)
        #expect(store.sendState(for: "srv-1") == nil)
    }

    @Test @MainActor
    func failedSendKeepsMessageWithFailedState() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "keep me", images: nil, options: nil, sessionId: "s1"
        )

        store.markSendFailed(localId)

        #expect(store.messages.count == 1)
        #expect(store.sendState(for: localId) == .failed)
    }

    @Test @MainActor
    func failedMessageSurvivesHistoryRefetch() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "keep me", images: nil, options: nil, sessionId: "s1"
        )
        store.markSendFailed(localId)

        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "earlier",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")

        #expect(store.messages.count == 2)
        #expect(store.messages.last?.content == "keep me")
        #expect(store.sendState(for: localId) == .failed)
    }

    @Test @MainActor
    func refetchContainingTheMessageResolvesPendingSend() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "made it", images: nil, options: nil, sessionId: "s1"
        )

        store.applyFetchedHistory([
            ChatMessage(
                id: "srv-9", sessionId: "s1", role: .user, content: "made it",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")

        #expect(store.messages.count == 1)
        #expect(store.messages[0].id == "srv-9")
        #expect(store.sendState(for: localId) == nil)
    }

    @Test @MainActor
    func oldIdenticalMessageDoesNotConfirmInFlightSend() {
        let store = store(session: "s1")
        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "ok",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "ok", images: nil, options: nil, sessionId: "s1"
        )

        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "ok",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")

        #expect(store.messages.count == 2)
        #expect(store.messages.last?.id == localId)
        #expect(store.sendState(for: localId) == .sending)
    }

    @Test @MainActor
    func newIdenticalMessageConfirmsInFlightSend() {
        let store = store(session: "s1")
        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "ok",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "ok", images: nil, options: nil, sessionId: "s1"
        )

        store.applyFetchedHistory([
            ChatMessage(
                id: "m1", sessionId: "s1", role: .user, content: "ok",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T09:00:00.000Z", cancelled: nil, durationMs: nil
            ),
            ChatMessage(
                id: "srv-2", sessionId: "s1", role: .user, content: "ok",
                images: nil, toolCalls: nil,
                timestamp: "2026-07-08T10:00:00.000Z", cancelled: nil, durationMs: nil
            )
        ], for: "s1")

        #expect(store.messages.count == 2)
        #expect(store.messages.map(\.id) == ["m1", "srv-2"])
        #expect(store.sendState(for: localId) == nil)
    }

    @Test @MainActor
    func retrySuccessGoesBackToSendingThenEchoResolves() async {
        let store = store(session: "s1")
        store.send = { _ in true }
        let localId = store.appendOptimisticUserMessage(
            content: "again", images: nil, options: nil, sessionId: "s1"
        )
        store.markSendFailed(localId)

        let sent = await store.retryOptimisticSend(localId)

        #expect(sent)
        #expect(store.sendState(for: localId) == .sending)
        store.handle(serverEcho("again", session: "s1"))
        #expect(store.messages.count == 1)
        #expect(store.sendState(for: localId) == nil)
    }

    @Test @MainActor
    func retryFailureKeepsFailedState() async {
        let store = store(session: "s1")
        store.send = { _ in false }
        let localId = store.appendOptimisticUserMessage(
            content: "again", images: nil, options: nil, sessionId: "s1"
        )
        store.markSendFailed(localId)

        let sent = await store.retryOptimisticSend(localId)

        #expect(!sent)
        #expect(store.sendState(for: localId) == .failed)
        #expect(store.messages.count == 1)
    }

    @Test @MainActor
    func discardRemovesTheMessage() {
        let store = store(session: "s1")
        let localId = store.appendOptimisticUserMessage(
            content: "bye", images: nil, options: nil, sessionId: "s1"
        )
        store.markSendFailed(localId)

        store.discardOptimisticSend(localId)

        #expect(store.messages.isEmpty)
        #expect(store.sendState(for: localId) == nil)
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
            pending: pending
        ))
        #expect(store.failedSend != nil)

        let resolved = await store.retryFailedSend(for: "s1")

        #expect(resolved)
        #expect(store.failedSend == nil)
        #expect(store.pendingToolInputs.contains(pending))
    }

    @Test @MainActor
    func toolInputFailureSurvivesHistoryRefetch() {
        let store = store(session: "s1")
        let pending = PendingToolInput(
            sessionId: "s1", requestId: "req-1", toolName: "AskUserQuestion",
            toolUseId: "tu-1", input: "{}"
        )
        store.recordFailedSend(FailedSend(
            id: "failed-tool", sessionId: "s1",
            content: "Answer to the agent's question",
            reason: "Disconnected from server",
            pending: pending
        ))

        store.applyFetchedHistory([], for: "s1")

        #expect(store.failedSend?.id == "failed-tool")
    }
}

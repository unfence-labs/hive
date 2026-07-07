import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Drives the turn-completion haptic: the store must expose an observable
/// completion transition that bumps only when the completing session's chat is
/// the visible screen. These assert that external behaviour, not the haptic.
struct ConversationStoreCompletionHapticTests {
    @MainActor
    private func streamingStore(session: String, visible: Bool) -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId(session)
        store.applyFetchedHistory([], for: session)
        store.isChatVisible = visible
        store.handle(.status(
            status: .busy,
            sessionId: session,
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: session, text: "Answer"))
        return store
    }

    private func done(_ session: String) -> WsOutgoing {
        .done(
            sessionId: session,
            durationMs: 100,
            inputTokens: nil,
            outputTokens: nil,
            contextUsedTokens: nil,
            contextWindowTokens: nil,
            pendingToolName: nil
        )
    }

    @Test @MainActor
    func completionWhileViewingChatBumpsCounter() {
        let store = streamingStore(session: "session-A", visible: true)
        store.handle(done("session-A"))
        #expect(store.visibleCompletionCount == 1)
    }

    @Test @MainActor
    func completionWhileChatNotVisibleDoesNotBump() {
        let store = streamingStore(session: "session-A", visible: false)
        store.handle(done("session-A"))
        #expect(store.visibleCompletionCount == 0)
    }

    @Test @MainActor
    func backgroundSessionCompletionDoesNotBump() {
        let store = streamingStore(session: "session-A", visible: true)
        // A second session streams in the background while A stays focused.
        store.handle(.status(
            status: .busy,
            sessionId: "session-B",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-B", text: "Background"))
        store.handle(done("session-B"))
        #expect(store.visibleCompletionCount == 0)
    }

    @Test @MainActor
    func cancelledTurnDoesNotBump() {
        let store = streamingStore(session: "session-A", visible: true)
        store.handle(.cancelled(
            sessionId: "session-A",
            errorDetail: nil,
            userInitiated: true,
            durationMs: 100
        ))
        #expect(store.visibleCompletionCount == 0)
    }

    @Test @MainActor
    func successiveVisibleCompletionsAccumulate() {
        let store = streamingStore(session: "session-A", visible: true)
        store.handle(done("session-A"))

        store.handle(.status(
            status: .busy,
            sessionId: "session-A",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-A", text: "Second answer"))
        store.handle(done("session-A"))

        #expect(store.visibleCompletionCount == 2)
    }
}

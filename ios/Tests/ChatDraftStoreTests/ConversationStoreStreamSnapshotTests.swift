import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Tests for the PRD #254 live/history split on iOS: the consolidated
/// `stream_snapshot` is applied with REPLACE semantics (idempotent on
/// re-focus/reconnect), and `done`/`cancelled` finalize using the
/// server-persisted message id so the next REST fetch dedups by id.
struct ConversationStoreStreamSnapshotTests {
    private func toolCall(_ id: String, output: String? = nil) -> ToolCall {
        ToolCall(id: id, name: "Read", input: "{}", output: output, parentToolUseId: nil)
    }

    private func activity(_ id: String) -> AgentActivity {
        .commandExecution(.init(
            id: id, command: "swift test", cwd: nil, status: "completed",
            output: "ok", exitCode: 0, durationMs: 12
        ))
    }

    // MARK: - stream_snapshot REPLACE semantics

    @Test @MainActor
    func streamSnapshotReplacesAccumulators() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "partial answer",
            thinking: "reasoning",
            toolCalls: [toolCall("tool-1", output: "done")],
            agentActivities: [activity("cmd-1")],
            planMode: true,
            streamingStartedAt: 1_700_000_000_000
        ))

        #expect(store.isStreaming == true)
        #expect(store.currentText == "partial answer")
        #expect(store.currentThinking == "reasoning")
        #expect(store.activeToolCalls.map(\.id) == ["tool-1"])
        #expect(store.activeAgentActivities.map(\.id) == ["cmd-1"])
        #expect(store.agentPlanMode == true)
        #expect(store.streamingStartedAt != nil)
    }

    @Test @MainActor
    func streamSnapshotIsIdempotentOnReapply() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        let snapshot: WsOutgoing = .streamSnapshot(
            sessionId: "session-1",
            text: "hello world",
            thinking: "",
            toolCalls: [toolCall("tool-1", output: "a"), toolCall("tool-2", output: "b")],
            agentActivities: [activity("cmd-1")],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        )

        // Applying the same snapshot twice (e.g. reconnect re-pull) must REPLACE,
        // never append — no duplicate text or tool calls.
        store.handle(snapshot)
        store.handle(snapshot)

        #expect(store.currentText == "hello world")
        #expect(store.activeToolCalls.map(\.id) == ["tool-1", "tool-2"])
        #expect(store.activeAgentActivities.map(\.id) == ["cmd-1"])
    }

    @Test @MainActor
    func liveDeltasAppendAfterSnapshot() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "caught up so far",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))
        store.handle(.textDelta(sessionId: "session-1", text: " and more"))

        #expect(store.currentText == "caught up so far and more")
    }

    @Test @MainActor
    func snapshotForBackgroundSessionDoesNotAdoptFocus() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-active")

        store.handle(.streamSnapshot(
            sessionId: "session-bg",
            text: "background work",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        // Focus is unchanged; the background slot still accumulated.
        #expect(store.sessionId == "session-active")
        #expect(store.sessionStreams["session-bg"]?.currentText == "background work")
        #expect(store.currentText == "")
    }

    // MARK: - Finalization dedup by server message id

    @Test @MainActor
    func doneFinalizesWithServerMessageId() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "the answer",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        store.handle(.done(
            sessionId: "session-1",
            messageId: "server-msg-1",
            durationMs: 100,
            inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil,
            pendingToolName: nil
        ))

        // The finalized bubble carries the SERVER id (not a random UUID), so the
        // next REST history fetch dedups against it.
        #expect(store.messages.count == 1)
        #expect(store.messages.first?.id == "server-msg-1")
        #expect(store.messages.first?.content == "the answer")
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @Test @MainActor
    func restFetchAfterDoneDoesNotDuplicateById() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "streamed reply",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))
        store.handle(.done(
            sessionId: "session-1",
            messageId: "server-msg-1",
            durationMs: 100,
            inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil,
            pendingToolName: nil
        ))
        #expect(store.messages.count == 1)

        // REST history returns the authoritative copy with the SAME id; applying
        // the page replaces the window, so there is exactly one message.
        let page = MessagesPage(messages: [
            ChatMessage(
                id: "server-msg-1", sessionId: "session-1", role: .assistant,
                content: "streamed reply", images: nil, toolCalls: nil,
                thinkingContent: nil, timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil, durationMs: 100
            )
        ], hasMore: false)
        store.applyMessagesPage(page)

        #expect(store.messages.count == 1)
        #expect(store.messages.first?.id == "server-msg-1")
        #expect(store.hasMoreEarlier == false)
    }

    @Test @MainActor
    func doneSkipsWhenServerMessageAlreadyPresent() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        // Simulate REST landing first: the authoritative message is already in
        // the list before `done` fires for the same turn.
        store.messages = [
            ChatMessage(
                id: "server-msg-1", sessionId: "session-1", role: .assistant,
                content: "already here", images: nil, toolCalls: nil,
                thinkingContent: nil, timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil, durationMs: 100
            )
        ]
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "already here",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        store.handle(.done(
            sessionId: "session-1",
            messageId: "server-msg-1",
            durationMs: 100,
            inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil,
            pendingToolName: nil
        ))

        // No duplicate appended — dedup by server id.
        #expect(store.messages.count == 1)
        #expect(store.messages.first?.id == "server-msg-1")
    }

    @Test @MainActor
    func emptyDoneTurnProducesNoBubble() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        // Stream slot exists but accumulated no displayable content.
        store.handle(.status(
            status: .busy, sessionId: "session-1",
            streaming: true, streamingStartedAt: nil, lockedProvider: nil
        ))

        store.handle(.done(
            sessionId: "session-1",
            messageId: "server-empty-1",
            durationMs: 10,
            inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil,
            pendingToolName: nil
        ))

        // The empty-turn edge: no empty bubble materializes.
        #expect(store.messages.isEmpty)
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @Test @MainActor
    func cancelledWithMessageIdStampsServerId() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "partial before stop",
            thinking: "",
            toolCalls: [],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        store.handle(.cancelled(
            sessionId: "session-1",
            messageId: "server-cancel-1",
            errorDetail: nil,
            userInitiated: true,
            durationMs: 50
        ))

        #expect(store.messages.count == 1)
        #expect(store.messages.first?.id == "server-cancel-1")
        #expect(store.messages.first?.cancelled == true)
        #expect(store.messages.first?.content == "partial before stop")
    }

    // MARK: - Load earlier (pagination)

    @Test @MainActor
    func applyMessagesPageRecordsHasMore() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        let page = MessagesPage(messages: [
            ChatMessage(
                id: "m2", sessionId: "session-1", role: .user, content: "second",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:02.000Z", cancelled: nil, durationMs: nil
            )
        ], hasMore: true)

        store.applyMessagesPage(page)

        #expect(store.messages.map(\.id) == ["m2"])
        #expect(store.hasMoreEarlier == true)
    }

    @Test @MainActor
    func prependEarlierInsertsOlderMessagesAndUpdatesHasMore() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.applyMessagesPage(MessagesPage(messages: [
            ChatMessage(
                id: "m3", sessionId: "session-1", role: .user, content: "third",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:03.000Z", cancelled: nil, durationMs: nil
            )
        ], hasMore: true))

        // Older page fetched via ?before=m3.
        store.prependEarlier(MessagesPage(messages: [
            ChatMessage(
                id: "m1", sessionId: "session-1", role: .user, content: "first",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:01.000Z", cancelled: nil, durationMs: nil
            ),
            ChatMessage(
                id: "m2", sessionId: "session-1", role: .user, content: "second",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:02.000Z", cancelled: nil, durationMs: nil
            )
        ], hasMore: false))

        // Older messages are prepended in order, ahead of the existing window.
        #expect(store.messages.map(\.id) == ["m1", "m2", "m3"])
        // No more older messages remain.
        #expect(store.hasMoreEarlier == false)
    }

    @Test @MainActor
    func prependEarlierDedupsOverlappingIds() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.applyMessagesPage(MessagesPage(messages: [
            ChatMessage(
                id: "m2", sessionId: "session-1", role: .user, content: "second",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:02.000Z", cancelled: nil, durationMs: nil
            )
        ], hasMore: true))

        // The older page overlaps on m2 (e.g. a turn finished between fetches).
        store.prependEarlier(MessagesPage(messages: [
            ChatMessage(
                id: "m1", sessionId: "session-1", role: .user, content: "first",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:01.000Z", cancelled: nil, durationMs: nil
            ),
            ChatMessage(
                id: "m2", sessionId: "session-1", role: .user, content: "second",
                images: nil, toolCalls: nil, thinkingContent: nil,
                timestamp: "2026-01-01T00:00:02.000Z", cancelled: nil, durationMs: nil
            )
        ], hasMore: false))

        // m2 is not duplicated.
        #expect(store.messages.map(\.id) == ["m1", "m2"])
    }

    @Test @MainActor
    func cancelledWithoutMessageIdStillShowsStoppedBubble() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        // An empty turn that is stopped: no server id, but a "Stopped" bubble is
        // still useful, so a local id is used (content is empty).
        store.handle(.status(
            status: .busy, sessionId: "session-1",
            streaming: true, streamingStartedAt: nil, lockedProvider: nil
        ))

        store.handle(.cancelled(
            sessionId: "session-1",
            messageId: nil,
            errorDetail: "stopped",
            userInitiated: true,
            durationMs: 50
        ))

        #expect(store.messages.count == 1)
        #expect(store.messages.first?.cancelled == true)
        #expect(store.messages.first?.content == "")
    }
}

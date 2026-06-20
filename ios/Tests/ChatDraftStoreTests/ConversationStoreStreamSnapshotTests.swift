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

    private func message(
        _ id: String, role: MessageRole, content: String = "",
        sessionId: String = "session-1", toolCalls: [ToolCall]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: id, sessionId: sessionId, role: role, content: content,
            images: nil, toolCalls: toolCalls, thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00.000Z", cancelled: nil, durationMs: nil
        )
    }

    private func askUserQuestionTool(_ id: String) -> ToolCall {
        ToolCall(id: id, name: "AskUserQuestion", input: "{\"question\":\"pick one\"}",
                 output: nil, parentToolUseId: nil)
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

    // MARK: - applyMessagesPage derives pending tool inputs (Finding #3)

    @Test @MainActor
    func applyMessagesPageDerivesPendingFromUnansweredQuestion() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        // REST history whose last assistant turn parked on an AskUserQuestion
        // with no user message after it: opening this session must surface the
        // answer sheet, so a pending tool input is derived (PRD #254 Finding #3).
        let page = MessagesPage(messages: [
            message("u1", role: .user, content: "do the thing"),
            message("a1", role: .assistant, content: "I need input",
                    toolCalls: [askUserQuestionTool("tool-ask-1")])
        ], hasMore: false)

        store.applyMessagesPage(page)

        #expect(store.pendingToolInputs.count == 1)
        #expect(store.pendingToolInputs.first?.toolName == "AskUserQuestion")
        #expect(store.pendingToolInputs.first?.toolUseId == "tool-ask-1")
    }

    @Test @MainActor
    func applyMessagesPageDerivesNoPendingWhenUserAnswered() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        // A user message AFTER the question means it was already answered — no
        // pending input should be derived.
        let page = MessagesPage(messages: [
            message("a1", role: .assistant, content: "I need input",
                    toolCalls: [askUserQuestionTool("tool-ask-1")]),
            message("u1", role: .user, content: "here is my answer")
        ], hasMore: false)

        store.applyMessagesPage(page)

        #expect(store.pendingToolInputs.isEmpty)
    }

    @Test @MainActor
    func applyMessagesPageSkipsDerivationWhileStreaming() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        // The focused session is actively streaming: live WS tool inputs win, so
        // history derivation is skipped (mirrors web's set_history behavior).
        store.handle(.status(
            status: .busy, sessionId: "session-1",
            streaming: true, streamingStartedAt: nil, lockedProvider: nil
        ))

        let page = MessagesPage(messages: [
            message("a1", role: .assistant, content: "I need input",
                    toolCalls: [askUserQuestionTool("tool-ask-1")])
        ], hasMore: false)

        store.applyMessagesPage(page)

        #expect(store.pendingToolInputs.isEmpty)
    }

    // MARK: - stream_snapshot computes output scalars (Finding #5)

    @Test @MainActor
    func streamSnapshotComputesScalarsForToolWithOutput() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        let output = "line one\nline two\nline three"
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "running tools",
            thinking: "",
            toolCalls: [toolCall("tool-1", output: output)],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        // A snapshot tool that already completed carries a full output, so the
        // store computes the same scalars `tool_result` would (PRD #254 #5):
        // body preserved (small => untruncated), preview == body, exact line/byte
        // counts present.
        let tool = store.activeToolCalls.first
        #expect(tool?.output == output)
        #expect(tool?.outputPreview == output)
        #expect(tool?.outputLineCount == 3)
        #expect(tool?.outputByteLength == output.utf8.count)
        #expect(tool?.outputTruncated == false)
    }

    @Test @MainActor
    func streamSnapshotComputesZeroScalarsForToolWithEmptyOutput() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        // A completed tool whose output is "" must get the SAME zero scalars the
        // `tool_result` path computes — not be treated as still-running and left
        // with nil scalars (PRD #254 #5 audit follow-up).
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "running tools",
            thinking: "",
            toolCalls: [toolCall("tool-empty", output: "")],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        let tool = store.activeToolCalls.first
        #expect(tool?.output == "")
        #expect(tool?.outputPreview == "")
        #expect(tool?.outputLineCount == 0)
        #expect(tool?.outputByteLength == 0)
        #expect(tool?.outputTruncated == false)
    }

    @Test @MainActor
    func streamSnapshotLeavesRunningToolWithoutOutputUntouched() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        // A tool still running in the snapshot has no output — it must pass
        // through with nil scalars (nothing to compute yet).
        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "",
            thinking: "",
            toolCalls: [toolCall("tool-running")],
            agentActivities: [],
            planMode: false,
            streamingStartedAt: 1_700_000_000_000
        ))

        let tool = store.activeToolCalls.first
        #expect(tool?.output == nil)
        #expect(tool?.outputPreview == nil)
        #expect(tool?.outputLineCount == nil)
        #expect(tool?.outputByteLength == nil)
        #expect(tool?.outputTruncated == nil)
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

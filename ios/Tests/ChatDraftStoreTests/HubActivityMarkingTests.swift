import Testing
@testable import HiveMobileStoresCore

struct HubActivityMarkingTests {
    private var sampleMessage: ChatMessage {
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
    }

    @Test
    func perTokenAndSidebandEventsAreIgnored() {
        #expect(hubActivityMarking(for: .textDelta(sessionId: "s", text: "x")) == .ignore)
        #expect(hubActivityMarking(for: .thinking(sessionId: "s", text: "x")) == .ignore)
        #expect(hubActivityMarking(for: .branchInfo(info: BranchInfo(
            name: "main", lastSyncedAt: "2026-01-01T00:00:00.000Z"
        ))) == .ignore)
        #expect(hubActivityMarking(for: .diffStats(stats: DiffStatResponse(
            committed: [], uncommitted: []
        ))) == .ignore)
        #expect(hubActivityMarking(for: .prStatus(status: PrStatusResponse(pr: nil, error: nil))) == .ignore)
        #expect(hubActivityMarking(for: .scriptStatus(scriptType: "setup", state: "running", exitCode: nil)) == .ignore)
        #expect(hubActivityMarking(for: .planModeChanged(sessionId: "s", active: true)) == .ignore)
        #expect(hubActivityMarking(for: .streamSnapshot(
            sessionId: "s", text: "", thinking: "", toolCalls: [],
            agentActivities: [], agentPlanMode: false, streamingStartedAt: nil
        )) == .ignore)
    }

    @Test
    func historyMarksLatestMessageTimestamp() {
        #expect(hubActivityMarking(for: .history(messages: [sampleMessage], sessionId: "s"))
            == .markLatestMessageTimestamp)
    }

    @Test
    func statusMarksOnlyIfStreaming() {
        #expect(hubActivityMarking(for: .status(
            status: .busy, sessionId: "s", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        )) == .markIfStreaming)
        #expect(hubActivityMarking(for: .status(
            status: .idle, sessionId: "s", streaming: false,
            streamingStartedAt: nil, lockedProvider: nil
        )) == .markIfStreaming)
    }

    @Test
    func remainingEventsMarkNow() {
        #expect(hubActivityMarking(for: .toolUse(
            sessionId: "s", id: "t", name: "Read", input: "{}", parentToolUseId: nil
        )) == .markNow)
        #expect(hubActivityMarking(for: .toolResult(sessionId: "s", toolUseId: "t", output: "ok")) == .markNow)
        #expect(hubActivityMarking(for: .agentActivity(
            sessionId: "s",
            activity: .planUpdate(.init(id: "plan-1", steps: []))
        )) == .markNow)
        #expect(hubActivityMarking(for: .toolInputRequired(
            sessionId: "s", requestId: "r", toolName: "AskUserQuestion", toolUseId: "t", input: "{}"
        )) == .markNow)
        #expect(hubActivityMarking(for: .toolInputResolved(sessionId: "s")) == .markNow)
        #expect(hubActivityMarking(for: .done(
            sessionId: "s", durationMs: nil, inputTokens: nil, outputTokens: nil,
            contextUsedTokens: nil, contextWindowTokens: nil, pendingToolName: nil
        )) == .markNow)
        #expect(hubActivityMarking(for: .error(message: "boom", sessionId: nil)) == .markNow)
        #expect(hubActivityMarking(for: .cancelled(
            sessionId: "s", errorDetail: nil, userInitiated: nil, durationMs: nil
        )) == .markNow)
        #expect(hubActivityMarking(for: .userMessage(message: sampleMessage)) == .markNow)
        #expect(hubActivityMarking(for: .unknown(type: "future_event")) == .markNow)
    }
}

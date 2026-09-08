import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationTimelineTests {
    @Test @MainActor
    func bufferedTextKeepsItsBlockAroundToolsAndFinalizesWithStableIdentity() throws {
        let store = makeStore()
        let first = ConversationTimelineEntry(type: .text, id: "before", text: "")
        store.handle(.timelineEntry(sessionId: "s", entry: first, messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "Checking.", blockId: "before"))
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .tool, id: "tool"), messageId: "turn"))
        store.handle(.toolUse(sessionId: "s", id: "tool", name: "Read", input: "{}", parentToolUseId: nil))
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .text, id: "after", text: ""), messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "Done.", blockId: "after"))
        // Duplicate entry notifications must not erase buffered text or move the block.
        store.handle(.timelineEntry(sessionId: "s", entry: first, messageId: "turn"))
        store.flushStreamingDeltas()
        #expect(store.timeline?.map(\.id) == ["before", "tool", "after"])
        #expect(store.timeline?.map(\.text) == ["Checking.", nil, "Done."])
        #expect(store.currentText == "Checking.Done.")
        store.handle(.done(sessionId: "s", durationMs: 10, inputTokens: nil,
                           outputTokens: nil, contextUsedTokens: nil, contextWindowTokens: nil,
                           pendingToolName: nil))
        let message = try #require(store.messages.last)
        #expect(message.id == "turn")
        #expect(message.timeline?.map(\.id) == ["before", "tool", "after"])
        let restored = try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(message))
        #expect(restored.timeline == message.timeline)
    }

    @Test @MainActor
    func snapshotReplacesPendingTextAndLegacySnapshotRetainsLegacyRendering() {
        let store = makeStore()
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .text, id: "text", text: ""), messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "stale", blockId: "text"))
        store.handle(.streamSnapshot(
            sessionId: "s", text: "fresh", toolCalls: [], agentActivities: [],
            agentPlanMode: false, streamingStartedAt: nil,
            timeline: [.init(type: .text, id: "text", text: "fresh")], messageId: "turn"
        ))
        store.handle(.textDelta(sessionId: "s", text: "!", blockId: "text"))
        store.flushStreamingDeltas()
        #expect(store.currentText == "fresh!")
        #expect(store.timeline?.first?.text == "fresh!")
        #expect(store.streamingMessageId == "turn")
        store.handle(.streamSnapshot(sessionId: "s", text: "legacy", toolCalls: [], agentActivities: [],
                                     agentPlanMode: false, streamingStartedAt: nil))
        #expect(store.timeline == nil)
        #expect(store.streamingMessageId == nil)
        #expect(store.currentText == "legacy")
    }

    @Test @MainActor
    func toolUpdatesPreserveFailureAndDoNotDuplicateTimelineOrChildren() {
        let store = makeStore()
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .tool, id: "tool"), messageId: "turn"))
        store.handle(.toolUse(sessionId: "s", id: "tool", name: "Bash", input: "{}", parentToolUseId: nil))
        store.handle(.toolResult(sessionId: "s", toolUseId: "tool", output: "failed", isError: true))
        store.handle(.toolUse(sessionId: "s", id: "tool", name: "Bash", input: #"{"command":"test"}"#, parentToolUseId: nil))
        #expect(store.activeToolCalls.count == 1)
        #expect(store.activeToolCalls.first?.isError == true)
        #expect(store.activeToolCalls.first?.output == "failed")
        #expect(store.timeline?.count == 1)
    }

    @Test
    func groupsOnlyConsecutiveActionsAndKeepsChildToolsUnderTheirParent() {
        let timeline: [ConversationTimelineEntry] = [
            .init(type: .text, id: "intro", text: "Start"),
            .init(type: .tool, id: "a"), .init(type: .tool, id: "b"),
            .init(type: .reasoning, id: "r"), .init(type: .tool, id: "c"),
            .init(type: .tool, id: "question"), .init(type: .tool, id: "d"),
            .init(type: .activity, id: "warning"), .init(type: .tool, id: "parent"),
            .init(type: .tool, id: "child"), .init(type: .text, id: "end", text: "Done")
        ]
        let tools = ["a", "b", "c", "d", "parent"].map { tool($0) } + [
            tool("question", name: "AskUserQuestion"), tool("child", parent: "parent")
        ]
        let warning = AgentActivity.diagnostic(.init(id: "warning", severity: .warning, title: "Warning",
                                                       message: "Check this", source: nil, method: nil, details: nil))
        let message = makeMessage(timeline: timeline, tools: tools, activities: [warning])
        #expect(message.timelineGroups.map(\.id) == ["text:intro", "tool:a", "reasoning:r", "tool:c", "tool:question", "tool:d", "activity:warning", "tool:parent", "text:end"])
        #expect(message.timelineGroups[1].entries.map(\.id) == ["a", "b"])
        #expect(message.timelineGroups[4].isActionGroup == false)
        #expect(message.timelineGroups.flatMap(\.entries).contains(where: { $0.id == "child" }) == false)
        #expect(message.toolCalls?.contains(where: { $0.id == "child" }) == true)
    }

    @Test
    func actionSummaryShowsRunningActionAndFailuresWithoutOpening() {
        let failed = ToolCall(id: "fail", name: "Bash", input: "{}", output: "bad", parentToolUseId: nil, isError: true)
        let running = tool("run", name: "Read")
        let summary = ConversationTimelineActionSummary(tools: [failed, running], streaming: true)
        #expect(summary.count == 2)
        #expect(summary.failedCount == 1)
        #expect(summary.runningToolName == "Read")
        let finished = ConversationTimelineActionSummary(tools: [failed, running], streaming: false)
        #expect(finished.runningToolName == nil)
        #expect(finished.failedCount == 1)
    }

    @Test
    func disclosureChoiceSurvivesMessageReplacementAndGroupGrowth() {
        let expansion = ConversationTimelineExpansion()
        let first = makeMessage(timeline: [.init(type: .tool, id: "a")], tools: [tool("a")])
        let replacement = makeMessage(timeline: [.init(type: .tool, id: "a"), .init(type: .tool, id: "b")],
                                  tools: [tool("a"), tool("b")])
        let key = first.timelineGroups[0].id
        expansion.toggle(key)
        #expect(expansion.contains(replacement.timelineGroups[0].id))
        expansion.toggle(key)
        #expect(!expansion.contains(key))
        #expect(makeMessage(timeline: nil, tools: [tool("legacy")]).timeline == nil)
        #expect(makeMessage(timeline: [], tools: []).timeline == [])
    }

    @Test
    func decodesTimelineNotificationsAndSnapshotIdentity() throws {
        let event = try JSONDecoder().decode(WsOutgoing.self, from: Data(#"{"type":"timeline_entry","sessionId":"s","messageId":"turn","entry":{"type":"text","id":"a","text":""}}"#.utf8))
        guard case .timelineEntry(let sid, let entry, let messageId) = event else {
            Issue.record("Expected timeline entry")
            return
        }
        #expect(sid == "s")
        #expect(entry == .init(type: .text, id: "a", text: ""))
        #expect(messageId == "turn")
        #expect(hubActivityMarking(for: event) == .ignore)
    }

    @Test @MainActor
    func overlappingProviderIdsStayDistinctAcrossEntryTypes() {
        let store = makeStore()
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .tool, id: "shared"), messageId: "turn"))
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .text, id: "shared", text: ""), messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "Text", blockId: "shared"))
        store.flushStreamingDeltas()
        #expect(store.timeline?.count == 2)
        #expect(store.timeline?.first?.text == nil)
        #expect(store.timeline?.last?.text == "Text")
    }

    @Test
    func highlightsUseEachTextBlocksRenderedOffsets() throws {
        let message = makeMessage(timeline: [
            .init(type: .text, id: "a", text: "First"),
            .init(type: .tool, id: "tool"),
            .init(type: .text, id: "b", text: "Second")
        ], tools: [tool("tool")])
        #expect(message.timelineSearchableText == "First\nSecond")
        let highlight = MessageFindHighlight(ranges: [6..<12], activeOrdinal: 0)
        #expect(message.timelineHighlight(for: "a", highlight: highlight) == nil)
        let second = try #require(message.timelineHighlight(for: "b", highlight: highlight))
        #expect(second.ranges == [0..<6])
        #expect(second.activeOrdinal == 0)
    }

    @Test
    func collapsedParentSummaryIncludesChildFailures() {
        let child = ToolCall(id: "child", name: "Bash", input: "{}", output: "failed",
                             parentToolUseId: "parent", isError: true)
        let parent = tool("parent", name: "Agent")
        let summary = ConversationTimelineActionSummary(tools: [parent], streaming: false, allTools: [parent, child])
        #expect(summary.count == 1)
        #expect(summary.failedCount == 1)
        #expect(summary.completed == false)
    }

    @Test
    func mixedActionGroupCountsFileChangeOnceAndKeepsCollaborationInOrder() throws {
        let files = AgentActivity.fileChange(.init(id: "edit", status: "completed", files: [
            .init(path: "a.swift", diff: "a", kind: "update", status: "completed"),
            .init(path: "b.swift", diff: "b", kind: "update", status: "failed")
        ]))
        let collaboration = AgentActivity.subagentActivity(.init(
            id: "agent", activityKind: .interrupted, agentThreadId: "child", agentPath: "/root/child"
        ))
        let message = makeMessage(timeline: [
            .init(type: .tool, id: "read"), .init(type: .activity, id: "agent"),
            .init(type: .activity, id: "edit")
        ], tools: [tool("read")], activities: [collaboration, files])
        let group = try #require(message.timelineGroups.first)
        #expect(message.timelineGroups.count == 1)
        #expect(group.entries.map(\.id) == ["read", "agent", "edit"])
        let summary = ConversationTimelineActionSummary(message: message, group: group, streaming: false)
        #expect(summary.count == 3)
        #expect(summary.failedCount == 1)
        #expect(message.timelineTools(for: group.entries[2]).count == 2)
    }

    @Test @MainActor
    func idleStatusKeepsTimelineUntilRestHistoryReplacesIt() {
        let store = makeStore()
        let entry = ConversationTimelineEntry(type: .text, id: "text", text: "")
        store.handle(.timelineEntry(sessionId: "s", entry: entry, messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "Done", blockId: "text"))
        store.handle(.status(status: .idle, sessionId: "s", streaming: false, streamingStartedAt: nil, lockedProvider: nil))
        #expect(!store.isStreaming)
        #expect(store.timeline?.first?.text == "Done")
        store.applyFetchedHistory([makeMessage(timeline: [.init(type: .text, id: "text", text: "Done")], tools: [])], for: "s")
        #expect(store.timeline == nil)
        #expect(store.messages.last?.timeline?.first?.text == "Done")
    }

    @Test
    func collaborationOutputDoesNotFinishAnAgentWhoseRawStateIsStillRunning() {
        let agent = ToolCall(
            id: "agent", name: "Agent",
            input: #"{"tool":"spawnAgent","agentsStates":{"child":{"status":"running"}}}"#,
            output: "Spawned", parentToolUseId: nil
        )
        let summary = ConversationTimelineActionSummary(tools: [agent], streaming: true)
        #expect(summary.runningToolName == "Agent")
        #expect(!summary.completed)
        #expect(summary.failedCount == 0)
    }

    @Test
    func agentRawFailureAndExplicitErrorRemainVisibleInCollapsedSummary() {
        let agent = ToolCall(
            id: "agent", name: "Agent", input: "{}",
            output: #"{"agentsStates":{"child":{"status":"errored"}}}"#, parentToolUseId: nil
        )
        #expect(ConversationTimelineActionSummary(tools: [agent], streaming: false).failedCount == 1)
        let explicitFailure = ToolCall(id: "agent", name: "Agent", input: "{}", output: "Failed",
                                       parentToolUseId: nil, isError: true)
        let summary = ConversationTimelineActionSummary(tools: [explicitFailure], streaming: true)
        #expect(summary.failedCount == 1)
        #expect(summary.runningToolName == nil)
    }

    @Test @MainActor
    func restHistoryArrivingBeforeDoneKeepsOneAuthoritativeMessage() throws {
        let store = makeStore()
        store.handle(.timelineEntry(sessionId: "s", entry: .init(type: .text, id: "text", text: ""), messageId: "turn"))
        store.handle(.textDelta(sessionId: "s", text: "Live", blockId: "text"))
        let authoritative = ChatMessage(
            id: "turn", sessionId: "s", role: .assistant, content: "Final", images: nil, toolCalls: nil,
            timeline: [.init(type: .text, id: "text", text: "Final")],
            timestamp: "2026-09-08T12:00:00Z", cancelled: nil, durationMs: 1234, inputTokens: 99
        )
        store.applyFetchedHistory([authoritative], for: "s")
        #expect(store.isStreaming)
        store.handle(.done(sessionId: "s", durationMs: 10, inputTokens: nil, outputTokens: nil,
                           contextUsedTokens: nil, contextWindowTokens: nil, pendingToolName: nil))
        #expect(store.messages.count == 1)
        let finalized = try #require(store.messages.first)
        #expect(finalized == authoritative)
        #expect(store.timeline == nil)
    }

    @Test @MainActor
    func emptyCancelledTimelinePreservesServerMessageIdentity() throws {
        let store = makeStore()
        store.handle(.streamSnapshot(sessionId: "s", text: "", toolCalls: [], agentActivities: [],
                                     agentPlanMode: false, streamingStartedAt: nil, timeline: [], messageId: "turn"))
        store.handle(.cancelled(sessionId: "s", errorDetail: nil, userInitiated: true, durationMs: nil))
        let cancelled = try #require(store.messages.first)
        #expect(cancelled.id == "turn")
        #expect(cancelled.timeline == [])
        #expect(cancelled.cancelled == true)
    }

    @MainActor private func makeStore() -> ConversationStore {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(status: .busy, sessionId: "s", streaming: true, streamingStartedAt: nil, lockedProvider: nil))
        return store
    }

    private func tool(_ id: String, name: String = "Read", parent: String? = nil) -> ToolCall {
        ToolCall(id: id, name: name, input: "{}", output: nil, parentToolUseId: parent)
    }

    private func makeMessage(timeline: [ConversationTimelineEntry]?, tools: [ToolCall], activities: [AgentActivity] = []) -> ChatMessage {
        ChatMessage(id: "turn", sessionId: "s", role: .assistant, content: "", images: nil,
                    toolCalls: tools, agentActivities: activities, timeline: timeline,
                    timestamp: "2026-09-08T00:00:00Z", cancelled: nil, durationMs: nil)
    }
}

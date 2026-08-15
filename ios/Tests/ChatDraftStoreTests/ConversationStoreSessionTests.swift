import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreSessionTests {
    @Test @MainActor
    func prepareSessionSwitchClearsVisibleStateAndInvalidatesHistoryTokens() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.history(messages: [
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Hello",
                images: nil,
                toolCalls: nil,
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
        store.flushStreamingDeltas()
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
    func streamSnapshotReplacesAccumulatedStreamingState() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Before "))
        store.handle(.thinking(sessionId: "session-1", blockId: "old", segments: [
            ReasoningSegment(id: "old:0", headline: nil, body: "old thinking"),
        ]))
        store.flushStreamingDeltas()

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "Before after",
            toolCalls: [
                ToolCall(
                    id: "tool-1",
                    name: "Read",
                    input: "{}",
                    output: "file contents",
                    parentToolUseId: nil
                )
            ],
            agentActivities: [
                .planUpdate(.init(
                    id: "plan-1",
                    steps: [.init(text: "Inspect", status: "completed")]
                ))
            ],
            agentPlanMode: true,
            streamingStartedAt: 1_700_000_002_000.0,
            reasoningSegments: [ReasoningSegment(id: "canonical:0", headline: "Canonical thinking", body: nil)]
        ))

        #expect(store.isStreaming == true)
        #expect(store.currentText == "Before after")
        #expect(store.reasoningSegments.map(\.headline) == ["Canonical thinking"])
        #expect(store.activeToolCalls.first?.id == "tool-1")
        #expect(store.activeToolCalls.first?.output == "file contents")
        #expect(store.activeAgentActivities.count == 1)
        #expect(store.agentPlanMode == true)
    }

    @Test @MainActor
    func decodesStreamSnapshotEvent() throws {
        let json = Data("""
        {
          "type": "stream_snapshot",
          "sessionId": "session-1",
          "text": "Hello",
          "toolCalls": [
            { "id": "tool-1", "name": "Read", "input": "{}", "output": "done" }
          ],
          "agentActivities": [
            {
              "id": "plan-1",
              "kind": "plan_update",
              "steps": [{ "text": "Inspect", "status": "completed" }]
            }
          ],
          "agentPlanMode": true,
          "streamingStartedAt": 1700000002000
        }
        """.utf8)

        let event = try JSONDecoder().decode(WsOutgoing.self, from: json)

        guard case .streamSnapshot(let sessionId, let text, let toolCalls,
                                   let activities, let agentPlanMode, let startedAt,
                                   let reasoningSegments) = event else {
            Issue.record("Expected stream snapshot")
            return
        }
        #expect(sessionId == "session-1")
        #expect(text == "Hello")
        #expect(toolCalls.first?.output == "done")
        #expect(activities.count == 1)
        #expect(agentPlanMode == true)
        #expect(startedAt == 1_700_000_002_000.0)
        #expect(reasoningSegments.isEmpty)
    }

    @Test @MainActor
    func streamSnapshotAdoptsSessionWhenNoneFocused() {
        let store = ConversationStore()
        #expect(store.sessionId == nil)

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "Recovered mid-turn",
            toolCalls: [],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: 1_700_000_002_000.0
        ))

        #expect(store.sessionId == "session-1")
        #expect(store.isStreaming == true)
        #expect(store.currentText == "Recovered mid-turn")
        #expect(store.streamingStartedAt != nil)
    }

    @Test @MainActor
    func streamSnapshotForBackgroundSessionDoesNotStealFocus() {
        let store = ConversationStore()
        store.handle(.status(
            status: .busy, sessionId: "session-A", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))
        #expect(store.sessionId == "session-A")

        store.handle(.streamSnapshot(
            sessionId: "session-B",
            text: "Background streaming",
            toolCalls: [],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: nil
        ))

        #expect(store.sessionId == "session-A")
        #expect(store.sessionStreams["session-B"]?.currentText == "Background streaming")
        #expect(store.sessionStreams["session-B"]?.isStreaming == true)
        #expect(store.currentText == "")
    }

    @Test @MainActor
    func streamSnapshotReplacesBackgroundAccumulationAfterSwitch() {
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy, sessionId: "session-A", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))
        store.handle(.status(
            status: .busy, sessionId: "session-B", streaming: true,
            streamingStartedAt: nil, lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-B", text: "partial "))
        store.handle(.textDelta(sessionId: "session-B", text: "delta"))
        store.flushStreamingDeltas()
        #expect(store.sessionStreams["session-B"]?.currentText == "partial delta")

        store.prepareSessionSwitch("session-B")
        #expect(store.sessionId == "session-B")

        store.handle(.streamSnapshot(
            sessionId: "session-B",
            text: "partial delta and more",
            toolCalls: [
                ToolCall(id: "tool-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)
            ],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: 1_700_000_002_000.0,
            reasoningSegments: [ReasoningSegment(id: "r:0", headline: "Reasoning", body: nil)]
        ))

        #expect(store.currentText == "partial delta and more")
        #expect(store.reasoningSegments.map(\.headline) == ["Reasoning"])
        #expect(store.activeToolCalls.first?.output == "ok")
        #expect(store.isStreaming == true)
    }

    @Test @MainActor
    func reconnectBootstrapKeepsActiveStreamAlive() {
        // Models the non-destructive reconnect (issue #259): the hub no longer wipes
        // sessionStreams on (re)connect, so an in-progress stream must survive a fresh
        // bootstrap and be reconciled in place by the authoritative stream_snapshot.
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "In progress before reconnect"))
        store.flushStreamingDeltas()
        store.handle(.toolUse(
            sessionId: "session-1",
            id: "tool-1",
            name: "Read",
            input: "{}",
            parentToolUseId: nil
        ))
        #expect(store.currentText == "In progress before reconnect")
        #expect(store.activeToolCalls.count == 1)

        // Reconnect re-bootstraps: a status event reasserts streaming, then the snapshot
        // replaces the accumulated state. No clear happens in between.
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        // Stream slot is intact immediately after the status re-bootstrap.
        #expect(store.sessionStreams["session-1"]?.isStreaming == true)
        #expect(store.sessionStreams["session-1"]?.currentText == "In progress before reconnect")
        #expect(store.sessionStreams["session-1"]?.activeToolCalls.count == 1)

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "In progress before reconnect, now continued",
            toolCalls: [
                ToolCall(id: "tool-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)
            ],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: 1_700_000_002_000.0
        ))

        // Snapshot REPLACED rather than appended — no duplicate tool calls.
        #expect(store.isStreaming == true)
        #expect(store.currentText == "In progress before reconnect, now continued")
        #expect(store.activeToolCalls.count == 1)
        #expect(store.activeToolCalls.first?.output == "ok")
    }

    @Test @MainActor
    func historyDropsStaleNonStreamingStreamSlot() {
        // A turn finished while the socket was a backgrounded zombie. On reconnect the
        // status arrives as idle (not streaming) and history carries the finalized turn.
        // The stale in-progress stream slot must be dropped so it is not rendered as a
        // duplicate bubble alongside the persisted message (issue #259).
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Half-finished answer"))
        store.flushStreamingDeltas()
        #expect(store.sessionStreams["session-1"]?.currentText == "Half-finished answer")

        // The turn is no longer streaming (e.g. idle status from bootstrap).
        store.handle(.status(
            status: .idle,
            sessionId: "session-1",
            streaming: false,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        #expect(store.sessionStreams["session-1"] != nil)

        // REST history arrives with the finalized assistant turn (no unanswered question).
        store.applyFetchedHistory([
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Question",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            ),
            ChatMessage(
                id: "message-2",
                sessionId: "session-1",
                role: .assistant,
                content: "Half-finished answer, now complete",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:01.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-1")

        #expect(store.messages.count == 2)
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @Test @MainActor
    func historyRebuildsCleanSlotWithPendingToolInputs() {
        // The last finalized assistant turn ends on an unanswered AskUserQuestion. History
        // must rebuild a CLEAN slot carrying only those pending inputs (no stale streaming
        // text/tool calls), so the question prompt survives reconnect.
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "stale streaming text"))
        store.flushStreamingDeltas()
        store.handle(.status(
            status: .idle,
            sessionId: "session-1",
            streaming: false,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.applyFetchedHistory([
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .assistant,
                content: "Which option?",
                images: nil,
                toolCalls: [
                    ToolCall(id: "ask-1", name: "AskUserQuestion", input: "{}", output: nil, parentToolUseId: nil)
                ],
                timestamp: "2026-01-01T00:00:01.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-1")

        let stream = store.sessionStreams["session-1"]
        #expect(stream != nil)
        #expect(stream?.currentText == "")
        #expect(stream?.activeToolCalls.isEmpty == true)
        #expect(stream?.isStreaming == false)
        #expect(stream?.pendingToolInputs.count == 1)
        #expect(stream?.pendingToolInputs.first?.toolName == "AskUserQuestion")
    }

    @Test @MainActor
    func historyLeavesActiveStreamingSessionUntouched() {
        // While a session is actively streaming, history (finalized turns) must not
        // disturb the live stream slot — live WS state wins.
        let store = ConversationStore(streamFlushInterval: nil)
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Live streaming content"))
        store.flushStreamingDeltas()

        store.applyFetchedHistory([
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Earlier turn",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-1")

        #expect(store.sessionStreams["session-1"]?.isStreaming == true)
        #expect(store.sessionStreams["session-1"]?.currentText == "Live streaming content")
        #expect(store.messages.count == 1)
    }

    @Test @MainActor
    func switchBackRestoresCachedMessagesInstantly() {
        // View session A (REST history applied), switch to B, switch back to A.
        // A's messages must reappear instantly from the per-session cache — no
        // empty flash, no refetch required. Mirrors web's React Query cache.
        let store = ConversationStore()
        store.setFocusedSessionId("session-A")
        store.applyFetchedHistory([
            ChatMessage(
                id: "a-1",
                sessionId: "session-A",
                role: .user,
                content: "Hello from A",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-A")
        #expect(store.messages.count == 1)

        // Switch to B (never viewed) — empty.
        store.prepareSessionSwitch("session-B")
        #expect(store.sessionId == "session-B")
        #expect(store.messages.isEmpty)

        // Switch back to A — restored instantly from cache without a refetch.
        store.prepareSessionSwitch("session-A")
        #expect(store.sessionId == "session-A")
        #expect(store.messages.count == 1)
        #expect(store.messages.first?.content == "Hello from A")
    }

    @Test @MainActor
    func cachedMessagesDrivesLoadingVersusContentState() {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")

        #expect(store.cachedMessages(for: "session-1") == nil)

        store.applyFetchedHistory([
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Hello",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-1")

        #expect(store.cachedMessages(for: "session-1")?.count == 1)
        #expect(store.cachedMessages(for: "session-2") == nil)
    }

    @Test @MainActor
    func userMessageKeepsCacheInSyncForSwitchBack() {
        // A user message appended over WS must land in the cache so switching
        // away and back shows the turn without a refetch.
        let store = ConversationStore()
        store.setFocusedSessionId("session-A")
        store.applyFetchedHistory([], for: "session-A")

        store.handle(.userMessage(message: ChatMessage(
            id: "u-1",
            sessionId: "session-A",
            role: .user,
            content: "New question",
            images: nil,
            toolCalls: nil,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )))
        #expect(store.messages.count == 1)

        store.prepareSessionSwitch("session-B")
        #expect(store.messages.isEmpty)

        store.prepareSessionSwitch("session-A")
        #expect(store.messages.count == 1)
        #expect(store.messages.first?.content == "New question")
    }

    @Test @MainActor
    func doneKeepsCacheInSyncForSwitchBack() {
        // A finalized assistant turn (done) must land in the cache so switching
        // away and back shows the finalized turn from cache.
        let store = ConversationStore(streamFlushInterval: nil)
        store.setFocusedSessionId("session-A")
        store.applyFetchedHistory([], for: "session-A")
        store.handle(.status(
            status: .busy,
            sessionId: "session-A",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-A", text: "Finalized answer"))
        store.handle(.done(
            sessionId: "session-A",
            durationMs: 100,
            inputTokens: nil,
            outputTokens: nil,
            contextUsedTokens: nil,
            contextWindowTokens: nil,
            pendingToolName: nil
        ))
        #expect(store.messages.contains { $0.content == "Finalized answer" })

        store.prepareSessionSwitch("session-B")
        #expect(store.messages.isEmpty)

        store.prepareSessionSwitch("session-A")
        #expect(store.messages.contains { $0.content == "Finalized answer" })
    }

    @Test @MainActor
    func syncWorkspacesEncodesFocusAndOmitsHistoryViaRest() throws {
        let message = HubIncoming.syncWorkspaces(
            workspaceIds: ["ws-1"],
            focusWorkspaces: ["ws-1"],
            prWorkspaces: ["ws-1"]
        )
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(object?["type"] as? String == "sync_workspaces")
        #expect(object?["historyViaRest"] == nil)
        #expect((object?["workspaceIds"] as? [String]) == ["ws-1"])
        #expect((object?["focusWorkspaces"] as? [String]) == ["ws-1"])
        #expect((object?["prWorkspaces"] as? [String]) == ["ws-1"])
        // A routine sync doesn't request a forced refresh, so the field stays omitted.
        #expect(object?["forceBootstrap"] == nil)
    }

    @Test @MainActor
    func syncWorkspacesEncodesForceBootstrapWhenTrue() throws {
        let message = HubIncoming.syncWorkspaces(
            workspaceIds: ["ws-1"],
            focusWorkspaces: ["ws-1"],
            prWorkspaces: ["ws-1"],
            forceBootstrap: true
        )
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(object?["type"] as? String == "sync_workspaces")
        #expect(object?["historyViaRest"] == nil)
        #expect((object?["workspaceIds"] as? [String]) == ["ws-1"])
        #expect((object?["focusWorkspaces"] as? [String]) == ["ws-1"])
        #expect((object?["prWorkspaces"] as? [String]) == ["ws-1"])
        #expect(object?["forceBootstrap"] as? Bool == true)
    }

    @Test @MainActor
    func requestStreamSnapshotsEncodesTypeOnly() throws {
        let message = WsIncoming.requestStreamSnapshots
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(object?["type"] as? String == "request_stream_snapshots")
        // No session id: every currently streaming session in the addressed
        // workspace is replayed, and this must not carry any sync_workspaces
        // fields when wrapped in the { workspaceId, event } envelope.
        #expect(object?["sessionId"] == nil)
        #expect(object?["workspaceIds"] == nil)
        #expect(object?["forceBootstrap"] == nil)
    }

    @Test @MainActor
    func markReadEncodesRenderedAssistantCount() throws {
        let message = HubIncoming.workspaceEvent(
            workspaceId: "ws-1",
            event: .markRead(sessionId: "session-1", throughCount: 3)
        )
        let data = try JSONEncoder().encode(message)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let event = try #require(object["event"] as? [String: Any])

        #expect(object["workspaceId"] as? String == "ws-1")
        #expect(event["type"] as? String == "mark_read")
        #expect(event["sessionId"] as? String == "session-1")
        #expect(event["throughCount"] as? Int == 3)
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

    private func makeSession(id: String, title: String?) -> SessionMetadata {
        SessionMetadata(
            sessionId: id,
            providerSessionId: nil,
            claudeSessionId: nil,
            workspaceId: "ws-1",
            title: title,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            assistantMessageCount: 0,
            readAssistantMessageCount: 0,
            lockedProvider: nil
        )
    }

    @Test @MainActor
    func deleteSessionSuccessReportsDeleted() async {
        let store = ConversationStore()
        let target = makeSession(id: "session-1", title: "Fix login bug")
        let other = makeSession(id: "session-2", title: "Ship release")

        let outcome = await store.deleteSession(
            target,
            from: [target, other],
            focusedSessionId: nil
        ) { _ in }

        #expect(outcome.deleted)
        #expect(outcome.errorMessage == nil)
    }

    @Test @MainActor
    func deleteSessionFailureNamesConversation() async {
        struct DeleteError: LocalizedError {
            var errorDescription: String? { "Server unreachable" }
        }
        let store = ConversationStore()
        let target = makeSession(id: "session-1", title: "Fix login bug")

        let outcome = await store.deleteSession(
            target,
            from: [target],
            focusedSessionId: nil
        ) { _ in throw DeleteError() }

        #expect(outcome.deleted == false)
        #expect(outcome.errorMessage?.contains("Fix login bug") == true)
        #expect(outcome.errorMessage?.contains("Server unreachable") == true)
    }

    @Test @MainActor
    func deleteSessionFailureNamesUntitledConversation() async {
        struct DeleteError: Error {}
        let store = ConversationStore()
        let target = makeSession(id: "session-1", title: "   ")

        let outcome = await store.deleteSession(
            target,
            from: [target],
            focusedSessionId: nil
        ) { _ in throw DeleteError() }

        #expect(outcome.deleted == false)
        #expect(outcome.errorMessage?.contains("Untitled Conversation") == true)
    }

    @Test @MainActor
    func deleteSessionCancellationReportsNothing() async {
        let store = ConversationStore()
        let target = makeSession(id: "session-1", title: "Fix login bug")

        let outcome = await store.deleteSession(
            target,
            from: [target],
            focusedSessionId: nil
        ) { _ in throw CancellationError() }

        #expect(outcome.deleted == false)
        #expect(outcome.errorMessage == nil)
    }

    @Test @MainActor
    func deleteSessionFocusedSessionFallsBackToNextSession() async {
        let store = ConversationStore()
        store.setFocusedSessionId("session-1")
        store.applyFetchedHistory([
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Hello",
                images: nil,
                toolCalls: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], for: "session-1")
        let target = makeSession(id: "session-1", title: "Fix login bug")
        let other = makeSession(id: "session-2", title: "Ship release")

        let outcome = await store.deleteSession(
            target,
            from: [target, other],
            focusedSessionId: "session-1"
        ) { _ in }

        #expect(outcome.deleted)
        #expect(outcome.errorMessage == nil)
        #expect(store.sessionId == "session-2")
        #expect(store.cachedMessages(for: "session-1") == nil)
    }
}

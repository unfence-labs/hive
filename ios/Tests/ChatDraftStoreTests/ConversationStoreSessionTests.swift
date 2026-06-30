import Foundation
import Testing
@testable import HiveMobileStoresCore

struct ConversationStoreSessionTests {
    @Test @MainActor
    func prepareSessionSwitchClearsVisibleStateAndInvalidatesHistoryTokens() {
        let store = ConversationStore()
        store.handle(.history(messages: [
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
        ], sessionId: "session-1"))
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: "codex"
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Streaming in the background"))
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
                thinkingContent: nil,
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
                thinkingContent: nil,
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
                thinkingContent: nil,
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
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Before "))
        store.handle(.thinking(sessionId: "session-1", text: "old thinking"))

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "Before after",
            thinking: "Canonical thinking",
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
            streamingStartedAt: 1_700_000_002_000.0
        ))

        #expect(store.isStreaming == true)
        #expect(store.currentText == "Before after")
        #expect(store.currentThinking == "Canonical thinking")
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
          "thinking": "Reasoning",
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

        guard case .streamSnapshot(let sessionId, let text, let thinking, let toolCalls,
                                   let activities, let agentPlanMode, let startedAt) = event else {
            Issue.record("Expected stream snapshot")
            return
        }
        #expect(sessionId == "session-1")
        #expect(text == "Hello")
        #expect(thinking == "Reasoning")
        #expect(toolCalls.first?.output == "done")
        #expect(activities.count == 1)
        #expect(agentPlanMode == true)
        #expect(startedAt == 1_700_000_002_000.0)
    }

    @Test @MainActor
    func streamSnapshotAdoptsSessionWhenNoneFocused() {
        let store = ConversationStore()
        #expect(store.sessionId == nil)

        store.handle(.streamSnapshot(
            sessionId: "session-1",
            text: "Recovered mid-turn",
            thinking: "",
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
            thinking: "",
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
        let store = ConversationStore()
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
        #expect(store.sessionStreams["session-B"]?.currentText == "partial delta")

        store.prepareSessionSwitch("session-B")
        #expect(store.sessionId == "session-B")

        store.handle(.streamSnapshot(
            sessionId: "session-B",
            text: "partial delta and more",
            thinking: "Reasoning",
            toolCalls: [
                ToolCall(id: "tool-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)
            ],
            agentActivities: [],
            agentPlanMode: false,
            streamingStartedAt: 1_700_000_002_000.0
        ))

        #expect(store.currentText == "partial delta and more")
        #expect(store.currentThinking == "Reasoning")
        #expect(store.activeToolCalls.first?.output == "ok")
        #expect(store.isStreaming == true)
    }

    @Test @MainActor
    func reconnectBootstrapKeepsActiveStreamAlive() {
        // Models the non-destructive reconnect (issue #259): the hub no longer wipes
        // sessionStreams on (re)connect, so an in-progress stream must survive a fresh
        // bootstrap and be reconciled in place by the authoritative stream_snapshot.
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "In progress before reconnect"))
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
            thinking: "",
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
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Half-finished answer"))
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

        // History arrives with the finalized assistant turn (no unanswered question).
        store.handle(.history(messages: [
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Question",
                images: nil,
                toolCalls: nil,
                thinkingContent: nil,
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
                thinkingContent: nil,
                timestamp: "2026-01-01T00:00:01.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], sessionId: "session-1"))

        #expect(store.messages.count == 2)
        #expect(store.sessionStreams["session-1"] == nil)
    }

    @Test @MainActor
    func historyRebuildsCleanSlotWithPendingToolInputs() {
        // The last finalized assistant turn ends on an unanswered AskUserQuestion. History
        // must rebuild a CLEAN slot carrying only those pending inputs (no stale streaming
        // text/tool calls), so the question prompt survives reconnect.
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "stale streaming text"))
        store.handle(.status(
            status: .idle,
            sessionId: "session-1",
            streaming: false,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))

        store.handle(.history(messages: [
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .assistant,
                content: "Which option?",
                images: nil,
                toolCalls: [
                    ToolCall(id: "ask-1", name: "AskUserQuestion", input: "{}", output: nil, parentToolUseId: nil)
                ],
                thinkingContent: nil,
                timestamp: "2026-01-01T00:00:01.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], sessionId: "session-1"))

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
        let store = ConversationStore()
        store.handle(.status(
            status: .busy,
            sessionId: "session-1",
            streaming: true,
            streamingStartedAt: nil,
            lockedProvider: nil
        ))
        store.handle(.textDelta(sessionId: "session-1", text: "Live streaming content"))

        store.handle(.history(messages: [
            ChatMessage(
                id: "message-1",
                sessionId: "session-1",
                role: .user,
                content: "Earlier turn",
                images: nil,
                toolCalls: nil,
                thinkingContent: nil,
                timestamp: "2026-01-01T00:00:00.000Z",
                cancelled: nil,
                durationMs: nil
            )
        ], sessionId: "session-1"))

        #expect(store.sessionStreams["session-1"]?.isStreaming == true)
        #expect(store.sessionStreams["session-1"]?.currentText == "Live streaming content")
        #expect(store.messages.count == 1)
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
}

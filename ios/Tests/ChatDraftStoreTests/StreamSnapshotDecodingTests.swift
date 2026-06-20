import Foundation
import Testing
@testable import HiveMobileStoresCore

/// Wire-format decoding tests for the PRD #254 protocol additions: the
/// consolidated `stream_snapshot` event, the new lazy-output `ToolCall` /
/// `command_execution` scalars, the required `done.messageId`, and the optional
/// `cancelled.messageId`. Kept in sync with backend/frontend types.
struct StreamSnapshotDecodingTests {
    private func decodeEvent(_ json: String) throws -> WsOutgoing {
        let envelope = try decodeHubEnvelope(json)
        return envelope.event
    }

    private func decodeHubEnvelope(_ json: String) throws -> HubOutgoing {
        let data = try #require(json.data(using: .utf8))
        return try JSONDecoder().decode(HubOutgoing.self, from: data)
    }

    private func decodeToolCall(_ json: String) throws -> ToolCall {
        let data = try #require(json.data(using: .utf8))
        return try JSONDecoder().decode(ToolCall.self, from: data)
    }

    // MARK: - stream_snapshot

    @Test
    func decodesStreamSnapshotWithAllFields() throws {
        let event = try decodeEvent("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "stream_snapshot",
            "sessionId": "session-1",
            "text": "partial answer",
            "thinking": "reasoning so far",
            "toolCalls": [
              { "id": "tool-1", "name": "Read", "input": "{}", "output": "file contents" }
            ],
            "agentActivities": [
              {
                "id": "cmd-1",
                "kind": "command_execution",
                "command": "swift test",
                "status": "completed",
                "output": "ok",
                "exitCode": 0
              }
            ],
            "planMode": true,
            "streamingStartedAt": 1700000000000
          }
        }
        """)

        guard case .streamSnapshot(let sid, let text, let thinking, let toolCalls,
                                   let activities, let planMode, let startedAt) = event else {
            Issue.record("Expected stream_snapshot event")
            return
        }
        #expect(sid == "session-1")
        #expect(text == "partial answer")
        #expect(thinking == "reasoning so far")
        #expect(toolCalls.map(\.id) == ["tool-1"])
        #expect(toolCalls.first?.output == "file contents")
        #expect(activities.map(\.id) == ["cmd-1"])
        #expect(planMode == true)
        #expect(startedAt == 1700000000000)
    }

    @Test
    func decodesStreamSnapshotWithEmptyCollections() throws {
        let event = try decodeEvent("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "stream_snapshot",
            "sessionId": "session-1",
            "text": "",
            "thinking": "",
            "toolCalls": [],
            "agentActivities": [],
            "planMode": false,
            "streamingStartedAt": 1700000000000
          }
        }
        """)

        guard case .streamSnapshot(_, let text, _, let toolCalls, let activities, let planMode, _) = event else {
            Issue.record("Expected stream_snapshot event")
            return
        }
        #expect(text == "")
        #expect(toolCalls.isEmpty)
        #expect(activities.isEmpty)
        #expect(planMode == false)
    }

    // MARK: - ToolCall lazy-output scalars

    @Test
    func decodesToolCallWithTruncatedOutputScalars() throws {
        // History form: full body omitted, preview + exact scalars present.
        let tool = try decodeToolCall("""
        {
          "id": "tool-1",
          "name": "Bash",
          "input": "{}",
          "outputPreview": "first 2KB...",
          "outputLineCount": 4096,
          "outputByteLength": 1048576,
          "outputTruncated": true
        }
        """)

        #expect(tool.output == nil)
        #expect(tool.outputPreview == "first 2KB...")
        #expect(tool.outputLineCount == 4096)
        #expect(tool.outputByteLength == 1048576)
        #expect(tool.outputTruncated == true)
    }

    @Test
    func decodesToolCallWithUntruncatedOutputIntact() throws {
        // Small output: full body kept, truncated == false.
        let tool = try decodeToolCall("""
        {
          "id": "tool-1",
          "name": "Grep",
          "input": "{}",
          "output": "a\\nb\\nc",
          "outputPreview": "a\\nb\\nc",
          "outputLineCount": 3,
          "outputByteLength": 5,
          "outputTruncated": false
        }
        """)

        #expect(tool.output == "a\nb\nc")
        #expect(tool.outputLineCount == 3)
        #expect(tool.outputByteLength == 5)
        #expect(tool.outputTruncated == false)
    }

    @Test
    func decodesLegacyToolCallWithoutScalars() throws {
        // Backwards compatible: a tool with no scalar fields decodes with nils.
        let tool = try decodeToolCall("""
        { "id": "tool-1", "name": "Read", "input": "{}", "output": "x" }
        """)

        #expect(tool.output == "x")
        #expect(tool.outputPreview == nil)
        #expect(tool.outputLineCount == nil)
        #expect(tool.outputByteLength == nil)
        #expect(tool.outputTruncated == nil)
    }

    @Test
    func decodesCommandExecutionWithOutputScalars() throws {
        let data = try #require("""
        {
          "id": "cmd-1",
          "kind": "command_execution",
          "command": "cat big.log",
          "status": "completed",
          "outputPreview": "head of log...",
          "outputLineCount": 12000,
          "outputByteLength": 524288,
          "outputTruncated": true
        }
        """.data(using: .utf8))
        let activity = try JSONDecoder().decode(AgentActivity.self, from: data)

        guard case .commandExecution(let command) = activity else {
            Issue.record("Expected command_execution activity")
            return
        }
        #expect(command.output == nil)
        #expect(command.outputPreview == "head of log...")
        #expect(command.outputLineCount == 12000)
        #expect(command.outputByteLength == 524288)
        #expect(command.outputTruncated == true)

        // The scalars carry through into the derived ToolCall so the collapsed
        // view reads them instead of the (omitted) body.
        let tool = try #require(activity.toolCalls.first)
        #expect(tool.outputLineCount == 12000)
        #expect(tool.outputTruncated == true)
        #expect(tool.output == nil)
    }

    // MARK: - done / cancelled message id

    @Test
    func decodesDoneWithRequiredMessageId() throws {
        let event = try decodeEvent("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "done",
            "sessionId": "session-1",
            "messageId": "server-msg-1",
            "durationMs": 1200
          }
        }
        """)

        guard case .done(let sid, let messageId, let durationMs, _, _, _, _, _) = event else {
            Issue.record("Expected done event")
            return
        }
        #expect(sid == "session-1")
        #expect(messageId == "server-msg-1")
        #expect(durationMs == 1200)
    }

    @Test
    func decodesCancelledWithOptionalMessageIdPresent() throws {
        let event = try decodeEvent("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "cancelled",
            "sessionId": "session-1",
            "messageId": "server-cancel-1",
            "userInitiated": true,
            "durationMs": 300
          }
        }
        """)

        guard case .cancelled(let sid, let messageId, _, let userInitiated, let durationMs) = event else {
            Issue.record("Expected cancelled event")
            return
        }
        #expect(sid == "session-1")
        #expect(messageId == "server-cancel-1")
        #expect(userInitiated == true)
        #expect(durationMs == 300)
    }

    @Test
    func decodesCancelledWithoutMessageId() throws {
        let event = try decodeEvent("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "cancelled",
            "sessionId": "session-1",
            "userInitiated": false
          }
        }
        """)

        guard case .cancelled(_, let messageId, _, let userInitiated, _) = event else {
            Issue.record("Expected cancelled event")
            return
        }
        #expect(messageId == nil)
        #expect(userInitiated == false)
    }
}

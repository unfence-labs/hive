import Foundation
import Testing
@testable import HiveMobileStoresCore

struct AgentActivityDecodingTests {
    @Test
    func decodesCommandExecutionWebSocketEvent() throws {
        let envelope = try decodeHubEnvelope("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "agent_activity",
            "sessionId": "session-1",
            "activity": {
              "id": "cmd-1",
              "kind": "command_execution",
              "command": "swift test",
              "cwd": "/repo",
              "status": "completed",
              "output": "ok",
              "exitCode": 0,
              "durationMs": 1200
            }
          }
        }
        """)

        guard case .agentActivity(let sessionId, let activity) = envelope.event else {
            Issue.record("Expected agent_activity event")
            return
        }
        #expect(sessionId == "session-1")
        guard case .commandExecution(let command) = activity else {
            Issue.record("Expected command execution activity")
            return
        }
        #expect(command.id == "cmd-1")
        #expect(command.command == "swift test")
        #expect(command.output == "ok")
        #expect(command.exitCode == 0)
        #expect(command.durationMs == 1200)
    }

    @Test
    func convertsCommandActionReadActivitiesToReadToolCalls() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "cmd-read",
              "kind": "command_execution",
              "command": "cat README.md",
              "cwd": "/repo",
              "status": "completed",
              "output": "# Demo\\n",
              "exitCode": 0,
              "commandActions": [
                {
                  "type": "read",
                  "command": "cat README.md",
                  "name": "cat",
                  "path": "/repo/README.md"
                }
              ]
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .commandExecution(let command) = activity else {
            Issue.record("Expected command execution activity")
            return
        }
        #expect(command.commandActions?.first?.type == "read")

        let merged = mergeToolCalls([], with: [activity])
        let tool = try #require(merged.first)
        let inputData = try #require(tool.input.data(using: .utf8))
        let input = try #require(JSONSerialization.jsonObject(with: inputData) as? [String: Any])
        #expect(tool.name == "Read")
        #expect(tool.output == "# Demo\n")
        #expect(input["file_path"] as? String == "/repo/README.md")
        #expect(visibleAgentActivities([activity]).isEmpty)
    }

    @Test
    func decodesFileChangeActivityInPersistedMessage() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "file-1",
              "kind": "file_change",
              "status": "completed",
              "files": [
                {
                  "path": "Sources/App.swift",
                  "kind": "update",
                  "diff": "--- a/Sources/App.swift\\n+++ b/Sources/App.swift\\n@@\\n-old\\n+new"
                }
              ]
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .fileChange(let fileChange) = activity else {
            Issue.record("Expected file change activity")
            return
        }
        #expect(fileChange.status == "completed")
        #expect(fileChange.files.first?.path == "Sources/App.swift")
        #expect(fileChange.files.first?.kind == "update")
    }

    @Test
    func decodesPlanAndDiagnosticActivities() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "plan-1",
              "kind": "plan_update",
              "steps": [
                { "text": "Inspect", "status": "completed" },
                { "text": "Patch", "status": "inProgress" }
              ]
            },
            {
              "id": "diag-1",
              "kind": "diagnostic",
              "severity": "warning",
              "title": "Unsupported App Server event",
              "message": "Hive does not render this yet.",
              "source": "codex_app_server",
              "method": "model/rerouted",
              "details": "{\\"reason\\":\\"test\\"}"
            }
          ]
        }
        """)

        let activities = try #require(message.agentActivities)
        let first = try #require(activities.first)
        let second = try #require(activities.dropFirst().first)
        guard case .planUpdate(let plan) = first else {
            Issue.record("Expected plan activity")
            return
        }
        #expect(plan.steps.map(\.text) == ["Inspect", "Patch"])
        #expect(visibleAgentActivities(activities).map(\.id) == ["diag-1"])

        guard case .diagnostic(let diagnostic) = second else {
            Issue.record("Expected diagnostic activity")
            return
        }
        #expect(diagnostic.severity == .warning)
        #expect(diagnostic.method == "model/rerouted")
    }

    @Test
    func mergesToolCallsWithActivityToolsBeforeDiagnostics() throws {
        let agentTool = ToolCall(
            id: "agent-1",
            name: "Agent",
            input: #"{"subagent_type":"Agent","description":"Inspect"}"#,
            output: nil,
            parentToolUseId: nil
        )
        let providedCommand = ToolCall(
            id: "cmd-1",
            name: "Bash",
            input: #"{"command":"swift test"}"#,
            output: "ok",
            parentToolUseId: "agent-1"
        )
        let activities: [AgentActivity] = [
            .commandExecution(.init(
                id: "cmd-1",
                command: "swift test",
                cwd: nil,
                status: "completed",
                output: "ok",
                exitCode: 0,
                durationMs: 120
            )),
            .commandExecution(.init(
                id: "cmd-2",
                command: "swift lint",
                cwd: nil,
                status: "completed",
                output: "ok",
                exitCode: 0,
                durationMs: nil
            )),
            .diagnostic(.init(
                id: "diag-1",
                severity: .warning,
                title: "Unsupported App Server event",
                message: "Hive does not render this yet.",
                source: "codex_app_server",
                method: "thread/status/changed",
                details: nil
            ))
        ]

        let merged = mergeToolCalls([agentTool, providedCommand], with: activities)

        #expect(merged.map(\.id) == ["agent-1", "cmd-1", "cmd-2"])
        #expect(merged.first { $0.id == "cmd-1" }?.parentToolUseId == "agent-1")
        #expect(visibleAgentActivities(activities).map(\.id) == ["diag-1"])
    }

    @Test
    func unknownWebSocketEventsDoNotBecomeChatErrors() throws {
        let envelope = try decodeHubEnvelope("""
        {
          "workspaceId": "ws-1",
          "event": {
            "type": "future_event"
          }
        }
        """)

        guard case .unknown(let type) = envelope.event else {
            Issue.record("Expected unknown event")
            return
        }
        #expect(type == "future_event")
    }

    @Test
    func decodesGoalUpdateActivityAndKeepsItOutOfVisibleFeed() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "codex-goal-thread-1",
              "kind": "goal_update",
              "active": true,
              "threadId": "thread-1",
              "objective": "Implement the backend protocol foundation",
              "status": "active",
              "tokenBudget": null,
              "tokensUsed": 1234,
              "timeUsedSeconds": 45,
              "createdAt": 1779300000,
              "updatedAt": 1779300060
            }
          ]
        }
        """)

        let activities = try #require(message.agentActivities)
        let first = try #require(activities.first)
        guard case .goalUpdate(let goal) = first else {
            Issue.record("Expected goal_update activity")
            return
        }
        #expect(goal.active == true)
        #expect(goal.threadId == "thread-1")
        #expect(goal.objective == "Implement the backend protocol foundation")
        #expect(goal.tokenBudget == nil)
        #expect(goal.tokensUsed == 1234)
        // Goal updates feed the task tracker, not the inline activity list.
        #expect(first.toolCalls.isEmpty)
        #expect(visibleAgentActivities(activities).isEmpty)
    }

    @Test
    func decodesGoalCommandFlagOnUserMessage() throws {
        let message = try decodeMessage("""
        {
          "id": "u-goal",
          "sessionId": "session-1",
          "role": "user",
          "content": "/goal Ship the feature",
          "goalCommand": true,
          "timestamp": "2026-01-01T00:00:00Z"
        }
        """)

        #expect(message.goalCommand == true)
    }

    private func decodeHubEnvelope(_ json: String) throws -> HubOutgoing {
        let data = try #require(json.data(using: .utf8))
        return try JSONDecoder().decode(HubOutgoing.self, from: data)
    }

    private func decodeMessage(_ json: String) throws -> ChatMessage {
        let data = try #require(json.data(using: .utf8))
        return try JSONDecoder().decode(ChatMessage.self, from: data)
    }
}

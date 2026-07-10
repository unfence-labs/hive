import Foundation
import Testing
@testable import HiveMobileStoresCore

struct AgentActivityDecodingTests {
    @Test(arguments: AgentActivitySubagentActivityKind.allCases)
    func decodesSubagentActivityVariants(_ activityKind: AgentActivitySubagentActivityKind) throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "subagent-\(activityKind.rawValue)",
              "kind": "subagent_activity",
              "activityKind": "\(activityKind.rawValue)",
              "agentThreadId": "thread-1",
              "agentPath": "/workspace/agents/research/sub-agent/thread"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .subagentActivity(let subagent) = activity else {
            Issue.record("Expected subagent activity")
            return
        }
        #expect(subagent.activityKind == activityKind)
        #expect(subagent.agentThreadId == "thread-1")
        #expect(subagent.agentPath == "/workspace/agents/research/sub-agent/thread")
        #expect(subagent.displayTitle == expectedSubagentTitle(for: activityKind))
        #expect(subagent.iconName == expectedSubagentIcon(for: activityKind))
        #expect(activity.toolCalls.isEmpty)
        #expect(visibleAgentActivities([activity]).map(\.id) == ["subagent-\(activityKind.rawValue)"])
    }

    @Test
    func keepsUnknownActivityDecodingAndVisibleFiltering() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "future-1",
              "kind": "future_activity"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .unknown(let unknown) = activity else {
            Issue.record("Expected unknown activity")
            return
        }
        #expect(unknown.id == "future-1")
        #expect(unknown.kind == "future_activity")
        #expect(visibleAgentActivities([activity]).map(\.id) == ["future-1"])
    }

    @Test
    func knownActivityWithUnknownSubagentActivityKindDecodesAsUnknown() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "subagent-future",
              "kind": "subagent_activity",
              "activityKind": "delegated",
              "agentThreadId": "thread-1",
              "agentPath": "/workspace/agents/research"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .unknown(let unknown) = activity else {
            Issue.record("Expected unknown activity")
            return
        }
        #expect(unknown.id == "subagent-future")
        #expect(unknown.kind == "subagent_activity")
        #expect(visibleAgentActivities([activity]).map(\.id) == ["subagent-future"])
    }

    @Test
    func knownDiagnosticWithUnknownSeverityDecodesAsUnknown() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "diag-future",
              "kind": "diagnostic",
              "severity": "catastrophic",
              "title": "Future diagnostic",
              "message": "Future severity",
              "source": "codex_app_server",
              "method": "item/subAgentActivity"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .unknown(let unknown) = activity else {
            Issue.record("Expected unknown activity")
            return
        }
        #expect(unknown.id == "diag-future")
        #expect(unknown.kind == "diagnostic")
        #expect(visibleAgentActivities([activity]).map(\.id) == ["diag-future"])
    }

    @Test
    func mixedValidAndMalformedActivitiesBothSurviveDecoding() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "subagent-started",
              "kind": "subagent_activity",
              "activityKind": "started",
              "agentThreadId": "thread-1",
              "agentPath": "/workspace/agents/research"
            },
            {
              "id": "subagent-future",
              "kind": "subagent_activity",
              "activityKind": "delegated",
              "agentThreadId": "thread-2",
              "agentPath": "/workspace/agents/future"
            }
          ]
        }
        """)

        let activities = try #require(message.agentActivities)
        #expect(activities.count == 2)

        guard case .subagentActivity(let valid) = activities[0] else {
            Issue.record("Expected valid subagent activity")
            return
        }
        #expect(valid.id == "subagent-started")
        #expect(valid.activityKind == .started)

        guard case .unknown(let unknown) = activities[1] else {
            Issue.record("Expected unknown activity")
            return
        }
        #expect(unknown.id == "subagent-future")
        #expect(unknown.kind == "subagent_activity")
        #expect(visibleAgentActivities(activities).map(\.id) == ["subagent-started", "subagent-future"])
    }

    @Test
    func decodesContextCompactionInProgress() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "compaction-1",
              "kind": "context_compaction",
              "status": "inProgress"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .contextCompaction(let compaction) = activity else {
            Issue.record("Expected context compaction activity")
            return
        }
        #expect(compaction.status == "inProgress")
        #expect(compaction.isPending(showExecutingState: true))
        #expect(!compaction.isPending(showExecutingState: false))
        #expect(compaction.displayTitle(showExecutingState: true) == "Compacting context…")
        #expect(compaction.displayTitle(showExecutingState: false) == "Context compacted")
        #expect(activity.toolCalls.isEmpty)
        #expect(visibleAgentActivities([activity]).map(\.id) == ["compaction-1"])
    }

    @Test
    func decodesContextCompactionCompleted() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "compaction-1",
              "kind": "context_compaction",
              "status": "completed"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .contextCompaction(let compaction) = activity else {
            Issue.record("Expected context compaction activity")
            return
        }
        #expect(compaction.status == "completed")
        #expect(!compaction.isPending(showExecutingState: true))
        #expect(compaction.displayTitle(showExecutingState: true) == "Context compacted")
        #expect(visibleAgentActivities([activity]).map(\.id) == ["compaction-1"])
    }

    @Test
    func decodesContextCompactionWithoutStatus() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "compaction-1",
              "kind": "context_compaction"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .contextCompaction(let compaction) = activity else {
            Issue.record("Expected context compaction activity")
            return
        }
        #expect(compaction.status == nil)
        #expect(compaction.isPending(showExecutingState: true))
        #expect(compaction.displayTitle(showExecutingState: true) == "Compacting context…")
        #expect(compaction.displayTitle(showExecutingState: false) == "Context compacted")
        #expect(visibleAgentActivities([activity]).map(\.id) == ["compaction-1"])
    }

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
    func decodesImageViewActivity() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "image-1",
              "kind": "image_view",
              "path": "/tmp/test/assets/screenshot.png",
              "relativePath": "assets/screenshot.png",
              "imageUrl": "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .imageView(let image) = activity else {
            Issue.record("Expected image_view activity")
            return
        }
        #expect(image.path == "/tmp/test/assets/screenshot.png")
        #expect(image.relativePath == "assets/screenshot.png")
        #expect(image.resolvedSource == "/api/workspaces/ws-1/file/raw?path=assets%2Fscreenshot.png")
        #expect(imageActivityFileName(image.path) == "screenshot.png")
        // Image activities never become tool calls; they stay in the visible feed.
        #expect(activity.toolCalls.isEmpty)
        #expect(visibleAgentActivities([activity]).map(\.id) == ["image-1"])
    }

    @Test
    func imageViewOutsideWorkspaceHasNoPreview() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "image-out",
              "kind": "image_view",
              "path": "/etc/hosts",
              "outsideWorkspace": true
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .imageView(let image) = activity else {
            Issue.record("Expected image_view activity")
            return
        }
        #expect(image.outsideWorkspace == true)
        #expect(image.resolvedSource == nil)
    }

    @Test
    func decodesImageGenerationActivityWithSavedFile() throws {
        let message = try decodeMessage("""
        {
          "id": "msg-1",
          "sessionId": "session-1",
          "role": "assistant",
          "content": "",
          "timestamp": "2026-01-01T00:00:00Z",
          "agentActivities": [
            {
              "id": "gen-1",
              "kind": "image_generation",
              "status": "completed",
              "revisedPrompt": "A neon city skyline at dusk",
              "relativePath": "generated/skyline.png",
              "imageUrl": "/api/workspaces/ws-1/file/raw?path=generated%2Fskyline.png"
            }
          ]
        }
        """)

        let activity = try #require(message.agentActivities?.first)
        guard case .imageGeneration(let image) = activity else {
            Issue.record("Expected image_generation activity")
            return
        }
        #expect(image.status == "completed")
        #expect(image.revisedPrompt == "A neon city skyline at dusk")
        #expect(image.resolvedSource == "/api/workspaces/ws-1/file/raw?path=generated%2Fskyline.png")
        // A resolvable image is never pending, even mid-stream.
        #expect(image.isPending(showExecutingState: true) == false)
        #expect(activity.toolCalls.isEmpty)
        #expect(visibleAgentActivities([activity]).map(\.id) == ["gen-1"])
    }

    @Test
    func imageGenerationInlineBase64ResultResolvesToDataURL() {
        let withRawBase64 = AgentActivity.ImageGeneration(
            id: "gen-2", status: "completed", revisedPrompt: nil,
            result: "iVBORw0KGgo=", savedPath: nil, relativePath: nil, imageUrl: nil
        )
        #expect(withRawBase64.resolvedSource == "data:image/png;base64,iVBORw0KGgo=")

        let withDataURL = AgentActivity.ImageGeneration(
            id: "gen-3", status: "completed", revisedPrompt: nil,
            result: "data:image/png;base64,iVBORw0KGgo=", savedPath: nil, relativePath: nil, imageUrl: nil
        )
        #expect(withDataURL.resolvedSource == "data:image/png;base64,iVBORw0KGgo=")
    }

    @Test
    func imageGenerationPendingOnlyWhileStreamingAndNonTerminal() {
        let streaming = AgentActivity.ImageGeneration(
            id: "gen-4", status: "inProgress", revisedPrompt: "wip",
            result: nil, savedPath: nil, relativePath: nil, imageUrl: nil
        )
        #expect(streaming.isPending(showExecutingState: true) == true)
        // History renders (no streaming flag) never animate a stale record.
        #expect(streaming.isPending(showExecutingState: false) == false)

        let failed = AgentActivity.ImageGeneration(
            id: "gen-5", status: "failed", revisedPrompt: nil,
            result: nil, savedPath: nil, relativePath: nil, imageUrl: nil
        )
        #expect(failed.isPending(showExecutingState: true) == false)
    }

    @Test
    func imagePromptPreviewCollapsesWhitespaceAndTruncates() throws {
        #expect(imagePromptPreview(nil) == nil)
        #expect(imagePromptPreview("   ") == nil)
        #expect(imagePromptPreview("  a   neon\n  city  ") == "a neon city")

        let long = String(repeating: "x", count: 100)
        let preview = try #require(imagePromptPreview(long))
        #expect(preview.count == 67) // 64 chars + "..."
        #expect(preview.hasSuffix("..."))
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

    private func expectedSubagentTitle(for activityKind: AgentActivitySubagentActivityKind) -> String {
        switch activityKind {
        case .started: "Started sub-agent"
        case .interacted: "Interacted with sub-agent"
        case .interrupted: "Interrupted sub-agent"
        }
    }

    private func expectedSubagentIcon(for activityKind: AgentActivitySubagentActivityKind) -> String {
        switch activityKind {
        case .started: "arrow.triangle.branch"
        case .interacted: "bubble.left"
        case .interrupted: "xmark.circle"
        }
    }
}

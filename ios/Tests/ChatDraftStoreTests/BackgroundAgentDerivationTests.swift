import Testing
@testable import HiveMobileStoresCore

struct BackgroundAgentDerivationTests {
    @Test
    func detectsRunningBackgroundAgent() throws {
        let tool = backgroundTask(id: "a1", type: "Explore", description: "Search callers", output: nil)

        let state = deriveBackgroundAgents(from: [], activeToolCalls: [tool])

        let agent = try #require(state.agents.first)
        #expect(agent.subagentType == "Explore")
        #expect(agent.description == "Search callers")
        #expect(agent.isRunning)
        #expect(state.runningCount == 1)
    }

    @Test
    func completedBackgroundAgentIsNotRunning() throws {
        let tool = backgroundTask(id: "a1", type: "Explore", description: "Search", output: #"{"result":"done"}"#)

        let state = deriveBackgroundAgents(from: [assistantMessage(tools: [tool])], activeToolCalls: [])

        let agent = try #require(state.agents.first)
        #expect(!agent.isRunning)
        #expect(state.runningCount == 0)
    }

    @Test
    func ignoresForegroundAndNonAgentTools() {
        let foreground = ToolCall(
            id: "a1",
            name: "Task",
            input: #"{"subagent_type":"Explore","description":"x","run_in_background":false}"#,
            output: nil,
            parentToolUseId: nil
        )
        let bash = ToolCall(id: "b1", name: "Bash", input: "{}", output: nil, parentToolUseId: nil)

        let state = deriveBackgroundAgents(from: [assistantMessage(tools: [foreground, bash])], activeToolCalls: [])

        #expect(state.agents.isEmpty)
        #expect(state == .empty)
    }

    @Test
    func ignoresNonSpawnAgentCollabTool() {
        let tool = ToolCall(
            id: "a1",
            name: "Task",
            input: #"{"subagent_type":"Explore","description":"x","run_in_background":true,"tool":"listAgents"}"#,
            output: nil,
            parentToolUseId: nil
        )

        let state = deriveBackgroundAgents(from: [], activeToolCalls: [tool])

        #expect(state.agents.isEmpty)
    }

    @Test
    func runningWhenAChildToolIsStillActive() throws {
        let parent = backgroundTask(id: "a1", type: "Explore", description: "Search", output: #"{"result":"partial"}"#)
        let child = ToolCall(id: "c1", name: "Grep", input: "{}", output: nil, parentToolUseId: "a1")

        let state = deriveBackgroundAgents(
            from: [assistantMessage(tools: [parent])],
            activeToolCalls: [child]
        )

        let agent = try #require(state.agents.first)
        #expect(agent.isRunning)
    }

    // MARK: - Helpers

    private func backgroundTask(id: String, type: String, description: String, output: String?) -> ToolCall {
        ToolCall(
            id: id,
            name: "Task",
            input: #"{"subagent_type":"\#(type)","description":"\#(description)","run_in_background":true}"#,
            output: output,
            parentToolUseId: nil
        )
    }

    private func assistantMessage(tools: [ToolCall]) -> ChatMessage {
        ChatMessage(
            id: "msg-1",
            sessionId: "session-1",
            role: .assistant,
            content: "",
            images: nil,
            toolCalls: tools,
            agentActivities: nil,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00Z",
            cancelled: nil,
            durationMs: nil
        )
    }
}

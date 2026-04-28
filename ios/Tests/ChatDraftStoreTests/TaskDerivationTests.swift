import Testing
@testable import HiveMobileStoresCore

struct TaskDerivationTests {
    @Test
    func derivesTasksFromCodexTodoList() throws {
        let tool = ToolCall(
            id: "todos-1",
            name: "TodoList",
            input: #"{"items":[{"text":"Inspect logs","completed":true},{"text":"Patch adapter","completed":false}]}"#,
            output: nil,
            parentToolUseId: nil
        )

        let state = deriveTasks(from: [assistantMessage(toolCalls: [tool])], activeToolCalls: [])

        #expect(state.counts.total == 2)
        #expect(state.counts.completed == 1)
        #expect(state.counts.pending == 1)
        #expect(state.tasks.map(\.subject) == ["Inspect logs", "Patch adapter"])
        #expect(state.tasks.map(\.status) == [.completed, .pending])
    }

    @Test
    func prefersTodoListOutputOverInput() throws {
        let tool = ToolCall(
            id: "todos-1",
            name: "TodoList",
            input: #"{"items":[{"text":"Old","completed":false}]}"#,
            output: #"{"items":[{"text":"Current","completed":true}]}"#,
            parentToolUseId: nil
        )

        let state = deriveTasks(from: [], activeToolCalls: [tool])

        let task = try #require(state.tasks.first)
        #expect(task.subject == "Current")
        #expect(task.status == .completed)
    }

    private func assistantMessage(toolCalls: [ToolCall]) -> ChatMessage {
        ChatMessage(
            id: "msg-1",
            sessionId: "session-1",
            role: .assistant,
            content: "",
            images: nil,
            toolCalls: toolCalls,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00Z",
            cancelled: nil,
            durationMs: nil
        )
    }
}

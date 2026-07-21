import Testing
@testable import HiveMobileStoresCore

struct ModelEquatableTests {
    private func message(
        content: String = "Hello",
        toolCalls: [ToolCall]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: "message-1",
            sessionId: "session-1",
            role: .assistant,
            content: content,
            images: nil,
            toolCalls: toolCalls,
            timestamp: "2026-01-01T00:00:00.000Z",
            cancelled: nil,
            durationMs: nil
        )
    }

    @Test
    func toolCallEquality() {
        let tool = ToolCall(id: "tool-1", name: "Read", input: "{}", output: nil, parentToolUseId: nil)
        let same = ToolCall(id: "tool-1", name: "Read", input: "{}", output: nil, parentToolUseId: nil)
        let withOutput = ToolCall(id: "tool-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)

        #expect(tool == same)
        #expect(tool != withOutput)
    }

    @Test
    func chatMessageEquality() {
        #expect(message() == message())
        #expect(message() != message(content: "Changed"))
        #expect(message() != message(toolCalls: [
            ToolCall(id: "tool-1", name: "Read", input: "{}", output: nil, parentToolUseId: nil)
        ]))
        #expect(message(toolCalls: [
            ToolCall(id: "tool-1", name: "Read", input: "{}", output: nil, parentToolUseId: nil)
        ]) != message(toolCalls: [
            ToolCall(id: "tool-1", name: "Read", input: "{}", output: "ok", parentToolUseId: nil)
        ]))
    }
}

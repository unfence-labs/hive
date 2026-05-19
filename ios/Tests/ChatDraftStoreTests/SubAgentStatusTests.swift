import Foundation
import Testing
@testable import HiveMobileStoresCore

struct SubAgentStatusTests {
    @Test
    func keepsCompletedCodexSpawnRunningWhenReceiverIsRunning() {
        let tool = agentTool(output: codexOutput([
            "tool": "spawnAgent",
            "status": "completed",
            "agentsStates": [
                "thread-child": ["status": "running"]
            ]
        ]))

        let state = subAgentExecutionState(for: tool, showExecutingState: true)

        #expect(state == .running)
    }

    @Test
    func doesNotKeepPersistedCodexSpawnRunningOutsideActiveStream() {
        let tool = agentTool(output: codexOutput([
            "tool": "spawnAgent",
            "status": "completed",
            "agentsStates": [
                "thread-child": ["status": "running"]
            ]
        ]))

        let state = subAgentExecutionState(for: tool, showExecutingState: false)

        #expect(state == .completed)
    }

    @Test
    func marksCodexSpawnFailedWhenReceiverFailed() {
        let tool = agentTool(output: codexOutput([
            "tool": "spawnAgent",
            "status": "completed",
            "agentsStates": [
                "thread-child": ["status": "errored", "message": "boom"]
            ]
        ]))

        let state = subAgentExecutionState(for: tool, showExecutingState: true)

        #expect(state == .failed)
    }

    @Test
    func keepsCompletedParentRunningWhileChildToolIsActive() {
        let parent = agentTool(output: "spawned")
        let child = ToolCall(
            id: "child-read",
            name: "Read",
            input: "{}",
            output: nil,
            parentToolUseId: "agent-1"
        )

        let state = subAgentExecutionState(
            for: parent,
            children: [child],
            childrenByParentId: ["agent-1": [child]],
            showExecutingState: true
        )

        #expect(state == .running)
    }

    private func agentTool(output: String?) -> ToolCall {
        ToolCall(
            id: "agent-1",
            name: "Agent",
            input: #"{"subagent_type":"Agent","run_in_background":true,"tool":"spawnAgent","status":"inProgress"}"#,
            output: output,
            parentToolUseId: nil
        )
    }

    private func codexOutput(_ payload: [String: Any]) -> String {
        let payloadData = try! JSONSerialization.data(withJSONObject: payload)
        let payloadText = String(data: payloadData, encoding: .utf8)!
        let blocks: [[String: Any]] = [["type": "text", "text": payloadText]]
        let blockData = try! JSONSerialization.data(withJSONObject: blocks)
        return String(data: blockData, encoding: .utf8)!
    }
}

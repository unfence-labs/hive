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

    @Test
    func derivesTasksFromLatestCodexPlanUpdate() throws {
        let messages = [
            assistantMessage(
                toolCalls: [],
                agentActivities: [
                    .planUpdate(AgentActivity.PlanUpdate(
                        id: "codex-plan-old",
                        steps: [AgentActivityPlanStep(text: "Old step", status: "completed")]
                    ))
                ]
            ),
            assistantMessage(
                toolCalls: [],
                agentActivities: [
                    .planUpdate(AgentActivity.PlanUpdate(
                        id: "codex-plan-current",
                        steps: [
                            AgentActivityPlanStep(text: "Inspect app-server flow", status: "completed"),
                            AgentActivityPlanStep(text: "Move plan to tracker", status: "inProgress"),
                            AgentActivityPlanStep(text: "Verify mobile parity", status: "pending")
                        ]
                    ))
                ]
            )
        ]

        let state = deriveTasks(from: messages, activeToolCalls: [])

        #expect(state.tasks.map(\.subject) == [
            "Inspect app-server flow",
            "Move plan to tracker",
            "Verify mobile parity"
        ])
        #expect(state.tasks.map(\.status) == [.completed, .inProgress, .pending])
        #expect(state.currentTask?.subject == "Move plan to tracker")
        #expect(state.counts.total == 3)
        #expect(state.counts.completed == 1)
        #expect(state.counts.inProgress == 1)
        #expect(state.counts.pending == 1)
    }

    @Test
    func usesActiveCodexPlanUpdateOverPersistedPlans() throws {
        let messages = [
            assistantMessage(
                toolCalls: [],
                agentActivities: [
                    .planUpdate(AgentActivity.PlanUpdate(
                        id: "codex-plan-history",
                        steps: [AgentActivityPlanStep(text: "Historical plan", status: "completed")]
                    ))
                ]
            )
        ]
        let activeActivities: [AgentActivity] = [
            .planUpdate(AgentActivity.PlanUpdate(
                id: "codex-plan-live",
                steps: [
                    AgentActivityPlanStep(text: "Live implementation", status: "inProgress"),
                    AgentActivityPlanStep(text: "Run checks", status: "pending")
                ]
            ))
        ]

        let state = deriveTasks(from: messages, activeToolCalls: [], activeAgentActivities: activeActivities)

        #expect(state.tasks.map(\.subject) == ["Live implementation", "Run checks"])
        #expect(state.currentTask?.subject == "Live implementation")
    }

    @Test
    func preservesFailedAndDeclinedPlanStatuses() throws {
        let message = assistantMessage(
            toolCalls: [],
            agentActivities: [
                .planUpdate(AgentActivity.PlanUpdate(
                    id: "codex-plan-failed",
                    steps: [
                        AgentActivityPlanStep(text: "Try risky migration", status: "failed"),
                        AgentActivityPlanStep(text: "Skip rejected change", status: "declined")
                    ]
                ))
            ]
        )

        let state = deriveTasks(from: [message], activeToolCalls: [])

        #expect(state.tasks.map(\.status) == [.failed, .declined])
        #expect(state.counts.total == 2)
        #expect(state.counts.completed == 0)
        #expect(state.counts.inProgress == 0)
        #expect(state.counts.pending == 0)
    }

    private func assistantMessage(
        toolCalls: [ToolCall],
        agentActivities: [AgentActivity]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: "msg-1",
            sessionId: "session-1",
            role: .assistant,
            content: "",
            images: nil,
            toolCalls: toolCalls,
            agentActivities: agentActivities,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00Z",
            cancelled: nil,
            durationMs: nil
        )
    }
}

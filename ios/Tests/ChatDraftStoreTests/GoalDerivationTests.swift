import Testing
@testable import HiveMobileStoresCore

struct GoalDerivationTests {
    @Test
    func returnsLatestActiveGoal() throws {
        let messages = [
            assistantMessage(activities: [goalActivity(id: "g1", active: true, objective: "First")]),
            assistantMessage(activities: [goalActivity(id: "g2", active: true, objective: "Second")]),
        ]

        let state = try #require(deriveGoalState(from: messages))
        #expect(state.id == "g2")
        #expect(state.objective == "Second")
    }

    @Test
    func clearsWhenLatestGoalInactive() {
        let messages = [
            assistantMessage(activities: [goalActivity(id: "g1", active: true)]),
            assistantMessage(activities: [goalActivity(id: "g1", active: false)]),
        ]

        #expect(deriveGoalState(from: messages) == nil)
    }

    @Test
    func activeStreamingGoalOverridesHistory() throws {
        let messages = [assistantMessage(activities: [goalActivity(id: "g1", active: true, objective: "Old")])]
        let active: [AgentActivity] = [.goalUpdate(goalValue(id: "g2", active: true, objective: "Live"))]

        let state = try #require(deriveGoalState(from: messages, activeAgentActivities: active))
        #expect(state.id == "g2")
        #expect(state.objective == "Live")
    }

    @Test
    func returnsNilWithoutGoals() {
        let messages = [assistantMessage(activities: [
            .planUpdate(AgentActivity.PlanUpdate(id: "p1", steps: []))
        ])]

        #expect(deriveGoalState(from: messages) == nil)
    }

    // MARK: - Helpers

    private func goalValue(
        id: String,
        active: Bool,
        objective: String? = nil,
        status: String? = nil
    ) -> GoalState {
        GoalState(
            id: id,
            active: active,
            threadId: "thread-1",
            objective: objective,
            status: status,
            tokenBudget: nil,
            tokensUsed: nil,
            timeUsedSeconds: nil,
            createdAt: nil,
            updatedAt: nil
        )
    }

    private func goalActivity(
        id: String,
        active: Bool,
        objective: String? = nil,
        status: String? = nil
    ) -> AgentActivity {
        .goalUpdate(goalValue(id: id, active: active, objective: objective, status: status))
    }

    private func assistantMessage(activities: [AgentActivity]) -> ChatMessage {
        ChatMessage(
            id: "msg-1",
            sessionId: "session-1",
            role: .assistant,
            content: "",
            images: nil,
            toolCalls: nil,
            agentActivities: activities,
            thinkingContent: nil,
            timestamp: "2026-01-01T00:00:00Z",
            cancelled: nil,
            durationMs: nil
        )
    }
}

import Testing
@testable import HiveMobileStoresCore

struct GoalFormattingTests {
    @Test
    func headerMapsKnownStatuses() {
        #expect(GoalFormatting.header(nil) == "Goal running")
        #expect(GoalFormatting.header("") == "Goal running")
        #expect(GoalFormatting.header("running") == "Goal running")
        #expect(GoalFormatting.header("in_progress") == "Goal running")
        #expect(GoalFormatting.header("completed") == "Goal reached")
        #expect(GoalFormatting.header("complete") == "Goal reached")
        #expect(GoalFormatting.header("paused") == "Goal paused")
        #expect(GoalFormatting.header("blocked") == "Goal blocked")
        #expect(GoalFormatting.header("usage_limited") == "Goal usage limited")
        #expect(GoalFormatting.header("budgetLimited") == "Goal budget limited")
        #expect(GoalFormatting.header("escalated") == "Goal escalated")
    }

    @Test
    func isCompleteRecognizesReachedStatuses() {
        #expect(GoalFormatting.isComplete("complete"))
        #expect(GoalFormatting.isComplete("completed"))
        #expect(!GoalFormatting.isComplete("running"))
        #expect(!GoalFormatting.isComplete(nil))
    }

    @Test
    func compactTokenCountMatchesCanonicalFormat() {
        #expect(compactTokenCount(0) == "0")
        #expect(compactTokenCount(842) == "842")
        #expect(compactTokenCount(1_000) == "1.0k")
        #expect(compactTokenCount(15_200) == "15.2k")
        #expect(compactTokenCount(99_999) == "100.0k")
        #expect(compactTokenCount(100_000) == "100k")
        #expect(compactTokenCount(123_456) == "123k")
        #expect(compactTokenCount(999_999) == "1.0m")
        #expect(compactTokenCount(1_000_000) == "1.0m")
        #expect(compactTokenCount(1_500_000) == "1.5m")
    }

    @Test
    func elapsedFormatsSecondsMinutesHours() {
        #expect(GoalFormatting.elapsed(45) == "45s")
        #expect(GoalFormatting.elapsed(125) == "2m 5s")
        #expect(GoalFormatting.elapsed(300) == "5m")
        #expect(GoalFormatting.elapsed(3_600) == "1h")
        #expect(GoalFormatting.elapsed(3_900) == "1h 5m")
        #expect(GoalFormatting.elapsed(-5) == "0s")
    }

    @Test
    func tokensFormatsAllBranches() {
        #expect(GoalFormatting.tokens(goal(used: 1_200, budget: 10_000)) == "1.2k/10.0k")
        #expect(GoalFormatting.tokens(goal(used: 1_200, budget: nil)) == "1.2k used")
        #expect(GoalFormatting.tokens(goal(used: nil, budget: 10_000)) == "0/10.0k")
        #expect(GoalFormatting.tokens(goal(used: nil, budget: nil)) == nil)
    }

    @Test
    func headerMetaJoinsTokensAndElapsed() {
        #expect(GoalFormatting.headerMeta(goal(used: 1_200, budget: 10_000, time: 125)) == "1.2k/10.0k · 2m 5s")
        #expect(GoalFormatting.headerMeta(goal(used: nil, budget: nil, time: nil)) == nil)
    }

    @Test
    func objectiveFallsBackWhenEmpty() {
        #expect(GoalFormatting.objective(goal(objective: "  Ship it  ")) == "Ship it")
        #expect(GoalFormatting.objective(goal(objective: "   ")) == "Goal running")
        #expect(GoalFormatting.objective(goal(objective: nil)) == "Goal running")
    }

    // MARK: - Helpers

    private func goal(
        objective: String? = nil,
        used: Int? = nil,
        budget: Int? = nil,
        time: Int? = nil
    ) -> GoalState {
        GoalState(
            id: "g1",
            active: true,
            threadId: "thread-1",
            objective: objective,
            status: "running",
            tokenBudget: budget,
            tokensUsed: used,
            timeUsedSeconds: time,
            createdAt: nil,
            updatedAt: nil
        )
    }
}

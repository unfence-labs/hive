import Foundation

// MARK: - Goal Derivation
//
// Pure function that derives the active Codex goal from conversation messages.
// Direct port of `frontend/src/hooks/useGoalState.ts`.

func deriveGoalHistory(from messages: [ChatMessage]) -> GoalState? {
    var latest: GoalState?
    for message in messages {
        for activity in message.agentActivities ?? [] {
            fold(activity, into: &latest)
        }
    }
    return latest
}

/// Derive the latest active goal from history + active (streaming) agent activities.
/// Returns `nil` when the most recent goal update is inactive (goal cleared).
func deriveGoalState(
    from messages: [ChatMessage],
    activeAgentActivities: [AgentActivity] = []
) -> GoalState? {
    deriveGoalState(
        history: deriveGoalHistory(from: messages),
        activeAgentActivities: activeAgentActivities
    )
}

func deriveGoalState(
    history: GoalState?,
    activeAgentActivities: [AgentActivity]
) -> GoalState? {
    var latest = history
    for activity in activeAgentActivities {
        fold(activity, into: &latest)
    }
    return latest
}

private func fold(_ activity: AgentActivity, into latest: inout GoalState?) {
    guard case .goalUpdate(let goal) = activity else { return }
    latest = goal.active ? goal : nil
}

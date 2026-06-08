import Foundation

// MARK: - Goal Derivation
//
// Pure function that derives the active Codex goal from conversation messages.
// Direct port of `frontend/src/hooks/useGoalState.ts`.

/// Derive the latest active goal from history + active (streaming) agent activities.
/// Returns `nil` when the most recent goal update is inactive (goal cleared).
func deriveGoalState(
    from messages: [ChatMessage],
    activeAgentActivities: [AgentActivity] = []
) -> GoalState? {
    var latest: GoalState?

    func read(_ activity: AgentActivity) {
        guard case .goalUpdate(let goal) = activity else { return }
        latest = goal.active ? goal : nil
    }

    for message in messages {
        for activity in message.agentActivities ?? [] {
            read(activity)
        }
    }
    for activity in activeAgentActivities {
        read(activity)
    }

    return latest
}

import Foundation

// MARK: - Goal Formatting
//
// Pure helpers for rendering the goal panel. Direct port of the formatting
// functions in `frontend/src/components/TaskTracker.tsx`.

enum GoalFormatting {
    /// Human-readable header for the collapsed goal row, derived from the status.
    static func header(_ status: String?) -> String {
        let normalized = normalizeStatus(status)
        switch normalized {
        case "", "running", "in progress":
            return "Goal running"
        case "complete", "completed":
            return "Goal reached"
        case "paused":
            return "Goal paused"
        case "blocked":
            return "Goal blocked"
        case "usage limited":
            return "Goal usage limited"
        case "budget limited":
            return "Goal budget limited"
        default:
            return "Goal \(normalized)"
        }
    }

    static func isComplete(_ status: String?) -> Bool {
        let normalized = normalizeStatus(status)
        return normalized == "complete" || normalized == "completed"
    }

    /// Token usage string, e.g. "1.2k/10.0k", "1.2k used", "0/10.0k", or nil.
    static func tokens(_ goal: GoalState) -> String? {
        let used = goal.tokensUsed
        let budget = goal.tokenBudget
        if let used, let budget {
            return "\(compactTokenCount(used))/\(compactTokenCount(budget))"
        }
        if let used {
            return "\(compactTokenCount(used)) used"
        }
        if let budget {
            return "0/\(compactTokenCount(budget))"
        }
        return nil
    }

    /// Elapsed time, e.g. "45s", "5m 30s", "2h 10m".
    static func elapsed(_ seconds: Int) -> String {
        let total = max(0, seconds)
        if total < 60 { return "\(total)s" }
        let minutes = total / 60
        let remainderSeconds = total % 60
        if minutes < 60 {
            return remainderSeconds > 0 ? "\(minutes)m \(remainderSeconds)s" : "\(minutes)m"
        }
        let hours = minutes / 60
        let remainderMinutes = minutes % 60
        return remainderMinutes > 0 ? "\(hours)h \(remainderMinutes)m" : "\(hours)h"
    }

    /// Collapsed-row trailing metadata: "tokens · elapsed" (omitting missing parts).
    static func headerMeta(_ goal: GoalState) -> String? {
        var parts: [String] = []
        if let tokens = tokens(goal) { parts.append(tokens) }
        if let seconds = goal.timeUsedSeconds { parts.append(elapsed(seconds)) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func objective(_ goal: GoalState) -> String {
        let trimmed = goal.objective?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed?.isEmpty == false ? trimmed : nil) ?? "Goal running"
    }

    private static func normalizeStatus(_ status: String?) -> String {
        guard let status else { return "" }
        var value = status.trimmingCharacters(in: .whitespacesAndNewlines)
        value = value.replacingOccurrences(
            of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
        value = value.replacingOccurrences(
            of: "[-_]+", with: " ", options: .regularExpression)
        return value.lowercased()
    }
}

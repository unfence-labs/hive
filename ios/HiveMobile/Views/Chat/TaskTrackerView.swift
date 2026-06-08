import SwiftUI

struct TaskTrackerView: View {
    var goal: GoalState?
    let tasks: [TrackedTask]
    let currentTask: TrackedTask?
    let counts: TaskCounts
    let trackerStatus: TaskTrackerStatus
    var backgroundAgents: [BackgroundAgent] = []
    var backgroundRunningCount: Int = 0
    let isStreaming: Bool

    private var hasGoal: Bool { goal != nil }
    private var hasTasks: Bool { !tasks.isEmpty }
    private var hasAgents: Bool { !backgroundAgents.isEmpty }

    var body: some View {
        if hasGoal || hasTasks || hasAgents {
            GlassEffectContainer {
                VStack(alignment: .leading, spacing: 0) {
                    if let goal {
                        let complete = GoalFormatting.isComplete(goal.status)
                        TrackerSection(
                            label: GoalFormatting.header(goal.status),
                            trailing: GoalFormatting.headerMeta(goal),
                            isShimmering: isStreaming && !complete
                        ) {
                            goalRow(goal, complete: complete)
                        }
                    }

                    if hasGoal && (hasTasks || hasAgents) {
                        sectionDivider
                    }

                    if hasTasks {
                        TrackerSection(
                            label: collapsedLabel,
                            trailing: "\(counts.completed)/\(counts.total)",
                            isShimmering: currentTask != nil && isStreaming && !isUnconfirmed
                        ) {
                            ForEach(tasks) { task in
                                taskRow(task)
                            }
                        }
                    }

                    if hasTasks && hasAgents {
                        sectionDivider
                    }

                    if hasAgents {
                        let completed = backgroundAgents.count - backgroundRunningCount
                        TrackerSection(
                            label: agentLabel,
                            trailing: "\(completed)/\(backgroundAgents.count)",
                            isShimmering: backgroundRunningCount > 0 && isStreaming
                        ) {
                            ForEach(backgroundAgents) { agent in
                                agentRow(agent)
                            }
                        }
                    }
                }
                .padding(.horizontal, HiveSpacing.lg)
                .padding(.vertical, HiveSpacing.sm)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal, HiveSpacing.md)
            .padding(.vertical, HiveSpacing.xs)
        }
    }

    // MARK: - Labels

    private var collapsedLabel: String {
        if isUnconfirmed {
            let unconfirmed = counts.pending + counts.inProgress
            return unconfirmed == 1 ? "1 task unconfirmed" : "\(unconfirmed) tasks unconfirmed"
        }
        if let current = currentTask {
            return current.activeForm ?? current.subject
        }
        if counts.completed == counts.total {
            return "All tasks completed"
        }
        let remaining = counts.total - counts.completed
        let hasOnlyOpenTasks = remaining == counts.pending + counts.inProgress
        if hasOnlyOpenTasks {
            return remaining == 1 ? "1 task remaining" : "\(remaining) tasks remaining"
        }
        return remaining == 1 ? "1 task not completed" : "\(remaining) tasks not completed"
    }

    private var agentLabel: String {
        if backgroundRunningCount > 0 {
            return backgroundRunningCount == 1
                ? "1 background agent running"
                : "\(backgroundRunningCount) background agents running"
        }
        return "All background agents completed"
    }

    private var isUnconfirmed: Bool {
        trackerStatus == .unconfirmed
    }

    // MARK: - Rows

    private func goalRow(_ goal: GoalState, complete: Bool) -> some View {
        HStack(alignment: .top, spacing: HiveSpacing.sm) {
            taskStatusIcon(complete ? .completed : .pending, unconfirmed: false)
                .frame(width: 14, alignment: .center)

            Text(GoalFormatting.objective(goal))
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 1)
    }

    private func taskRow(_ task: TrackedTask) -> some View {
        HStack(spacing: HiveSpacing.sm) {
            taskStatusIcon(task.status, unconfirmed: isUnconfirmed)
                .frame(width: 14, alignment: .center)

            Text(task.status == .inProgress
                 ? (task.activeForm ?? task.subject)
                 : task.subject)
                .font(WhisperFont.mono(12))
                .foregroundStyle(textStyle(for: task.status, unconfirmed: isUnconfirmed))
                .strikethrough(task.status == .completed)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.vertical, 1)
    }

    private func agentRow(_ agent: BackgroundAgent) -> some View {
        HStack(spacing: HiveSpacing.sm) {
            agentStatusIcon(isRunning: agent.isRunning)
                .frame(width: 14, alignment: .center)

            Text(agent.subagentType)
                .font(WhisperFont.mono(12).weight(.medium))
                .foregroundStyle(WhisperColor.textMuted)

            Text(agent.description)
                .font(WhisperFont.mono(12))
                .foregroundStyle(agent.isRunning ? WhisperColor.text : WhisperColor.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.vertical, 1)
    }

    private var sectionDivider: some View {
        Rectangle()
            .fill(WhisperColor.textMuted.opacity(0.15))
            .frame(height: 0.5)
            .padding(.vertical, 4)
    }

    // MARK: - Status Icons

    @ViewBuilder
    private func taskStatusIcon(_ status: TaskStatus, unconfirmed: Bool) -> some View {
        if unconfirmed && (status == .pending || status == .inProgress) {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(WhisperColor.textMuted)
        } else {
            switch status {
            case .completed:
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(WhisperColor.success)
            case .inProgress:
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 7, height: 7)
                    .modifier(PulsingDotModifier())
            case .pending:
                Circle()
                    .stroke(WhisperColor.textMuted, lineWidth: 1)
                    .frame(width: 9, height: 9)
            case .failed, .declined:
                Image(systemName: "xmark.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(WhisperColor.danger)
            }
        }
    }

    @ViewBuilder
    private func agentStatusIcon(isRunning: Bool) -> some View {
        if isRunning {
            Circle()
                .fill(Color.accentColor)
                .frame(width: 7, height: 7)
                .modifier(PulsingDotModifier())
        } else {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(WhisperColor.success)
        }
    }

    private func textStyle(for status: TaskStatus, unconfirmed: Bool) -> Color {
        if unconfirmed && (status == .pending || status == .inProgress) {
            return WhisperColor.textMuted
        }
        switch status {
        case .completed: return WhisperColor.textMuted
        case .inProgress: return WhisperColor.text
        case .pending: return WhisperColor.textSecondary
        case .failed, .declined: return WhisperColor.danger
        }
    }
}

// MARK: - Pulsing Dot

private struct PulsingDotModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.4 : 1.0)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear { isPulsing = true }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 0) {
        Spacer()
        TaskTrackerView(
            goal: GoalState(
                id: "goal-1",
                active: true,
                threadId: "thread-1",
                objective: "Ship the Codex Goals UI on iOS",
                status: "running",
                tokenBudget: 100_000,
                tokensUsed: 15_200,
                timeUsedSeconds: 125,
                createdAt: nil,
                updatedAt: nil
            ),
            tasks: [
                TrackedTask(id: "1", subject: "Set up database schema", status: .completed, isCreating: false),
                TrackedTask(id: "2", subject: "Implement API endpoints", activeForm: "Implementing API endpoints", status: .inProgress, isCreating: false),
                TrackedTask(id: "3", subject: "Write integration tests", status: .pending, isCreating: false),
            ],
            currentTask: TrackedTask(id: "2", subject: "Implement API endpoints", activeForm: "Implementing API endpoints", status: .inProgress, isCreating: false),
            counts: TaskCounts(total: 3, completed: 1, inProgress: 1, pending: 1),
            trackerStatus: .live,
            backgroundAgents: [
                BackgroundAgent(toolId: "a1", subagentType: "Explore", description: "Search for callers", model: nil, isRunning: true),
            ],
            backgroundRunningCount: 1,
            isStreaming: true
        )
    }
    .preferredColorScheme(.dark)
}

import SwiftUI

struct TaskTrackerView: View {
    let tasks: [TrackedTask]
    let currentTask: TrackedTask?
    let counts: TaskCounts
    let isStreaming: Bool

    @State private var isExpanded = false

    var body: some View {
        if !tasks.isEmpty {
            GlassEffectContainer {
                VStack(alignment: .leading, spacing: 0) {
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            isExpanded.toggle()
                        }
                    } label: {
                        collapsedRow
                    }
                    .buttonStyle(.plain)

                    if isExpanded {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(tasks) { task in
                                taskRow(task)
                            }
                        }
                        .padding(.top, 6)
                        .padding(.bottom, 2)
                        .transition(.opacity.combined(with: .move(edge: .top)))
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

    // MARK: - Collapsed Row

    private var collapsedLabel: String {
        if let current = currentTask {
            return current.activeForm ?? current.subject
        }
        return "All tasks completed"
    }

    private var collapsedRow: some View {
        HStack(spacing: HiveSpacing.sm) {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))

            Group {
                if currentTask != nil && isStreaming {
                    Text(collapsedLabel)
                        .shimmer()
                } else {
                    Text(collapsedLabel)
                }
            }
            .font(WhisperFont.mono(12))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)

            Text("\(counts.completed)/\(counts.total)")
                .font(WhisperFont.mono(11))
                .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }

    // MARK: - Task Row (expanded)

    private func taskRow(_ task: TrackedTask) -> some View {
        HStack(spacing: HiveSpacing.sm) {
            taskStatusIcon(task.status)
                .frame(width: 14, alignment: .center)

            Text(task.status == .inProgress
                 ? (task.activeForm ?? task.subject)
                 : task.subject)
                .font(WhisperFont.mono(12))
                .foregroundStyle(textStyle(for: task.status))
                .strikethrough(task.status == .completed)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.leading, 20)
        .padding(.vertical, 1)
    }

    // MARK: - Status Icons

    @ViewBuilder
    private func taskStatusIcon(_ status: TaskStatus) -> some View {
        switch status {
        case .completed:
            Image(systemName: "checkmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(.green)
        case .inProgress:
            Circle()
                .fill(Color.accentColor)
                .frame(width: 7, height: 7)
                .modifier(PulsingDotModifier())
        case .pending:
            Circle()
                .stroke(.tertiary, lineWidth: 1)
                .frame(width: 9, height: 9)
        }
    }

    private func textStyle(for status: TaskStatus) -> HierarchicalShapeStyle {
        switch status {
        case .completed: .tertiary
        case .inProgress: .primary
        case .pending: .secondary
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
            tasks: [
                TrackedTask(id: "1", subject: "Set up database schema", status: .completed, isCreating: false),
                TrackedTask(id: "2", subject: "Implement API endpoints", activeForm: "Implementing API endpoints", status: .inProgress, isCreating: false),
                TrackedTask(id: "3", subject: "Write integration tests", status: .pending, isCreating: false),
            ],
            currentTask: TrackedTask(id: "2", subject: "Implement API endpoints", activeForm: "Implementing API endpoints", status: .inProgress, isCreating: false),
            counts: TaskCounts(total: 3, completed: 1, inProgress: 1, pending: 1),
            isStreaming: true
        )
    }
    .preferredColorScheme(.dark)
}

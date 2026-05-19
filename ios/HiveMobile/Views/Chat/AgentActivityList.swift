import SwiftUI

struct AgentActivityList: View {
    let activities: [AgentActivity]
    var showExecutingState = false

    var body: some View {
        if !activities.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(activities) { activity in
                    AgentActivityRow(activity: activity, showExecutingState: showExecutingState)
                }
            }
            .padding(.top, 2)
        }
    }
}

private struct AgentActivityRow: View {
    let activity: AgentActivity
    let showExecutingState: Bool

    var body: some View {
        switch activity {
        case .commandExecution(let command):
            CommandExecutionActivityRow(activity: command, showExecutingState: showExecutingState)
        case .fileChange(let fileChange):
            FileChangeActivityRow(activity: fileChange)
        case .planUpdate(let plan):
            PlanUpdateActivityRow(activity: plan)
        case .diagnostic(let diagnostic):
            DiagnosticActivityRow(activity: diagnostic)
        case .unknown(let unknown):
            UnknownActivityRow(activity: unknown)
        }
    }
}

private struct CommandExecutionActivityRow: View {
    let activity: AgentActivity.CommandExecution
    let showExecutingState: Bool

    private var command: String {
        guard let command = activity.command, !command.isEmpty else { return "(command pending)" }
        return command
    }

    private var isRunning: Bool {
        showExecutingState && (activity.status == nil || activity.status == "inProgress")
    }

    var body: some View {
        ActivityDisclosureRow(
            icon: "terminal",
            title: "Command",
            detail: command,
            status: activity.status,
            defaultOpen: isRunning,
            executing: isRunning
        ) {
            VStack(alignment: .leading, spacing: 8) {
                Text("$ \(command)")
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .textSelection(.enabled)

                if let cwd = activity.cwd, !cwd.isEmpty {
                    Text("cwd: \(cwd)")
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    if let exitCode = activity.exitCode {
                        Text("exit \(exitCode)")
                    }
                    if let durationMs = activity.durationMs {
                        Text(formatDuration(durationMs))
                    }
                }
                .font(WhisperFont.mono(10))
                .foregroundStyle(WhisperColor.textMuted)

                if let output = activity.output {
                    Text(output.isEmpty ? "(no output)" : output)
                        .font(WhisperFont.mono(11))
                        .foregroundStyle(WhisperColor.textSecondary)
                        .textSelection(.enabled)
                        .lineLimit(80)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct FileChangeActivityRow: View {
    let activity: AgentActivity.FileChange

    private var stats: (added: Int, removed: Int) {
        activity.files.reduce((added: 0, removed: 0)) { total, file in
            guard let diff = file.diff else { return total }
            let stats = parseDiffStats(diff)
            return (total.added + stats.added, total.removed + stats.removed)
        }
    }

    private var summary: String {
        let count = activity.files.count
        let fileLabel = "\(count) file\(count == 1 ? "" : "s")"
        let stats = stats
        var parts = [fileLabel]
        if stats.added > 0 { parts.append("+\(stats.added)") }
        if stats.removed > 0 { parts.append("-\(stats.removed)") }
        return parts.joined(separator: " ")
    }

    var body: some View {
        ActivityDisclosureRow(
            icon: "pencil",
            title: "File changes",
            detail: summary,
            status: activity.status
        ) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(activity.files) { file in
                    FileChangeFileView(file: file)
                }
            }
        }
    }
}

private struct FileChangeFileView: View {
    let file: AgentActivityFile

    private var stats: (added: Int, removed: Int) {
        file.diff.map(parseDiffStats) ?? (0, 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(file.path)
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)

                if let kind = file.kind {
                    ChatActivityBadge(text: readableActivityStatus(kind))
                }

                if stats.added > 0 {
                    Text("+\(stats.added)")
                        .foregroundStyle(.green)
                }
                if stats.removed > 0 {
                    Text("-\(stats.removed)")
                        .foregroundStyle(.red)
                }
            }
            .font(WhisperFont.mono(10))

            if let diff = file.diff, !diff.isEmpty {
                DiffLinesView(lines: parseUnifiedDiffLines(diff), maxLines: 120)
            } else {
                Text("No diff available.")
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
            }
        }
    }
}

private struct PlanUpdateActivityRow: View {
    let activity: AgentActivity.PlanUpdate

    private var completeCount: Int {
        activity.steps.filter { $0.status == "completed" }.count
    }

    var body: some View {
        ActivityDisclosureRow(
            icon: "checklist",
            title: "Plan",
            detail: "\(completeCount)/\(activity.steps.count) complete",
            defaultOpen: activity.steps.contains { $0.status == "inProgress" || $0.status == "in_progress" }
        ) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(activity.steps.enumerated()), id: \.offset) { _, step in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: planStepIcon(step.status))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(planStepColor(step.status))
                            .frame(width: 14, height: 14)
                        Text(step.text)
                            .font(.system(size: 12))
                            .foregroundStyle(step.status == "completed" ? WhisperColor.textMuted : WhisperColor.textSecondary)
                            .strikethrough(step.status == "completed")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private func planStepIcon(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.circle.fill"
        case "inProgress", "in_progress": "arrow.triangle.2.circlepath"
        case "failed", "declined": "xmark.circle.fill"
        default: "circle"
        }
    }

    private func planStepColor(_ status: String) -> Color {
        switch status {
        case "completed": .green
        case "inProgress", "in_progress": WhisperColor.textSecondary
        case "failed", "declined": .red
        default: WhisperColor.textMuted
        }
    }
}

private struct DiagnosticActivityRow: View {
    let activity: AgentActivity.Diagnostic

    var body: some View {
        ActivityDisclosureRow(
            icon: diagnosticIcon,
            title: activity.title,
            detail: activity.method,
            status: activity.severity.rawValue
        ) {
            VStack(alignment: .leading, spacing: 8) {
                Text(activity.message)
                    .font(.system(size: 12))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let details = activity.details, !details.isEmpty {
                    Text(details)
                        .font(WhisperFont.mono(10))
                        .foregroundStyle(WhisperColor.textMuted)
                        .textSelection(.enabled)
                        .lineLimit(80)
                }
            }
        }
    }

    private var diagnosticIcon: String {
        switch activity.severity {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.circle"
        }
    }
}

private struct UnknownActivityRow: View {
    let activity: AgentActivity.Unknown

    var body: some View {
        ActivityDisclosureRow(
            icon: "questionmark.circle",
            title: "Unsupported activity",
            detail: activity.kind
        ) {
            Text(activity.kind)
                .font(.system(size: 12))
                .foregroundStyle(WhisperColor.textMuted)
        }
    }
}

private struct ActivityDisclosureRow<Content: View>: View {
    let icon: String
    let title: String
    var detail: String?
    var status: String?
    var defaultOpen = false
    var executing = false
    let content: Content

    @State private var isExpanded: Bool

    init(
        icon: String,
        title: String,
        detail: String? = nil,
        status: String? = nil,
        defaultOpen: Bool = false,
        executing: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.icon = icon
        self.title = title
        self.detail = detail
        self.status = status
        self.defaultOpen = defaultOpen
        self.executing = executing
        self.content = content()
        _isExpanded = State(initialValue: defaultOpen)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                ChatActivityRowLabel(
                    icon: icon,
                    label: title,
                    detail: detail,
                    badgeText: status.flatMap { $0.isEmpty ? nil : readableActivityStatus($0) },
                    isExpanded: isExpanded,
                    executing: executing
                )
            }
            .buttonStyle(.plain)

            if isExpanded {
                ToolContentPanel {
                    content
                }
                .transition(.opacity)
            }
        }
    }
}

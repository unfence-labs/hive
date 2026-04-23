import SwiftUI

struct HubActivitySummary {
    var streaming = 0
    var completed = 0
    var needsAttention = 0

    var visualState: HubActivityVisualState {
        if streaming > 0 { return .streaming }
        if completed > 0 { return .completed }
        return .idle
    }
}

enum HubActivityVisualState {
    case streaming
    case completed
    case idle
}

struct HubFolderHeader: View {
    let title: String
    let projectCount: Int
    let workspaceCount: Int
    let isExpanded: Bool
    let activity: HubActivitySummary
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: HiveSpacing.sm) {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .frame(width: 12)

                HubFolderIcon(isExpanded: isExpanded, activityState: activity.visualState)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: HiveSpacing.sm)

                Text("\(projectCount)")
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 18, alignment: .trailing)

                Text("\(workspaceCount) ws")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, HiveSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.white.opacity(0.06))
                    .stroke(.white.opacity(0.08), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(projectCount) projects, \(workspaceCount) workspaces")
    }
}

struct HubProjectRow: View {
    let project: Project
    let isExpanded: Bool
    let activity: HubActivitySummary
    let isCreatingWorkspace: Bool
    let onToggle: () -> Void
    let onAddWorkspace: () -> Void

    private var displayName: HubProjectDisplayName {
        HubProjectDisplay.name(for: project)
    }

    var body: some View {
        HStack(spacing: HiveSpacing.sm) {
            Button(action: onToggle) {
                HStack(spacing: HiveSpacing.sm) {
                    HubProjectIcon(project: project, activityState: activity.visualState)

                    VStack(alignment: .leading, spacing: 1) {
                        projectTitle

                        Text("\(project.workspaces.count) workspaces")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }

                    Spacer(minLength: HiveSpacing.sm)

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .frame(width: 12)
                }
                .frame(maxWidth: .infinity, minHeight: 42)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(displayName.plain)

            Button(action: onAddWorkspace) {
                Group {
                    if isCreatingWorkspace {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "plus")
                            .font(.caption.weight(.semibold))
                    }
                }
                .frame(width: 28, height: 28)
                .background(.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(isCreatingWorkspace)
            .accessibilityLabel("Add workspace to \(displayName.plain)")
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var projectTitle: some View {
        if let owner = displayName.owner {
            Text("\(Text("\(owner)/").foregroundStyle(.secondary))\(Text(displayName.repo).foregroundStyle(.primary))")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        } else {
            Text(displayName.repo)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
    }
}

struct HubWorkspaceRow: View {
    let workspace: Workspace
    let isStreaming: Bool
    let turnCompleted: Bool
    let diffStats: DiffStatResponse?
    let prStatus: PrStatusResponse?

    private var diffSummary: HubDiffSummary {
        HubDiffSummary(diffStats: diffStats)
    }

    var body: some View {
        HStack(alignment: .center, spacing: HiveSpacing.sm) {
            workspaceStatus
                .frame(width: 14, height: 14)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.sm) {
                    Text(workspace.branch)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer(minLength: 0)

                    Text(workspace.name)
                        .font(.caption2)
                        .lineLimit(1)
                        .foregroundStyle(.tertiary)
                }

                HStack(spacing: HiveSpacing.sm) {
                    HubPrBadge(prStatus: prStatus)
                    Spacer(minLength: 0)

                    if diffSummary.hasChanges {
                        HubDiffBadge(
                            additions: diffSummary.additions,
                            deletions: diffSummary.deletions
                        )
                    }
                }
                .font(.caption2)
            }
        }
        .padding(.horizontal, 2)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(.white.opacity(0.05))
                .frame(height: 0.5)
        }
    }

    @ViewBuilder
    private var workspaceStatus: some View {
        if isStreaming {
            AgentActivityIndicator(dotSize: 3, spacing: 1.5)
        } else if turnCompleted {
            CompletedDot()
        } else {
            StatusDot()
        }
    }
}

private struct HubFolderIcon: View {
    let isExpanded: Bool
    let activityState: HubActivityVisualState

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: isExpanded ? "folder.fill" : "folder")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 20, height: 20)

            HubActivityDot(state: activityState)
                .offset(x: 3, y: -3)
        }
        .frame(width: 20, height: 20)
    }
}

private struct HubProjectIcon: View {
    let project: Project
    let activityState: HubActivityVisualState

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ProjectAvatar(project: project)

            HubActivityDot(state: activityState)
                .offset(x: 3, y: -3)
        }
        .frame(width: 20, height: 20)
    }
}

private struct HubActivityDot: View {
    let state: HubActivityVisualState

    var body: some View {
        switch state {
        case .streaming:
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.28))
                    .frame(width: 11, height: 11)
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 7, height: 7)
            }
            .accessibilityLabel("Agent is working")
        case .completed:
            Circle()
                .fill(.green)
                .frame(width: 7, height: 7)
                .shadow(color: .green.opacity(0.45), radius: 4)
                .accessibilityLabel("Unread activity")
        case .idle:
            EmptyView()
        }
    }
}

private struct HubDiffBadge: View {
    let additions: Int
    let deletions: Int

    var body: some View {
        HStack(spacing: 5) {
            if additions > 0 {
                Text("+\(additions)")
                    .foregroundStyle(.green)
            }
            if deletions > 0 {
                Text("-\(deletions)")
                    .foregroundStyle(.red)
            }
        }
        .font(.caption2.monospacedDigit().weight(.medium))
    }
}

private struct HubPrBadge: View {
    let prStatus: PrStatusResponse?

    var body: some View {
        if let pr = prStatus?.pr {
            let display = HubPrDisplay(pr: pr)
            HStack(spacing: 3) {
                Image(systemName: display.icon)
                Text("#\(pr.number) \(display.label)")
                    .lineLimit(1)
            }
            .foregroundStyle(display.color)
        } else {
            Text("No PR")
                .foregroundStyle(.tertiary)
        }
    }
}

private struct HubPrDisplay {
    let icon: String
    let label: String
    let color: Color

    init(pr: PullRequestInfo) {
        let checksCount = Self.checksCountLabel(pr)

        if pr.state == .merged {
            self.init(icon: "arrow.triangle.merge", label: "Merged", color: .purple)
        } else if pr.state == .closed {
            self.init(icon: "xmark.circle", label: "Closed", color: .secondary)
        } else if pr.state == .draft {
            self.init(icon: "pencil.circle", label: "Draft", color: .secondary)
        } else if pr.mergeable == false || pr.mergeableState == .conflict {
            self.init(icon: "exclamationmark.triangle", label: "Conflicts", color: .orange)
        } else if pr.checksStatus == .failure {
            self.init(icon: "xmark.circle", label: "Failed\(checksCount)", color: .red)
        } else if pr.checksStatus == .cancelled {
            self.init(icon: "nosign", label: "Cancelled", color: .orange)
        } else if pr.checksStatus == .pending {
            self.init(icon: "clock", label: "Checks\(checksCount)", color: .yellow)
        } else if pr.reviewStatus == .changes_requested {
            self.init(icon: "exclamationmark.triangle", label: "Changes", color: .orange)
        } else if pr.mergeableState == .blocked {
            self.init(icon: "nosign", label: "Blocked", color: .orange)
        } else if pr.mergeableState == .unstable {
            self.init(icon: "exclamationmark.triangle", label: "Unstable", color: .yellow)
        } else if pr.reviewStatus == .review_required {
            self.init(icon: "eye", label: "Review", color: .blue)
        } else if pr.mergeable == true || pr.mergeableState == .clean {
            self.init(icon: "checkmark.circle", label: "Ready", color: .green)
        } else {
            self.init(icon: "arrow.triangle.pull", label: "Open", color: .blue)
        }
    }

    private init(icon: String, label: String, color: Color) {
        self.icon = icon
        self.label = label
        self.color = color
    }

    private static func checksCountLabel(_ pr: PullRequestInfo) -> String {
        guard let passed = pr.checksPassed, let total = pr.checksTotal else { return "" }
        return " \(passed)/\(total)"
    }
}

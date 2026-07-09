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
                HubFolderIcon(isExpanded: isExpanded, activityState: activity.visualState)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)

                Spacer(minLength: HiveSpacing.sm)

                Text("\(projectCount)")
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .frame(minWidth: 18, alignment: .trailing)

                Text("\(workspaceCount) ws")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)
            }
            .padding(.horizontal, HiveSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(WhisperColor.hubCardFill)
                    .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(projectCount) projects, \(workspaceCount) workspaces")
    }
}

struct HubProjectRow: View {
    let project: Project
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
                            .foregroundStyle(WhisperColor.textMuted)
                    }

                    Spacer(minLength: HiveSpacing.sm)
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
                .background(WhisperColor.toolIconBg, in: Circle())
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
            Text("\(Text("\(owner)/").foregroundStyle(WhisperColor.textSecondary))\(Text(displayName.repo).foregroundStyle(WhisperColor.text))")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        } else {
            Text(displayName.repo)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WhisperColor.text)
                .lineLimit(1)
        }
    }
}

struct HubWorkspaceRow: View {
    let workspace: Workspace
    let monitor: HubStatusMonitor

    private var isStreaming: Bool { monitor.isStreaming(workspace.id) }
    private var turnCompleted: Bool {
        monitor.isCompleted(workspace.id) || monitor.hasUnreadSessions(workspace.id)
    }
    private var diffStats: DiffStatResponse? { monitor.diffStats(for: workspace.id) }
    private var prStatus: PrStatusResponse? { monitor.prStatus(for: workspace.id) }
    private var isPrStatusLoading: Bool { monitor.isPrStatusLoading(workspace.id) }

    private var diffSummary: HubDiffSummary {
        HubDiffSummary(diffStats: diffStats)
    }

    var body: some View {
        HStack(alignment: .top, spacing: HiveSpacing.sm) {
            workspaceStatus
                .frame(width: 14, height: 14)
                .padding(.top, 3)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: HiveSpacing.sm) {
                    Text(workspace.branch)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WhisperColor.text)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer(minLength: 0)

                    Text(workspace.name)
                        .font(.caption2)
                        .lineLimit(1)
                        .foregroundStyle(WhisperColor.textMuted)
                }

                HStack(spacing: HiveSpacing.sm) {
                    HubPrBadge(prStatus: prStatus, isLoading: isPrStatusLoading)
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
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var workspaceStatus: some View {
        if isStreaming {
            AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                .accessibilityLabel("Streaming")
        } else if turnCompleted {
            UnreadDot()
                .accessibilityLabel("Unread activity")
        } else {
            StatusDot()
                .accessibilityHidden(true)
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
                .foregroundStyle(WhisperColor.textSecondary)
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
            UnreadDot(size: 7, shadowRadius: 4)
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
                    .foregroundStyle(WhisperColor.success)
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
    let isLoading: Bool

    var body: some View {
        if let pr = prStatus?.pr {
            let display = HubPrStatusDisplay(pr: pr)
            HStack(spacing: 3) {
                Image(systemName: display.icon)
                Text("#\(pr.number) \(display.label)")
                    .lineLimit(1)
            }
            .foregroundStyle(display.color)
        } else if isLoading {
            Text("Loading")
                .foregroundStyle(WhisperColor.textMuted)
        } else {
            Text("No PR")
                .foregroundStyle(WhisperColor.textMuted)
        }
    }
}

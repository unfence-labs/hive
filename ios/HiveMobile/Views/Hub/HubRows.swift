import SwiftUI

struct HubActivitySummary {
    var streaming = 0
    var completed = 0
    var changed = 0
    var needsAttention = 0
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

                Image(systemName: isExpanded ? "folder.open" : "folder")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 20)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: HiveSpacing.sm)

                HubActivityPills(activity: activity)

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
                    ProjectAvatar(project: project)

                    VStack(alignment: .leading, spacing: 1) {
                        projectTitle

                        Text("\(project.workspaces.count) workspaces")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.tertiary)
                    }

                    Spacer(minLength: HiveSpacing.sm)

                    HubActivityPills(activity: activity)

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
    let sessionCount: Int?

    private var diffSummary: HubDiffSummary {
        HubDiffSummary(diffStats: diffStats)
    }

    var body: some View {
        HStack(alignment: .center, spacing: HiveSpacing.sm) {
            workspaceStatus
                .frame(width: 16, height: 16)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: HiveSpacing.sm) {
                    Text(workspace.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Spacer(minLength: HiveSpacing.sm)

                    if diffSummary.hasChanges {
                        HubDiffBadge(
                            additions: diffSummary.additions,
                            deletions: diffSummary.deletions
                        )
                    }
                }

                HStack(spacing: HiveSpacing.sm) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 10))
                        Text(workspace.branch)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .foregroundStyle(.secondary)

                    HubPrBadge(prStatus: prStatus)

                    Spacer(minLength: 0)

                    if let sessionCount, sessionCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "text.bubble")
                            Text("\(sessionCount)")
                        }
                        .foregroundStyle(.tertiary)
                    }
                }
                .font(.caption2)
            }
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, HiveSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .contentShape(Rectangle())
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.white.opacity(0.035))
                .stroke(.white.opacity(0.06), lineWidth: 0.5)
        )
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

private struct HubActivityPills: View {
    let activity: HubActivitySummary

    var body: some View {
        HStack(spacing: 4) {
            if activity.streaming > 0 {
                activityPill(systemImage: "bolt.fill", count: activity.streaming, color: .white)
            }
            if activity.completed > 0 {
                activityPill(systemImage: "checkmark.circle.fill", count: activity.completed, color: .green)
            }
            if activity.needsAttention > 0 {
                activityPill(systemImage: "exclamationmark.triangle.fill", count: activity.needsAttention, color: .orange)
            }
            if activity.changed > 0 {
                activityPill(systemImage: "plus.forwardslash.minus", count: activity.changed, color: .secondary)
            }
        }
    }

    private func activityPill(systemImage: String, count: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .semibold))
            Text("\(count)")
                .font(.caption2.monospacedDigit().weight(.medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(.white.opacity(0.07), in: Capsule())
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
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(.primary.opacity(0.18), in: Capsule())
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
            HStack(spacing: 3) {
                Image(systemName: "arrow.triangle.pull")
                Text("No PR")
            }
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

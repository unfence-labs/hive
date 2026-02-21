import SwiftUI

struct WorkspaceCard: View {
    let workspace: Workspace
    var isStreaming: Bool = false
    var diffStats: DiffStatResponse?
    var branchInfo: BranchInfo?
    var prStatus: PrStatusResponse?
    var sessionCount: Int?

    private var totalAdditions: Int {
        guard let stats = diffStats else { return 0 }
        return (stats.committed + stats.uncommitted).reduce(0) { $0 + $1.additions }
    }

    private var totalDeletions: Int {
        guard let stats = diffStats else { return 0 }
        return (stats.committed + stats.uncommitted).reduce(0) { $0 + $1.deletions }
    }

    private var hasChanges: Bool {
        totalAdditions > 0 || totalDeletions > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            // Header: name + activity indicator
            HStack(alignment: .top, spacing: HiveSpacing.sm) {
                Text(workspace.name)
                    .font(.headline)
                    .bold()
                    .lineLimit(2)
                Spacer(minLength: 0)
                if isStreaming {
                    AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                } else {
                    StatusDot(isStreaming: false)
                }
            }

            // Branch
            HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 10))
                Text(workspace.branch)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            // Diff badge (centered between branch and PR)
            if hasChanges {
                LineDiffBadge(additions: totalAdditions, deletions: totalDeletions)
            }

            Spacer(minLength: 0)

            // Bottom: PR status + sessions
            HStack(spacing: 6) {
                if let pr = prStatus?.pr {
                    PrBadge(pr: pr)
                } else {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.triangle.pull")
                        Text("No PR")
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                }

                Spacer(minLength: 0)

                if let count = sessionCount, count > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 9))
                        Text("\(count)")
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(HiveSpacing.lg)
        .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
        .contentShape(Rectangle())
        .glassCard()
    }
}

// MARK: - Line Diff Badge

struct LineDiffBadge: View {
    let additions: Int
    let deletions: Int

    var body: some View {
        HStack(spacing: 6) {
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
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(.primary.opacity(0.22), in: Capsule())
    }
}

// MARK: - PR Badge

struct PrBadge: View {
    let pr: PullRequestInfo

    private var checksCountLabel: String {
        guard let passed = pr.checksPassed, let total = pr.checksTotal else { return "" }
        return " (\(passed)/\(total))"
    }

    private var displayState: (icon: String, label: String, color: Color) {
        // 1. Merged
        if pr.state == .merged {
            return ("arrow.triangle.merge", "Merged", .purple)
        }
        // 2. Closed
        if pr.state == .closed {
            return ("xmark.circle", "Closed", .secondary)
        }
        // 3. Draft
        if pr.state == .draft {
            return ("pencil.circle", "Draft", .secondary)
        }
        // 4. Conflicts
        if pr.mergeable == false || pr.mergeableState == .conflict {
            return ("exclamationmark.triangle", "Conflicts", .orange)
        }
        // 5. Checks failing
        if pr.checksStatus == .failure {
            return ("xmark.circle", "Failed\(checksCountLabel)", .red)
        }
        // 6. Checks cancelled
        if pr.checksStatus == .cancelled {
            return ("nosign", "Cancelled", .orange)
        }
        // 7. Checks pending
        if pr.checksStatus == .pending {
            return ("clock", "Checks\(checksCountLabel)", .yellow)
        }
        // 8. Changes requested
        if pr.reviewStatus == .changes_requested {
            return ("exclamationmark.triangle", "Changes req.", .orange)
        }
        // 9. Blocked (branch protection)
        if pr.mergeableState == .blocked {
            return ("nosign", "Blocked", .orange)
        }
        // 10. Unstable
        if pr.mergeableState == .unstable {
            return ("exclamationmark.triangle", "Unstable", .yellow)
        }
        // 11. Review needed
        if pr.reviewStatus == .review_required {
            return ("eye", "Review needed", .blue)
        }
        // 12. Ready to merge
        if pr.mergeable == true || pr.mergeableState == .clean {
            return ("checkmark.circle", "Ready", .green)
        }
        // 13. Fallback
        return ("arrow.triangle.pull", "Open", .blue)
    }

    var body: some View {
        let state = displayState
        HStack(spacing: 3) {
            Image(systemName: state.icon)
            Text("#\(pr.number) \u{00B7} \(state.label)")
        }
        .font(.caption2)
        .foregroundStyle(state.color)
    }
}

// MARK: - Preview

#Preview {
    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
        WorkspaceCard(
            workspace: Workspace(
                id: "1", name: "san-antonio-v1", branch: "0xlny/ios-swift-app",
                status: .busy, createdAt: "", activeSessionId: nil,
                projectName: "hive", defaultBranch: "main"
            ),
            isStreaming: true,
            diffStats: DiffStatResponse(
                committed: [DiffFileStat(file: "a.swift", additions: 42, deletions: 16, status: .modified, renamedFrom: nil)],
                uncommitted: []
            ),
            branchInfo: BranchInfo(name: "0xlny/ios-swift-app", lastSyncedAt: ""),
            prStatus: PrStatusResponse(
                pr: PullRequestInfo(number: 47, url: "", state: .open, mergeable: true, mergeableState: .clean, checksStatus: .success, checksPassed: nil, checksTotal: nil, reviewStatus: .approved),
                error: nil
            ),
            sessionCount: 3
        )
        WorkspaceCard(
            workspace: Workspace(
                id: "2", name: "boston-v3", branch: "feat/long-branch-name-that-should-truncate",
                status: .idle, createdAt: "", activeSessionId: nil,
                projectName: "hive", defaultBranch: "main"
            ),
            branchInfo: BranchInfo(name: "feat/long-branch", lastSyncedAt: ""),
            prStatus: PrStatusResponse(
                pr: PullRequestInfo(number: 12, url: "", state: .merged, mergeable: nil, mergeableState: .unknown, checksStatus: .success, checksPassed: nil, checksTotal: nil, reviewStatus: nil),
                error: nil
            ),
            sessionCount: 1
        )
        WorkspaceCard(
            workspace: Workspace(
                id: "3", name: "rio-de-janeiro", branch: "main",
                status: .idle, createdAt: "", activeSessionId: nil,
                projectName: "hive", defaultBranch: "main"
            ),
            diffStats: DiffStatResponse(
                committed: [],
                uncommitted: [DiffFileStat(file: "b.ts", additions: 8, deletions: 0, status: .added, renamedFrom: nil)]
            )
        )
        WorkspaceCard(
            workspace: Workspace(
                id: "4", name: "empty-workspace", branch: "feat/nothing",
                status: .idle, createdAt: "", activeSessionId: nil,
                projectName: "hive", defaultBranch: "main"
            )
        )
    }
    .padding()
    .preferredColorScheme(.dark)
}

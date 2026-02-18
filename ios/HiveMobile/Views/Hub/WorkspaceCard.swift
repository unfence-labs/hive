import SwiftUI

struct WorkspaceCard: View {
    let workspace: Workspace
    var isStreaming: Bool = false
    var diffStats: DiffStatResponse?
    var branchInfo: BranchInfo?
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
                if let pr = branchInfo?.pr {
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
        .glassCardInteractive()
        .accentGlow(color: .white, radius: 6, isActive: isStreaming)
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

    private var isMerged: Bool { pr.state == .merged }
    private var isDraft: Bool { pr.state == .draft }
    private var isMergeable: Bool { pr.mergeable == true || pr.mergeableState == .clean }
    private var hasConflicts: Bool { pr.mergeable == false || pr.mergeableState == .conflict }

    private var icon: String {
        if isMerged { return "arrow.triangle.merge" }
        if isDraft { return "pencil.circle" }
        if isMergeable { return "checkmark.circle" }
        if hasConflicts { return "exclamationmark.triangle" }
        return "arrow.triangle.pull"
    }

    private var label: String {
        if isMerged { return "Merged" }
        if isDraft { return "Draft" }
        if isMergeable { return "Ready" }
        if hasConflicts { return "Conflicts" }
        return "Open"
    }

    private var color: Color {
        if isMerged { return .purple }
        if isDraft { return .secondary }
        if isMergeable { return .green }
        if hasConflicts { return .orange }
        return .blue
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
            Text("#\(pr.number) \u{00B7} \(label)")
        }
        .font(.caption2)
        .foregroundStyle(color)
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
            branchInfo: BranchInfo(
                name: "0xlny/ios-swift-app", lastSyncedAt: "",
                pr: PullRequestInfo(number: 47, url: "", state: .open, mergeable: true, mergeableState: .clean, checksStatus: .success),
                prSyncError: nil
            ),
            sessionCount: 3
        )
        WorkspaceCard(
            workspace: Workspace(
                id: "2", name: "boston-v3", branch: "feat/long-branch-name-that-should-truncate",
                status: .idle, createdAt: "", activeSessionId: nil,
                projectName: "hive", defaultBranch: "main"
            ),
            branchInfo: BranchInfo(
                name: "feat/long-branch", lastSyncedAt: "",
                pr: PullRequestInfo(number: 12, url: "", state: .merged, mergeable: nil, mergeableState: .unknown, checksStatus: .success),
                prSyncError: nil
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

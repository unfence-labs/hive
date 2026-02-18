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
            // Header: name + session count + status indicator
            HStack(alignment: .top) {
                Text(workspace.name)
                    .font(.headline)
                    .bold()
                    .lineLimit(2)
                if let count = sessionCount, count > 0 {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                if isStreaming {
                    AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                } else {
                    StatusDot(isStreaming: false)
                }
            }

            Spacer()

            // Middle: PR status
            if let branchInfo {
                if let pr = branchInfo.pr {
                    PrBadge(pr: pr)
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.pull")
                        Text("No pull request")
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            // Footer: branch + line diff
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption2)
                Text(workspace.branch)
                    .font(.caption)
                    .lineLimit(1)

                if hasChanges {
                    Spacer()
                    LineDiffBadge(additions: totalAdditions, deletions: totalDeletions)
                }
            }
            .foregroundStyle(.secondary)
        }
        .padding(HiveSpacing.lg)
        .frame(minHeight: 160)
        .glassCardInteractive()
    }
}

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
        .font(.caption.monospacedDigit())
    }
}

struct PrBadge: View {
    let pr: PullRequestInfo

    private var isMerged: Bool { pr.state == .merged }
    private var isMergeable: Bool { pr.mergeable == true || pr.mergeableState == .clean }
    private var hasConflicts: Bool { pr.mergeable == false || pr.mergeableState == .conflict }

    private var icon: String {
        if isMerged || isMergeable { return "arrow.triangle.merge" }
        if hasConflicts { return "exclamationmark.triangle" }
        return "arrow.triangle.pull"
    }

    private var label: String {
        if isMerged { return "Merged" }
        if isMergeable { return "Ready" }
        if hasConflicts { return "Conflicts" }
        return "Open"
    }

    private var color: Color {
        if isMerged { return .purple }
        if isMergeable { return .green }
        if hasConflicts { return .orange }
        return .secondary
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
            Text("PR #\(pr.number) \u{00B7} \(label)")
        }
        .font(.caption2)
        .foregroundStyle(color)
    }
}

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
        WorkspaceCard(workspace: Workspace(
            id: "2", name: "boston-v3", branch: "main",
            status: .idle, createdAt: "", activeSessionId: nil,
            projectName: "hive", defaultBranch: "main"
        ))
    }
    .padding()
    .preferredColorScheme(.dark)
}

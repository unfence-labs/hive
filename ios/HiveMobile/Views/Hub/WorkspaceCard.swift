import SwiftUI

struct WorkspaceCard: View {
    let workspace: Workspace
    var isStreaming: Bool = false
    var diffStats: DiffStatResponse?

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
            // Header: name + status indicator
            HStack(alignment: .top) {
                Text(workspace.name)
                    .font(.headline)
                    .bold()
                    .lineLimit(2)
                Spacer()
                if isStreaming {
                    AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                } else {
                    StatusDot(isStreaming: false)
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
            )
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

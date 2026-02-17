import SwiftUI

struct WorkspaceCard: View {
    let workspace: Workspace
    var isStreaming: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            // Header: name + status dot
            HStack(alignment: .top) {
                Text(workspace.name)
                    .font(.headline)
                    .bold()
                    .lineLimit(2)
                Spacer()
                StatusDot(isStreaming: isStreaming)
            }

            Spacer()

            // Activity indicator (centered, only when actually streaming)
            if isStreaming {
                HStack {
                    Spacer()
                    AgentActivityIndicator(dotSize: 5, spacing: 2.5)
                        .shadow(color: .accentColor.opacity(0.3), radius: 6)
                    Spacer()
                }
            }

            Spacer()

            // Footer: branch info
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption2)
                Text(workspace.branch)
                    .font(.caption)
                    .lineLimit(1)
            }
            .foregroundStyle(.secondary)
        }
        .padding(HiveSpacing.lg)
        .frame(minHeight: 160)
        .glassCardInteractive()
    }
}

#Preview {
    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
        WorkspaceCard(workspace: Workspace(
            id: "1", name: "san-antonio-v1", branch: "0xlny/ios-swift-app",
            status: .busy, createdAt: "", activeSessionId: nil,
            projectName: "hive", defaultBranch: "main"
        ), isStreaming: true)
        WorkspaceCard(workspace: Workspace(
            id: "2", name: "boston-v3", branch: "main",
            status: .idle, createdAt: "", activeSessionId: nil,
            projectName: "hive", defaultBranch: "main"
        ))
    }
    .padding()
    .preferredColorScheme(.dark)
}

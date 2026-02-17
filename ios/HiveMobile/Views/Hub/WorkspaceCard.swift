import SwiftUI

struct WorkspaceCard: View {
    let workspace: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(workspace.name)
                .font(.subheadline)
                .bold()
                .lineLimit(1)

            Label(workspace.branch, systemImage: "arrow.triangle.branch")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(14)
        .frame(width: 200, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

#Preview {
    HStack {
        WorkspaceCard(workspace: Workspace(
            id: "1", name: "san-antonio-v1", branch: "0xlny/ios-swift-app",
            status: .busy, createdAt: "", activeSessionId: nil,
            projectName: "hive", defaultBranch: "main"
        ))
        WorkspaceCard(workspace: Workspace(
            id: "2", name: "boston-v3", branch: "main",
            status: .idle, createdAt: "", activeSessionId: nil,
            projectName: "hive", defaultBranch: "main"
        ))
    }
    .padding()
    .preferredColorScheme(.dark)
}

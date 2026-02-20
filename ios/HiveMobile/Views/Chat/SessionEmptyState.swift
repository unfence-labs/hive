import SwiftUI

struct SessionEmptyState: View {
    let projectName: String
    let workspaceName: String
    let branch: String
    let defaultBranch: String

    var body: some View {
        VStack(spacing: HiveSpacing.xl) {
            // Main info card
            (Text("You're in a new copy of ")
                + Text(projectName).fontWeight(.semibold)
                + Text(" called ")
                + Text(workspaceName).fontWeight(.semibold))
                .font(.subheadline)
                .foregroundStyle(WhisperColor.text)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .glassCard(cornerRadius: 14)

            // Detail rows
            VStack(alignment: .leading, spacing: HiveSpacing.lg) {
                infoRow(icon: "arrow.triangle.branch") {
                    Text("Branched ")
                        .foregroundStyle(WhisperColor.textSecondary)
                        + Text(branch).foregroundStyle(WhisperColor.text).fontWeight(.medium)
                        + Text(" from ").foregroundStyle(WhisperColor.textSecondary)
                        + Text("origin/\(defaultBranch)").foregroundStyle(WhisperColor.text).fontWeight(.medium)
                }

                infoRow(icon: "folder") {
                    Text("Workspace ")
                        .foregroundStyle(WhisperColor.textSecondary)
                        + Text(workspaceName).foregroundStyle(WhisperColor.text).fontWeight(.medium)
                        + Text(" is ready").foregroundStyle(WhisperColor.textSecondary)
                }
            }
            .font(.subheadline)
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, HiveSpacing.lg)
    }

    private func infoRow(icon: String, @ViewBuilder text: () -> Text) -> some View {
        HStack(alignment: .top, spacing: HiveSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(WhisperColor.textMuted)
                .frame(width: 16, alignment: .center)
                .padding(.top, 2)

            text()
        }
    }
}

#Preview {
    SessionEmptyState(
        projectName: "avnu-frontend",
        workspaceName: "leiden",
        branch: "general-inquiry",
        defaultBranch: "develop"
    )
    .padding()
    .preferredColorScheme(.dark)
}

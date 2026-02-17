import SwiftUI

struct SessionTabBar: View {
    let sessions: [SessionMetadata]
    let activeSessionId: String?
    let onSelect: (String) -> Void
    let onCreate: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(sessions) { session in
                    sessionTab(session)
                }

                Button {
                    onCreate()
                } label: {
                    Image(systemName: "plus")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    private func sessionTab(_ session: SessionMetadata) -> some View {
        let isActive = session.sessionId == activeSessionId
        return Button {
            onSelect(session.sessionId)
        } label: {
            Text(session.title ?? "Session")
                .font(.caption)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    isActive ? AnyShapeStyle(.accent.opacity(0.3)) : AnyShapeStyle(.ultraThinMaterial),
                    in: Capsule()
                )
                .foregroundStyle(isActive ? .primary : .secondary)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    VStack {
        SessionTabBar(
            sessions: [
                SessionMetadata(
                    sessionId: "s1", claudeSessionId: nil, workspaceId: "ws1",
                    title: "Fix login bug", createdAt: "", updatedAt: "", messageCount: 5
                ),
                SessionMetadata(
                    sessionId: "s2", claudeSessionId: nil, workspaceId: "ws1",
                    title: "Add dark mode", createdAt: "", updatedAt: "", messageCount: 12
                ),
                SessionMetadata(
                    sessionId: "s3", claudeSessionId: nil, workspaceId: "ws1",
                    title: nil, createdAt: "", updatedAt: "", messageCount: 0
                ),
            ],
            activeSessionId: "s1",
            onSelect: { _ in },
            onCreate: {}
        )
        Spacer()
    }
    .preferredColorScheme(.dark)
}

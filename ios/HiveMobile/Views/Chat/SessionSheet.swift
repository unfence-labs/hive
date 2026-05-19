import SwiftUI

struct SessionSheet: View {
    private let maxSessions = 4

    let sessions: [SessionMetadata]
    let activeSessionId: String?
    let onSelect: (String) -> Void
    let onCreate: () -> Void
    let onDelete: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(sessions) { session in
                    SessionRow(
                        session: session,
                        isActive: session.sessionId == activeSessionId
                    )
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onSelect(session.sessionId)
                        dismiss()
                    }
                    .listRowBackground(WhisperColor.surfaceRaised)
                }
                .onDelete { indexSet in
                    for idx in indexSet {
                        onDelete(sessions[idx].sessionId)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .hiveScreenBackground()
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New", systemImage: "plus") {
                        onCreate()
                        dismiss()
                    }
                    .disabled(sessions.count >= maxSessions)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Session Row

private struct SessionRow: View {
    let session: SessionMetadata
    let isActive: Bool

    var body: some View {
        HStack(spacing: HiveSpacing.md) {
            if isActive {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 8, height: 8)
            }

            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                Text(session.title ?? "Untitled Session")
                    .font(.body)
                    .foregroundStyle(isActive ? WhisperColor.text : WhisperColor.textSecondary)

                HStack(spacing: HiveSpacing.sm) {
                    Text("\(session.messageCount) messages")
                    if let relative = relativeTime(from: session.updatedAt) {
                        Text(relative)
                    }
                }
                .font(.caption)
                .foregroundStyle(WhisperColor.textMuted)
            }

            Spacer()

            if isActive {
                Image(systemName: "checkmark")
                    .font(.caption)
                    .foregroundStyle(WhisperColor.text)
            }
        }
        .padding(.vertical, HiveSpacing.xs)
    }

    private func relativeTime(from iso: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return nil }
        let elapsed = Date.now.timeIntervalSince(date)
        switch elapsed {
        case ..<60: return "just now"
        case ..<3600: return "\(Int(elapsed / 60))m ago"
        case ..<86400: return "\(Int(elapsed / 3600))h ago"
        default: return "\(Int(elapsed / 86400))d ago"
        }
    }
}

#Preview {
    SessionSheet(
        sessions: [
            SessionMetadata(
                sessionId: "s1", claudeSessionId: nil, workspaceId: "ws1",
                title: "Fix login bug", createdAt: "", updatedAt: "2026-02-18T10:00:00.000Z", messageCount: 5, lockedProvider: "claude"
            ),
            SessionMetadata(
                sessionId: "s2", claudeSessionId: nil, workspaceId: "ws1",
                title: "Add dark mode", createdAt: "", updatedAt: "2026-02-18T08:00:00.000Z", messageCount: 12, lockedProvider: "codex"
            ),
            SessionMetadata(
                sessionId: "s3", claudeSessionId: nil, workspaceId: "ws1",
                title: nil, createdAt: "", updatedAt: "2026-02-17T15:00:00.000Z", messageCount: 0, lockedProvider: nil
            ),
        ],
        activeSessionId: "s1",
        onSelect: { _ in },
        onCreate: {},
        onDelete: { _ in }
    )
    .preferredColorScheme(.dark)
}

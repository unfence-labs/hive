import SwiftUI

struct ConversationRow: View {
    let session: SessionMetadata
    let isActive: Bool

    private var title: String {
        guard let title = session.title?.trimmingCharacters(in: .whitespacesAndNewlines),
              !title.isEmpty else {
            return "Untitled Conversation"
        }
        return title
    }

    private var messageCountText: String {
        "\(session.messageCount) message\(session.messageCount == 1 ? "" : "s")"
    }

    var body: some View {
        HStack(spacing: HiveSpacing.md) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.body)
                .foregroundStyle(isActive ? Color.accentColor : WhisperColor.textMuted)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)

                HStack(spacing: HiveSpacing.sm) {
                    Label(messageCountText, systemImage: "text.bubble")
                    if let relative = relativeTime(from: session.updatedAt) {
                        Text(relative)
                    }
                }
                .font(.caption)
                .foregroundStyle(WhisperColor.textMuted)
            }

            Spacer(minLength: HiveSpacing.sm)

            if isActive {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical, HiveSpacing.xs)
        .accessibilityElement(children: .combine)
    }

    private func relativeTime(from iso: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return nil }

        let elapsed = Date.now.timeIntervalSince(date)
        switch elapsed {
        case ..<60:
            return "just now"
        case ..<3600:
            return "\(Int(elapsed / 60))m ago"
        case ..<86400:
            return "\(Int(elapsed / 3600))h ago"
        default:
            return "\(Int(elapsed / 86400))d ago"
        }
    }
}

#Preview {
    List {
        ConversationRow(
            session: SessionMetadata(
                sessionId: "s1",
                providerSessionId: nil,
                claudeSessionId: nil,
                workspaceId: "ws1",
                title: "Fix login bug",
                createdAt: "2026-02-18T09:00:00.000Z",
                updatedAt: "2026-02-18T10:00:00.000Z",
                messageCount: 5,
                lockedProvider: "claude"
            ),
            isActive: true
        )
        .listRowBackground(WhisperColor.surfaceRaised)
    }
    .listStyle(.insetGrouped)
    .scrollContentBackground(.hidden)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}

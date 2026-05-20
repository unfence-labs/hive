import SwiftUI

struct ConversationRow: View {
    let session: SessionMetadata
    let isStreaming: Bool
    let isUnread: Bool

    private var title: String {
        guard let title = session.title?.trimmingCharacters(in: .whitespacesAndNewlines),
              !title.isEmpty else {
            return "Untitled Conversation"
        }
        return title
    }

    private var messageCountText: String {
        guard session.messageCount > 0 else { return "No messages yet" }
        return "\(session.messageCount) message\(session.messageCount == 1 ? "" : "s")"
    }

    private var timestampText: String? {
        guard let date = parsedUpdatedAt else { return nil }

        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return Self.timeFormatter.string(from: date)
        }
        if calendar.isDateInYesterday(date) {
            return "Yesterday"
        }
        if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: Date.now)).day,
           days < 7 {
            return Self.weekdayFormatter.string(from: date)
        }
        return Self.dateFormatter.string(from: date)
    }

    private var parsedUpdatedAt: Date? {
        if let date = Self.isoWithFractional.date(from: session.updatedAt) {
            return date
        }
        return Self.iso.date(from: session.updatedAt)
    }

    private var accessibilityText: String {
        var parts = [title, messageCountText]
        if let timestampText {
            parts.append(timestampText)
        }
        if isStreaming {
            parts.append("streaming")
        } else if isUnread {
            parts.append("unread")
        }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        HStack(alignment: .center, spacing: HiveSpacing.md) {
            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)

                Text(messageCountText)
                    .font(.system(size: 15))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(1)
            }

            Spacer(minLength: HiveSpacing.sm)

            VStack(alignment: .trailing, spacing: HiveSpacing.md) {
                if let timestampText {
                    Text(timestampText)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                }

                SessionStatusIndicator(isStreaming: isStreaming, isUnread: isUnread)
            }
        }
        .padding(.horizontal, HiveSpacing.md)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WhisperColor.hubCardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter
    }()

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter
    }()
}

private struct SessionStatusIndicator: View {
    let isStreaming: Bool
    let isUnread: Bool

    @ViewBuilder
    var body: some View {
        if isStreaming {
            AgentActivityIndicator(dotSize: 3, spacing: 1.5)
                .frame(width: 12, height: 12)
                .accessibilityLabel("Streaming")
        } else if isUnread {
            CompletedDot()
                .accessibilityLabel("Unread")
        } else {
            Color.clear
                .frame(width: 12, height: 12)
                .accessibilityHidden(true)
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
            isStreaming: true,
            isUnread: false
        )
        .listRowBackground(WhisperColor.appBackground)
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}

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
        if isActive {
            parts.append("active conversation")
        }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        HStack(spacing: HiveSpacing.md) {
            ConversationAvatar(title: title, isActive: isActive)

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

            VStack(alignment: .trailing, spacing: HiveSpacing.sm) {
                if let timestampText {
                    Text(timestampText)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(minHeight: 52, alignment: .topTrailing)
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
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

private struct ConversationAvatar: View {
    let title: String
    let isActive: Bool

    private static let palette: [Color] = [
        Color(red: 0.000, green: 0.533, blue: 0.843),
        Color(red: 0.137, green: 0.627, blue: 0.478),
        Color(red: 0.667, green: 0.337, blue: 0.678),
        Color(red: 0.839, green: 0.361, blue: 0.306),
        Color(red: 0.302, green: 0.459, blue: 0.773),
        Color(red: 0.808, green: 0.529, blue: 0.216)
    ]

    private var initials: String {
        let words = title
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .prefix(2)
            .compactMap(\.first)
        let value = String(words).uppercased()
        return value.isEmpty ? "C" : value
    }

    private var color: Color {
        let hash = title.unicodeScalars.reduce(0) { (($0 &<< 5) &- $0) &+ Int($1.value) }
        return Self.palette[abs(hash) % Self.palette.count]
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(color)
                .frame(width: 52, height: 52)
                .overlay {
                    Text(initials)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                }

            if isActive {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 13, height: 13)
                    .overlay(Circle().stroke(WhisperColor.surfaceRaised, lineWidth: 2))
                    .offset(x: 1, y: 1)
            }
        }
        .frame(width: 52, height: 52)
        .accessibilityHidden(true)
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
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(WhisperColor.surfaceRaised)
    .preferredColorScheme(.dark)
}

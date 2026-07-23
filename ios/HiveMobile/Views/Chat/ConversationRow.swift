import SwiftUI

struct ConversationRow: View {
    let session: SessionMetadata
    let monitor: HubStatusMonitor
    let workspaceId: String

    private var isStreaming: Bool {
        monitor.isStreaming(workspaceId: workspaceId, sessionId: session.sessionId)
    }
    private var isUnread: Bool {
        monitor.isUnread(workspaceId: workspaceId, sessionId: session.sessionId)
    }

    private var title: String { session.displayTitle }

    // The persisted messageCount only syncs when a turn completes (see
    // conversation-session.ts), so it counts completed exchanges — i.e. agent
    // responses. Label it as such: "No responses yet" is accurate while the
    // first response is still streaming.
    private var responseCountText: String {
        guard session.messageCount > 0 else { return "No responses yet" }
        return "\(session.messageCount) response\(session.messageCount == 1 ? "" : "s")"
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
        var parts = [title, responseCountText]
        if let provider = session.lockedProvider, ProviderMark.isKnown(provider) {
            parts.append(provider.capitalized)
        }
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
                HStack(spacing: HiveSpacing.xs) {
                    if let provider = session.lockedProvider {
                        ProviderMark(provider: provider)
                    }
                    Text(title)
                        .font(WhisperFont.scaled(16, weight: .semibold))
                        .foregroundStyle(WhisperColor.text)
                        .lineLimit(1)
                }

                Text(responseCountText)
                    .font(WhisperFont.scaled(15))
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
            StreamingDot()
                .frame(width: 12, height: 12)
                .accessibilityLabel("Streaming")
        } else if isUnread {
            UnreadDot()
                .accessibilityLabel("Unread")
        } else {
            Color.clear
                .frame(width: 12, height: 12)
                .accessibilityHidden(true)
        }
    }
}

#Preview {
    let store = ProjectStore(storeCache: ConversationStoreCache())
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
            monitor: store.statusMonitor,
            workspaceId: "ws1"
        )
        .listRowBackground(WhisperColor.appBackground)
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}

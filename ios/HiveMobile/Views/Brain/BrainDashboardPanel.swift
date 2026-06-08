import SwiftUI

/// Brain counterpart to `WorkspaceDashboardPanel`: a header plus a Save panel.
/// The Brain has no git/PR data and no scripts, so this panel only surfaces the
/// sync status (mirroring the web `BrainSyncSection`) and the Save action.
struct BrainDashboardPanel: View {
    let repoUrl: String?
    let syncState: BrainSyncState
    let pendingCount: Int
    let unpushedCommitCount: Int?
    let lastSyncedAt: String?
    let isSaving: Bool
    let isStreaming: Bool
    let hasUnread: Bool
    let onSave: () -> Void

    private var canSave: Bool {
        (pendingCount > 0 || (unpushedCommitCount ?? 0) > 0) && !isSaving
    }

    private var activityAccessibilityLabel: String {
        if isStreaming { return "Working" }
        if hasUnread { return "Unread" }
        return "Idle"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.lg) {
            header
            saveBlock
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.vertical, HiveSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WhisperColor.hubCardFill)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.top, HiveSpacing.sm)
        .padding(.bottom, HiveSpacing.md)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: HiveSpacing.md) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Brain")
                    .font(WhisperFont.mono(17, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)

                if let repoUrl, !repoUrl.isEmpty {
                    Text(repoUrl)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer(minLength: HiveSpacing.sm)

            activityIcon
        }
    }

    private var activityIcon: some View {
        Group {
            if isStreaming {
                AgentActivityIndicator(dotSize: 3.2, spacing: 1.6)
            } else if hasUnread {
                UnreadDot()
            } else {
                StatusDot()
            }
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel(activityAccessibilityLabel)
    }

    private var saveBlock: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.sm) {
            Text("SYNC")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(WhisperColor.textMuted)

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center, spacing: HiveSpacing.md) {
                    HStack(spacing: 7) {
                        BrainSyncDot(color: Self.dotColor(for: syncState), pulsing: Self.isPulsing(syncState))
                        Text(syncState.label)
                            .font(.caption.monospacedDigit().weight(.medium))
                            .foregroundStyle(Self.dotColor(for: syncState))
                            .lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(syncState.label)

                    Spacer(minLength: HiveSpacing.sm)

                    Button(action: onSave) {
                        HStack(spacing: 6) {
                            Image(systemName: "icloud.and.arrow.up")
                                .imageScale(.small)
                            Text("Save")
                            if pendingCount > 0 {
                                Text("\(pendingCount)")
                                    .font(.caption2.monospacedDigit().weight(.semibold))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(
                                        Capsule(style: .continuous)
                                            .fill(WhisperColor.surfaceSubtle)
                                    )
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(minWidth: 86, minHeight: 32)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(canSave ? Color.accentColor.opacity(0.16) : WhisperColor.surfaceSubtle)
                        )
                        .foregroundStyle(canSave ? Color.accentColor : WhisperColor.textMuted)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSave)
                    .transaction { transaction in
                        transaction.animation = nil
                    }
                    .accessibilityLabel(saveAccessibilityLabel)
                }

                Text(lastSyncText)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .accessibilityLabel(lastSyncAccessibilityLabel)
            }
            .padding(.horizontal, HiveSpacing.md)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(WhisperColor.surfaceSubtle)
            )
        }
    }

    private static func dotColor(for state: BrainSyncState) -> Color {
        switch state {
        case .loading: return WhisperColor.textMuted
        case .error: return .red
        case .saving: return Color.accentColor
        case .pushFailed: return WhisperColor.warningForeground
        case .saved: return Color.accentColor
        case .pending: return WhisperColor.warningForeground
        case .unpushed: return WhisperColor.warningForeground
        case .synced: return WhisperColor.textMuted
        }
    }

    private static func isPulsing(_ state: BrainSyncState) -> Bool {
        state == .saving || state == .loading
    }

    private var saveAccessibilityLabel: String {
        if pendingCount > 0 { return "Save Brain, \(pendingCount) pending changes" }
        if (unpushedCommitCount ?? 0) > 0 { return "Push Brain" }
        return "Save Brain"
    }

    private var lastSyncText: String {
        guard let lastSyncedAt, !lastSyncedAt.isEmpty else {
            return "Never synced"
        }
        guard let date = Self.date(from: lastSyncedAt) else {
            return "Last sync unknown"
        }
        return "Last synced \(Self.relativeFormatter.localizedString(for: date, relativeTo: Date()))"
    }

    private var lastSyncAccessibilityLabel: String {
        guard let lastSyncedAt, !lastSyncedAt.isEmpty else {
            return "No successful Brain sync recorded yet"
        }
        guard let date = Self.date(from: lastSyncedAt) else {
            return "Last successful Brain sync time is unavailable"
        }
        return "Last successful Brain sync: \(Self.absoluteFormatter.string(from: date))"
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

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    private static let absoluteFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    private static func date(from value: String) -> Date? {
        isoWithFractional.date(from: value) ?? iso.date(from: value)
    }
}

private struct BrainSyncDot: View {
    let color: Color
    let pulsing: Bool

    @State private var animating = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .opacity(pulsing && animating ? 0.35 : 1)
            .animation(
                pulsing
                    ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                    : .default,
                value: animating
            )
            .onAppear { animating = pulsing }
            .onChange(of: pulsing) { _, newValue in animating = newValue }
    }
}

#Preview {
    VStack(spacing: 12) {
        BrainDashboardPanel(
            repoUrl: "git@github.com:user/brain.git",
            syncState: .pending,
            pendingCount: 3,
            unpushedCommitCount: 0,
            lastSyncedAt: "2026-06-08T10:00:00.000Z",
            isSaving: false,
            isStreaming: true,
            hasUnread: false,
            onSave: {}
        )
        BrainDashboardPanel(
            repoUrl: nil,
            syncState: .synced,
            pendingCount: 0,
            unpushedCommitCount: 0,
            lastSyncedAt: nil,
            isSaving: false,
            isStreaming: false,
            hasUnread: false,
            onSave: {}
        )
    }
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}

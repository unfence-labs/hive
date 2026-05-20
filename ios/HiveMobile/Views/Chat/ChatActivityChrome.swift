import SwiftUI

struct ChatActivityStats {
    enum Kind { case diff, plain }
    let kind: Kind
    var added: Int = 0
    var removed: Int = 0
    var label: String?
}

struct ChatActivityRowLabel: View {
    var icon: String? = nil
    let label: String
    var detail: String?
    var stats: ChatActivityStats?
    var summary: String?
    var badgeText: String?
    var badgeIcon: String?
    var trailingIcon: String?
    var trailingIconColor = WhisperColor.textMuted
    var isExpanded: Bool?
    var accessoryIcons: [String] = []
    var executing = false
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            if let isExpanded {
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(WhisperColor.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }

            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 9))
                    .frame(width: 14, height: 14)
                    .foregroundStyle(WhisperColor.textMuted)
            }

            Text(label)
                .font(WhisperFont.mono(12))
                .foregroundStyle(WhisperColor.textMuted)
                .lineLimit(1)

            if let badgeText {
                ChatActivityBadge(text: badgeText, icon: badgeIcon)
            }

            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(WhisperFont.mono(11))
                    .foregroundStyle(WhisperColor.textSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WhisperColor.surfaceRaised, in: RoundedRectangle(cornerRadius: 4))
            }

            if let stats {
                switch stats.kind {
                case .diff:
                    HStack(spacing: 4) {
                        if stats.added > 0 {
                            Text("+\(stats.added)")
                                .foregroundStyle(.green)
                        }
                        if stats.removed > 0 {
                            Text("-\(stats.removed)")
                                .foregroundStyle(.red)
                        }
                    }
                    .font(WhisperFont.mono(10))
                case .plain:
                    if let label = stats.label {
                        Text(label)
                            .font(WhisperFont.mono(10))
                            .foregroundStyle(WhisperColor.textMuted)
                            .lineLimit(1)
                    }
                }
            }

            if let summary {
                Text(summary)
                    .font(WhisperFont.mono(10))
                    .foregroundStyle(WhisperColor.textMuted)
                    .lineLimit(1)
            }

            if !accessoryIcons.isEmpty {
                HStack(spacing: 3) {
                    ForEach(accessoryIcons, id: \.self) { icon in
                        Image(systemName: icon)
                            .font(.system(size: 9))
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                }
            }

            if let trailingIcon {
                Image(systemName: trailingIcon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(trailingIconColor)
                    .frame(width: 14, height: 14)
            }

            if executing {
                Circle()
                    .fill(WhisperColor.textSecondary)
                    .frame(width: 5, height: 5)
                    .opacity(pulse ? 1 : 0.35)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
                    .onAppear { pulse = true }
                    .onDisappear { pulse = false }
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

struct ChatActivityBadge: View {
    let text: String
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 3) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 8, weight: .medium))
            }
            Text(text)
                .font(WhisperFont.mono(10))
        }
        .foregroundStyle(WhisperColor.textMuted)
        .lineLimit(1)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(WhisperColor.toolIconBg, in: Capsule())
    }
}

struct ToolContentPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WhisperColor.surface, in: RoundedRectangle(cornerRadius: 8))
            .padding(.top, 2)
    }
}

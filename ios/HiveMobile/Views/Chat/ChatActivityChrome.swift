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
                // Opacity-only pulse, fully decoupled from the animation system so
                // the dot can NEVER move. The opacity is recomputed every frame by
                // TimelineView (no animation transaction), and `.transaction` nils
                // out any animation inherited from ancestors — so streaming relayout
                // (label/icons growing to its left) repositions the dot instantly
                // instead of animating it. Matches the web's `bg-primary animate-pulse`.
                TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    let opacity = 0.7 + 0.3 * sin(t * 2 * .pi / 1.6)
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 5, height: 5)
                        .opacity(opacity)
                }
                .transaction { $0.animation = nil }
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

/// Collapsible activity row: a toggle label (icon/chevron + title + detail +
/// trailing icon) with an optional expanded panel, plus optional non-interactive
/// `leading` (e.g. an image thumbnail) and `below` slots. The expand affordance
/// is only shown/clickable when `expanded` is provided. Shared by image and
/// diagnostic activities — mirrors `frontend/src/components/chat/ActivityShell.tsx`.
struct ActivityDisclosureRow: View {
    var icon: String? = nil
    let title: String
    var detail: String? = nil
    var trailingIcon: String? = nil
    var trailingIconColor: Color = WhisperColor.textMuted
    var executing: Bool = false
    var leading: AnyView? = nil
    var expanded: AnyView? = nil
    var below: AnyView? = nil

    @State private var isExpanded = false

    private var canExpand: Bool { expanded != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                if let leading {
                    leading
                }

                Button {
                    guard canExpand else { return }
                    withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
                } label: {
                    ChatActivityRowLabel(
                        icon: icon,
                        label: title,
                        detail: detail,
                        trailingIcon: trailingIcon,
                        trailingIconColor: trailingIconColor,
                        // Show the chevron only when there is no leading icon and
                        // the row can expand — matches the web's `icon ? icon : chevron`.
                        isExpanded: (icon == nil && canExpand) ? isExpanded : nil,
                        executing: executing
                    )
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)
            }

            if canExpand, isExpanded, let expanded {
                ToolContentPanel { expanded }
                    .transition(.opacity)
            }

            if let below {
                below
            }
        }
    }
}

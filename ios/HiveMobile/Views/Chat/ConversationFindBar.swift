import SwiftUI
import UIKit

struct ConversationFindBar: View {
    @Binding var query: String
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: HiveSpacing.md) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(WhisperColor.textMuted)

                TextField("Search", text: $query)
                    .focused(focused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit(onSubmit)
                    .font(.body)
                    .foregroundStyle(WhisperColor.text)

                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(WhisperColor.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .glassPill()

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WhisperColor.text)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: Circle())
            .accessibilityLabel("Close search")
        }
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.top, HiveSpacing.xs)
        .padding(.bottom, HiveSpacing.md)
        .background {
            ProgressiveTopBlur()
                .padding(.bottom, -40)
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
        }
    }
}

/// Approximates Telegram's variable blur above the search bar: stacked
/// materials whose gradient masks fade out toward the transcript, so content
/// scrolling underneath blurs more the closer it gets to the top edge.
private struct ProgressiveTopBlur: View {
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .white, location: 0),
                            .init(color: .white, location: 0.55),
                            .init(color: .clear, location: 1)
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            Rectangle()
                .fill(.regularMaterial)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .white, location: 0),
                            .init(color: .clear, location: 0.55)
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
        }
    }
}

struct ConversationFindCounter: View {
    let matchCount: Int
    let displayIndex: Int
    let noResults: Bool

    var body: some View {
        Group {
            if noResults {
                Text("No results")
                    .font(WhisperFont.scaled(14, weight: .medium))
                    .foregroundStyle(WhisperColor.textSecondary)
            } else if matchCount > 0 {
                Text("\(displayIndex) of \(matchCount)")
                    .font(WhisperFont.scaled(14, weight: .medium))
                    .foregroundStyle(WhisperColor.text)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.2), value: displayIndex)
                    .accessibilityLabel("Match \(displayIndex) of \(matchCount)")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .glassPill()
    }
}

struct ConversationFindNavigator: View {
    let enabled: Bool
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            navButton(icon: "chevron.up", label: "Previous match", action: onPrevious)
            navButton(icon: "chevron.down", label: "Next match", action: onNext)
        }
        .opacity(enabled ? 1 : 0.4)
        .disabled(!enabled)
    }

    private func navButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            Haptics.selection()
        } label: {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(enabled ? WhisperColor.text : WhisperColor.textMuted)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .accessibilityLabel(label)
    }
}

enum FindHighlighting {
    static func apply(to attributed: NSMutableAttributedString, highlight: MessageFindHighlight) {
        let ranges = ConversationFindModel.matchRanges(in: attributed.string, query: highlight.query)
        for (ordinal, range) in ranges.enumerated() {
            let isActive = ordinal == highlight.activeOrdinal
            let nsRange = NSRange(location: range.lowerBound, length: range.count)
            attributed.addAttributes([
                .backgroundColor: UIColor(isActive ? WhisperColor.findMatchActive : WhisperColor.findMatch),
                .foregroundColor: UIColor(WhisperColor.findMatchForeground)
            ], range: nsRange)
        }
    }

    static func apply(to attributed: inout AttributedString, highlight: MessageFindHighlight) {
        var searchStart = attributed.startIndex
        var ordinal = 0
        while searchStart < attributed.endIndex,
              let range = attributed[searchStart...].range(
                  of: highlight.query,
                  options: [.caseInsensitive, .diacriticInsensitive]
              ) {
            let isActive = ordinal == highlight.activeOrdinal
            attributed[range].backgroundColor = isActive ? WhisperColor.findMatchActive : WhisperColor.findMatch
            attributed[range].foregroundColor = WhisperColor.findMatchForeground
            searchStart = range.upperBound
            ordinal += 1
        }
    }
}

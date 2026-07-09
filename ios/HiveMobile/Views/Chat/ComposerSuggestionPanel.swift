import SwiftUI

/// One row of the composer autocomplete panel: a repository file for `#`, or a
/// backend-scanned completion (`/command`, `@agent`).
enum ComposerSuggestion: Identifiable, Equatable {
    case file(ComposerAutocomplete.FileMatch)
    case item(CompletionItem)

    var id: String {
        switch self {
        case .file(let match): "file-\(match.path)"
        case .item(let item): "item-\(item.id)"
        }
    }
}

/// Compact suggestion list anchored above the composer. Thin by design: the
/// matching/ranking lives in `ComposerAutocomplete`; this view just renders
/// rows and reports taps.
struct ComposerSuggestionPanel: View {
    let suggestions: [ComposerSuggestion]
    let onSelect: (ComposerSuggestion) -> Void

    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId

    private var hiveAccent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    private static let rowHeight: CGFloat = 46
    private static let maxVisibleRows: CGFloat = 5

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                        Button {
                            Haptics.selection()
                            onSelect(suggestion)
                        } label: {
                            SuggestionRow(suggestion: suggestion, accent: hiveAccent)
                        }
                        .buttonStyle(.plain)
                        .id(suggestion.id)

                        if index < suggestions.count - 1 {
                            Divider()
                                .overlay(WhisperColor.hubSeparator)
                                .padding(.leading, 52)
                        }
                    }
                }
            }
            .frame(height: min(CGFloat(suggestions.count), Self.maxVisibleRows) * Self.rowHeight)
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .onChange(of: suggestions.first?.id) {
                if let first = suggestions.first?.id {
                    proxy.scrollTo(first, anchor: .top)
                }
            }
        }
        .glassCard(cornerRadius: 16)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(WhisperColor.hubCardBorder, lineWidth: 0.5)
        )
        .accessibilityLabel("Suggestions")
    }
}

private struct SuggestionRow: View {
    let suggestion: ComposerSuggestion
    let accent: Color

    var body: some View {
        HStack(spacing: HiveSpacing.md) {
            Image(systemName: iconName)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(accent)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(accent.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 1) {
                Text(primaryText)
                    .font(WhisperFont.scaled(15, weight: .medium))
                    .foregroundStyle(WhisperColor.text)
                    .lineLimit(1)

                if let detail = secondaryText, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(WhisperColor.textMuted)
                        .lineLimit(1)
                        .truncationMode(isFile ? .head : .tail)
                }
            }

            Spacer(minLength: HiveSpacing.sm)
        }
        .padding(.horizontal, HiveSpacing.md)
        .frame(height: 46)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private var isFile: Bool {
        if case .file = suggestion { return true }
        return false
    }

    private var iconName: String {
        switch suggestion {
        case .file: "doc.text"
        case .item(let item): item.type == "agent" ? "person.crop.circle" : "command"
        }
    }

    private var primaryText: String {
        switch suggestion {
        case .file(let match): match.basename
        case .item(let item): item.label
        }
    }

    private var secondaryText: String? {
        switch suggestion {
        case .file(let match):
            let dir = match.path.hasSuffix(match.basename)
                ? String(match.path.dropLast(match.basename.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                : match.path
            return dir.isEmpty ? nil : dir
        case .item(let item):
            return item.description
        }
    }

    private var accessibilityText: String {
        switch suggestion {
        case .file(let match): "File \(match.path)"
        case .item(let item): [item.label, item.description].compactMap { $0 }.joined(separator: ", ")
        }
    }
}

#Preview {
    VStack {
        Spacer()
        ComposerSuggestionPanel(
            suggestions: [
                .file(.init(path: "backend/src/utils/git.ts", basename: "git.ts")),
                .file(.init(path: "frontend/src/lib/fuzzy-match.ts", basename: "fuzzy-match.ts")),
                .item(.init(type: "slash_command", name: "compact", label: "/compact",
                            replacementLabel: nil, description: "Compact conversation context",
                            argumentHint: nil, source: "builtin")),
                .item(.init(type: "agent", name: "reviewer", label: "@reviewer",
                            replacementLabel: "@agent-reviewer", description: "Reviews code for bugs",
                            argumentHint: nil, source: "project_agent")),
            ],
            onSelect: { _ in }
        )
        .padding(.horizontal, 12)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .hiveScreenBackground()
    .preferredColorScheme(.dark)
}

import SwiftUI

/// Provider brand mark shown next to a conversation once its session locks a
/// provider. Mirrors the web `ProviderIcon` (frontend/src/components/chat/
/// ProviderIcon.tsx): same SVG marks and brand colors. Renders nothing for
/// unknown providers so we never show a wrong brand before a session locks.
struct ProviderMark: View {
    let provider: String
    var size: CGFloat = 14

    /// Keep the provider set and brand colors in sync with `KnownProvider` and
    /// `BRAND_COLOR` in the web `ProviderIcon`.
    private static let marks: [String: (asset: String, color: Color)] = [
        "claude": ("ProviderMarkClaude", Color(red: 0.851, green: 0.467, blue: 0.341)), // Anthropic clay #D97757
        "codex": ("ProviderMarkCodex", Color(red: 0.063, green: 0.639, blue: 0.498)), // OpenAI green #10A37F
        "kimi": ("ProviderMarkKimi", Color(red: 0.000, green: 0.722, blue: 0.600)) // Moonshot teal #00B899
    ]

    static func isKnown(_ provider: String?) -> Bool {
        guard let provider else { return false }
        return marks[provider] != nil
    }

    var body: some View {
        if let mark = Self.marks[provider] {
            Image(mark.asset)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .foregroundStyle(mark.color)
                .accessibilityHidden(true)
        }
    }
}

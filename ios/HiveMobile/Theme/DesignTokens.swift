import SwiftUI

// MARK: - Accent Color System

enum AccentOption: String, CaseIterable, Identifiable {
    case violet, blue, cyan, emerald, amber, rose

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .violet:  Color(red: 0.486, green: 0.227, blue: 0.929)
        case .blue:    Color(red: 0.231, green: 0.510, blue: 0.965)
        case .cyan:    Color(red: 0.024, green: 0.714, blue: 0.831)
        case .emerald: Color(red: 0.063, green: 0.725, blue: 0.506)
        case .amber:   Color(red: 0.961, green: 0.620, blue: 0.043)
        case .rose:    Color(red: 0.957, green: 0.247, blue: 0.369)
        }
    }

    var label: String { rawValue.capitalized }
}

// MARK: - Spacing Scale

enum HiveSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

// MARK: - Whisper Color Tokens

enum WhisperColor {
    static let border        = Color.white.opacity(0.08)
    static let borderSubtle  = Color.white.opacity(0.04)
    static let toolIconBg    = Color.white.opacity(0.05)
    static let text          = Color(red: 0.91, green: 0.91, blue: 0.94)
    static let textSecondary = Color(red: 0.545, green: 0.545, blue: 0.62)
    static let textMuted     = Color(red: 0.333, green: 0.333, blue: 0.416)
}

// MARK: - Whisper Font Helpers

enum WhisperFont {
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

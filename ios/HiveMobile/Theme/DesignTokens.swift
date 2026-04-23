import SwiftUI
import UIKit

// MARK: - Accent Color System

enum AccentOption: String, CaseIterable, Identifiable {
    case violet, blue, cyan, emerald, amber, rose

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .violet:  Color(red: 0.388, green: 0.357, blue: 1.000)
        case .blue:    Color(red: 0.231, green: 0.510, blue: 0.965)
        case .cyan:    Color(red: 0.024, green: 0.714, blue: 0.831)
        case .emerald: Color(red: 0.063, green: 0.725, blue: 0.506)
        case .amber:   Color(red: 0.961, green: 0.620, blue: 0.043)
        case .rose:    Color(red: 0.957, green: 0.247, blue: 0.369)
        }
    }

    var label: String {
        switch self {
        case .violet: "Indigo"
        default: rawValue.capitalized
        }
    }
}

// MARK: - Theme Mode

enum HiveThemeMode: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var systemImage: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
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
    static let border        = dynamic(light: UIColor(white: 0.88, alpha: 1), dark: UIColor(white: 1, alpha: 0.08))
    static let borderSubtle  = dynamic(light: UIColor(white: 0.92, alpha: 1), dark: UIColor(white: 1, alpha: 0.04))
    static let toolIconBg    = dynamic(light: UIColor(white: 0.95, alpha: 1), dark: UIColor(white: 1, alpha: 0.05))
    static let surface       = dynamic(light: UIColor(white: 0.965, alpha: 0.96), dark: UIColor(white: 1, alpha: 0.06))
    static let surfaceSubtle = dynamic(light: UIColor(white: 0.975, alpha: 0.96), dark: UIColor(white: 1, alpha: 0.03))
    static let surfaceRaised = dynamic(light: UIColor(white: 1.00, alpha: 1), dark: UIColor(white: 1, alpha: 0.10))
    static let separator     = dynamic(light: UIColor(white: 0.86, alpha: 1), dark: UIColor(white: 1, alpha: 0.05))
    static let hubCardFill   = dynamic(light: UIColor(white: 0.965, alpha: 0.94), dark: UIColor(white: 1, alpha: 0.06))
    static let hubCardBorder = dynamic(light: UIColor(white: 0, alpha: 0), dark: UIColor(white: 1, alpha: 0.08))
    static let hubStructure  = dynamic(light: UIColor(white: 0, alpha: 0), dark: UIColor(white: 1, alpha: 0.08))
    static let hubSeparator  = dynamic(light: UIColor(white: 0, alpha: 0), dark: UIColor(white: 1, alpha: 0.05))
    static let text          = dynamic(light: UIColor(red: 0.09, green: 0.10, blue: 0.13, alpha: 1), dark: UIColor(red: 0.91, green: 0.91, blue: 0.94, alpha: 1))
    static let textSecondary = dynamic(light: UIColor(red: 0.34, green: 0.36, blue: 0.42, alpha: 1), dark: UIColor(red: 0.545, green: 0.545, blue: 0.62, alpha: 1))
    static let textMuted     = dynamic(light: UIColor(red: 0.55, green: 0.57, blue: 0.63, alpha: 1), dark: UIColor(red: 0.333, green: 0.333, blue: 0.416, alpha: 1))
    static let codeText      = dynamic(light: UIColor(red: 0.20, green: 0.23, blue: 0.32, alpha: 1), dark: UIColor(red: 0.78, green: 0.82, blue: 0.90, alpha: 1))
    static let codeBg        = dynamic(light: UIColor(white: 0.94, alpha: 1), dark: UIColor(white: 1, alpha: 0.10))
    static let codeBlockBg   = dynamic(light: UIColor(white: 0.965, alpha: 1), dark: UIColor(white: 1, alpha: 0.06))
    static let activityDot   = dynamic(light: UIColor(red: 0.24, green: 0.26, blue: 0.32, alpha: 1), dark: UIColor(white: 1, alpha: 1))
    static let imageControlBg = dynamic(light: UIColor(white: 1, alpha: 0.86), dark: UIColor(white: 0, alpha: 0.60))

    private static func dynamic(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

// MARK: - Whisper Font Helpers

enum WhisperFont {
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

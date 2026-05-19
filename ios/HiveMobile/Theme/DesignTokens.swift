import SwiftUI
import UIKit

private func rgb(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, alpha: CGFloat = 1) -> UIColor {
    UIColor(red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
}

// MARK: - Accent Color System

enum AccentOption: String, CaseIterable, Identifiable {
    case hive, violet, blue, cyan, emerald, amber, rose

    var id: String { rawValue }

    static let defaultId = Self.hive.rawValue

    var color: Color {
        switch self {
        case .hive:    Self.dynamic(light: rgb(184, 67, 36), dark: rgb(255, 154, 122))
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
        case .hive: "Hive"
        case .violet: "Indigo"
        default: rawValue.capitalized
        }
    }

    private static func dynamic(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
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
    static let appBackground = dynamic(light: rgb(239, 237, 230), dark: rgb(23, 20, 16))
    static let brandAccent = dynamic(light: rgb(184, 67, 36), dark: rgb(255, 154, 122))
    static let border        = dynamic(light: rgb(221, 214, 200), dark: rgb(255, 241, 214, alpha: 0.12))
    static let borderSubtle  = dynamic(light: rgb(231, 225, 213), dark: rgb(255, 241, 214, alpha: 0.07))
    static let toolIconBg    = dynamic(light: rgb(236, 232, 222), dark: rgb(255, 241, 214, alpha: 0.08))
    static let surface       = dynamic(light: rgb(248, 245, 238, alpha: 0.96), dark: rgb(41, 35, 29, alpha: 0.86))
    static let surfaceSubtle = dynamic(light: rgb(242, 239, 231, alpha: 0.96), dark: rgb(33, 28, 23, alpha: 0.82))
    static let surfaceRaised = dynamic(light: rgb(255, 252, 245), dark: rgb(49, 42, 34, alpha: 0.92))
    static let separator     = dynamic(light: rgb(215, 208, 192), dark: rgb(255, 241, 214, alpha: 0.08))
    static let hubCardFill   = dynamic(light: rgb(248, 245, 238, alpha: 0.94), dark: rgb(42, 36, 30, alpha: 0.70))
    static let hubCardBorder = dynamic(light: rgb(223, 213, 198, alpha: 0.90), dark: rgb(255, 229, 190, alpha: 0.10))
    static let hubStructure  = dynamic(light: rgb(217, 208, 191), dark: rgb(255, 229, 190, alpha: 0.10))
    static let hubSeparator  = dynamic(light: rgb(226, 219, 206, alpha: 0.85), dark: rgb(255, 229, 190, alpha: 0.08))
    static let text          = dynamic(light: rgb(29, 26, 22), dark: rgb(243, 239, 230))
    static let textSecondary = dynamic(light: rgb(92, 85, 75), dark: rgb(184, 175, 161))
    static let textMuted     = dynamic(light: rgb(139, 129, 115), dark: rgb(125, 116, 102))
    static let codeText      = dynamic(light: rgb(43, 41, 37), dark: rgb(230, 222, 209))
    static let codeBg        = dynamic(light: rgb(237, 232, 221), dark: rgb(48, 40, 32))
    static let codeBlockBg   = dynamic(light: rgb(246, 242, 234), dark: rgb(36, 31, 26))
    static let activityDot   = dynamic(light: rgb(51, 45, 38), dark: rgb(239, 237, 230))
    static let imageControlBg = dynamic(light: rgb(255, 252, 245, alpha: 0.86), dark: rgb(17, 15, 13, alpha: 0.72))

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

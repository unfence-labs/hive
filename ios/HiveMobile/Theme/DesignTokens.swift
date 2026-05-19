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
    static let appBackground = dynamic(light: rgb(244, 245, 247), dark: rgb(18, 19, 22))
    static let brandAccent = dynamic(light: rgb(184, 67, 36), dark: rgb(255, 154, 122))
    static let border        = dynamic(light: rgb(218, 221, 226), dark: rgb(244, 247, 251, alpha: 0.11))
    static let borderSubtle  = dynamic(light: rgb(228, 231, 236), dark: rgb(244, 247, 251, alpha: 0.06))
    static let toolIconBg    = dynamic(light: rgb(235, 237, 241), dark: rgb(244, 247, 251, alpha: 0.07))
    static let surface       = dynamic(light: rgb(250, 251, 252, alpha: 0.96), dark: rgb(33, 35, 40, alpha: 0.86))
    static let surfaceSubtle = dynamic(light: rgb(239, 241, 245, alpha: 0.96), dark: rgb(27, 29, 34, alpha: 0.82))
    static let surfaceRaised = dynamic(light: rgb(255, 255, 255), dark: rgb(39, 42, 48, alpha: 0.92))
    static let separator     = dynamic(light: rgb(211, 215, 222), dark: rgb(244, 247, 251, alpha: 0.08))
    static let hubCardFill   = dynamic(light: rgb(250, 251, 252, alpha: 0.94), dark: rgb(34, 36, 42, alpha: 0.70))
    static let hubCardBorder = dynamic(light: rgb(219, 223, 230, alpha: 0.90), dark: rgb(244, 247, 251, alpha: 0.09))
    static let hubStructure  = dynamic(light: rgb(213, 217, 224), dark: rgb(244, 247, 251, alpha: 0.09))
    static let hubSeparator  = dynamic(light: rgb(226, 229, 234, alpha: 0.85), dark: rgb(244, 247, 251, alpha: 0.07))
    static let text          = dynamic(light: rgb(24, 25, 28), dark: rgb(238, 240, 244))
    static let textSecondary = dynamic(light: rgb(83, 88, 98), dark: rgb(174, 180, 190))
    static let textMuted     = dynamic(light: rgb(134, 140, 151), dark: rgb(118, 125, 138))
    static let codeText      = dynamic(light: rgb(38, 41, 47), dark: rgb(224, 228, 235))
    static let codeBg        = dynamic(light: rgb(233, 236, 241), dark: rgb(38, 41, 48))
    static let codeBlockBg   = dynamic(light: rgb(247, 248, 250), dark: rgb(25, 27, 32))
    static let activityDot   = dynamic(light: rgb(42, 45, 52), dark: rgb(238, 240, 244))
    static let imageControlBg = dynamic(light: rgb(255, 255, 255, alpha: 0.86), dark: rgb(13, 14, 17, alpha: 0.72))

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

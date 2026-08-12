import SwiftUI
import UIKit

enum OnboardingStyle {
    /// The launch mark's orange dash; reused as the typewriter cursor so the
    /// splash hands off visually into the welcome screen.
    static let brandOrange = Color(red: 1.0, green: 112.0 / 255.0, blue: 72.0 / 255.0)

    /// Ink of the launch mark's H, matching the light and dark launch assets.
    static let markInk = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 238.0 / 255.0, green: 240.0 / 255.0, blue: 244.0 / 255.0, alpha: 1)
            : UIColor(red: 17.0 / 255.0, green: 17.0 / 255.0, blue: 17.0 / 255.0, alpha: 1)
    })

    /// Block cursor metrics derived from the text line height, so the cursor
    /// tracks Dynamic Type along with the tagline. At the default size
    /// (19pt text, ~22.7pt line) this yields the designed 11x20 block.
    static func cursorSize(forLineHeight lineHeight: CGFloat) -> CGSize {
        let height = lineHeight * 0.88
        return CGSize(width: height * 0.55, height: height)
    }

    static func cursorCornerRadius(forHeight height: CGFloat) -> CGFloat {
        height * 0.175
    }
}

extension View {
    /// Full-width accent call-to-action shared by the onboarding screens.
    func onboardingCTA(enabled: Bool = true) -> some View {
        self
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Color.accentColor)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(enabled ? 1 : 0.4)
    }
}

import SwiftUI

enum OnboardingStyle {
    /// The launch mark's orange dash; reused as the typewriter cursor so the
    /// splash hands off visually into the welcome screen.
    static let brandOrange = Color(red: 1.0, green: 112.0 / 255.0, blue: 72.0 / 255.0)

    static let cursorSize = CGSize(width: 11, height: 20)
    static let cursorCornerRadius: CGFloat = 3.5
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

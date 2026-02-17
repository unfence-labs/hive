import SwiftUI

extension View {
    /// Glass card with rounded corners for workspace cards and surfaces.
    func glassCard(cornerRadius: CGFloat = 20) -> some View {
        self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius))
    }

    /// Interactive glass card that responds to press/hover.
    func glassCardInteractive(cornerRadius: CGFloat = 20) -> some View {
        self.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: cornerRadius))
    }

    /// Glass pill/capsule for badges and small elements.
    func glassPill() -> some View {
        self.glassEffect(.regular, in: Capsule())
    }
}

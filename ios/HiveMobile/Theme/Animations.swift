import SwiftUI

// MARK: - Shimmer (loading skeletons)

struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .opacity(0.5 + 0.5 * Foundation.sin(phase))
            .onAppear {
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                    phase = .pi
                }
            }
    }
}

// MARK: - Pulse (active workspace glow)

struct PulseModifier: ViewModifier {
    let isActive: Bool
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isActive && isPulsing ? 1.02 : 1.0)
            .animation(
                isActive ? .easeInOut(duration: 2).repeatForever(autoreverses: true) : .default,
                value: isPulsing
            )
            .onChange(of: isActive) { _, active in
                isPulsing = active
            }
            .onAppear { isPulsing = isActive }
    }
}

// MARK: - Accent Glow Shadow

struct GlowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .shadow(color: isActive ? color.opacity(0.15) : .clear, radius: radius)
            .animation(.easeInOut(duration: 0.3), value: isActive)
    }
}

// MARK: - View Extensions

extension View {
    func shimmer() -> some View { modifier(ShimmerModifier()) }
    func pulse(isActive: Bool) -> some View { modifier(PulseModifier(isActive: isActive)) }
    func accentGlow(color: Color, radius: CGFloat = 8, isActive: Bool = true) -> some View {
        modifier(GlowModifier(color: color, radius: radius, isActive: isActive))
    }
}

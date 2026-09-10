import SwiftUI

// MARK: - Shimmer (loading skeletons)

struct ShimmerModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .opacity(reduceMotion ? 0.5 : 0.5 + 0.5 * Foundation.sin(phase))
            .onChange(of: reduceMotion, initial: true) {
                if reduceMotion {
                    phase = 0
                } else {
                    withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                        phase = .pi
                    }
                }
            }
    }
}

// MARK: - Step shimmer (live timeline text)

/// A neutral highlight sweeping over muted text while a step runs: the text stays
/// `WhisperColor.textMuted` and a brighter band travels across it. Reduce Motion
/// renders the static muted text. Mirrors the web `step-live-text` keyframes.
struct StepShimmerModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let period: TimeInterval = 1.6

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content
                .overlay {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                        let elapsed = context.date.timeIntervalSinceReferenceDate
                        let phase = elapsed.truncatingRemainder(dividingBy: Self.period) / Self.period
                        GeometryReader { geo in
                            LinearGradient(
                                stops: [
                                    .init(color: WhisperColor.textMuted, location: 0.25),
                                    .init(color: WhisperColor.text, location: 0.5),
                                    .init(color: WhisperColor.textMuted, location: 0.75),
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: geo.size.width)
                            .offset(x: (phase * 2 - 1) * geo.size.width)
                        }
                    }
                    .transaction { $0.animation = nil }
                    .allowsHitTesting(false)
                }
                .mask { content }
        }
    }
}

// MARK: - Pulse (active workspace glow)

struct PulseModifier: ViewModifier {
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(!reduceMotion && isActive && isPulsing ? 1.02 : 1.0)
            .animation(
                reduceMotion
                    ? nil
                    : (isActive ? .easeInOut(duration: 2).repeatForever(autoreverses: true) : .default),
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
    /// Live step text; `active` false leaves the view untouched.
    @ViewBuilder
    func stepShimmer(_ active: Bool = true) -> some View {
        if active { modifier(StepShimmerModifier()) } else { self }
    }
    func pulse(isActive: Bool) -> some View { modifier(PulseModifier(isActive: isActive)) }
    func accentGlow(color: Color, radius: CGFloat = 8, isActive: Bool = true) -> some View {
        modifier(GlowModifier(color: color, radius: radius, isActive: isActive))
    }
}

import SwiftUI

/// Idle workspace indicator — neutral gray dot.
struct StatusDot: View {
    var body: some View {
        Circle()
            .fill(WhisperColor.textMuted)
            .frame(width: 6, height: 6)
    }
}

/// Streaming activity indicator — an accent dot with an expanding "ping" ring.
/// Mirrors the web sidebar's `animate-ping` streaming state (pulses while the
/// agent is running); falls back to a static halo under Reduce Motion so it
/// still reads differently from the solid unread dot.
struct StreamingDot: View {
    let size: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let color = Color.accentColor

    init(size: CGFloat = 8) {
        self.size = size
    }

    var body: some View {
        Group {
            if reduceMotion {
                dot(haloScale: 1.6, haloOpacity: 0.28)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                    let progress = timeline.date.timeIntervalSinceReferenceDate
                        .truncatingRemainder(dividingBy: 1)
                    dot(
                        haloScale: 1 + progress,
                        haloOpacity: 0.7 * (1 - progress)
                    )
                }
            }
        }
        .frame(width: size, height: size)
        .transaction { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
    }

    private func dot(haloScale: Double, haloOpacity: Double) -> some View {
        Canvas { context, canvasSize in
            let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
            let haloDiameter = size * CGFloat(haloScale)
            let haloRect = CGRect(
                x: center.x - haloDiameter / 2,
                y: center.y - haloDiameter / 2,
                width: haloDiameter,
                height: haloDiameter
            )
            let dotRect = CGRect(
                x: center.x - size / 2,
                y: center.y - size / 2,
                width: size,
                height: size
            )

            context.fill(Path(ellipseIn: haloRect), with: .color(color.opacity(haloOpacity)))
            context.fill(Path(ellipseIn: dotRect), with: .color(color))
        }
        .frame(width: size * 2, height: size * 2)
        .frame(width: size, height: size)
    }
}

/// Unread activity indicator using the user's selected accent color.
struct UnreadDot: View {
    let size: CGFloat
    let shadowRadius: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    private let color = Color.accentColor

    init(size: CGFloat = 8, shadowRadius: CGFloat = 6) {
        self.size = size
        self.shadowRadius = shadowRadius
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .shadow(color: color.opacity(appeared ? 0.5 : 0), radius: shadowRadius)
            .scaleEffect(appeared ? 1.0 : 0.3)
            .opacity(appeared ? 1.0 : 0.0)
            .onAppear {
                if reduceMotion {
                    appeared = true
                } else {
                    withAnimation(.spring(duration: 0.4, bounce: 0.3)) {
                        appeared = true
                    }
                }
            }
    }
}

#Preview {
    HStack(spacing: 20) {
        VStack {
            StatusDot()
            Text("Idle").font(.caption2)
        }
        VStack {
            UnreadDot()
            Text("Unread").font(.caption2)
        }
        VStack {
            StreamingDot()
            Text("Streaming").font(.caption2)
        }
    }
    .padding()
    .preferredColorScheme(.dark)
}

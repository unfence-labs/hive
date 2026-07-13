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
    @State private var pinging = false
    private let color = Color.accentColor

    init(size: CGFloat = 8) {
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(color)
                .frame(width: size, height: size)
                .scaleEffect(reduceMotion ? 1.6 : (pinging ? 2 : 1))
                .opacity(reduceMotion ? 0.28 : (pinging ? 0 : 0.7))
                .animation(
                    reduceMotion ? nil : .easeOut(duration: 1).repeatForever(autoreverses: false),
                    value: pinging
                )
            Circle()
                .fill(color)
                .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
        .onAppear { pinging = true }
        .onDisappear { pinging = false }
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

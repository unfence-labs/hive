import SwiftUI

/// Idle workspace indicator — neutral gray dot.
struct StatusDot: View {
    var body: some View {
        Circle()
            .fill(WhisperColor.textMuted)
            .frame(width: 6, height: 6)
    }
}

/// Unread activity indicator using the user's selected accent color.
struct UnreadDot: View {
    let size: CGFloat
    let shadowRadius: CGFloat

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
                withAnimation(.spring(duration: 0.4, bounce: 0.3)) {
                    appeared = true
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
            AgentActivityIndicator(dotSize: 3, spacing: 1.5)
            Text("Streaming").font(.caption2)
        }
    }
    .padding()
    .preferredColorScheme(.dark)
}

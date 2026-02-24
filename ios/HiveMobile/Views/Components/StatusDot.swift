import SwiftUI

/// Idle workspace indicator — neutral gray dot.
struct StatusDot: View {
    var body: some View {
        Circle()
            .fill(WhisperColor.textMuted)
            .frame(width: 6, height: 6)
    }
}

/// Turn-completed indicator — green dot with glow and spring entrance.
struct CompletedDot: View {
    @State private var appeared = false

    var body: some View {
        Circle()
            .fill(.green)
            .frame(width: 8, height: 8)
            .shadow(color: .green.opacity(appeared ? 0.5 : 0), radius: 6)
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
            CompletedDot()
            Text("Completed").font(.caption2)
        }
        VStack {
            AgentActivityIndicator(dotSize: 3, spacing: 1.5)
            Text("Streaming").font(.caption2)
        }
    }
    .padding()
    .preferredColorScheme(.dark)
}

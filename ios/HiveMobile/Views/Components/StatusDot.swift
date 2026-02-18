import SwiftUI

struct StatusDot: View {
    var isStreaming: Bool = false

    var body: some View {
        Circle()
            .fill(isStreaming ? .white : .green)
            .frame(width: 8, height: 8)
            .shadow(
                color: isStreaming ? .white.opacity(0.5) : .green.opacity(0.5),
                radius: 4
            )
    }
}

#Preview {
    HStack(spacing: 20) {
        StatusDot(isStreaming: false)
        StatusDot(isStreaming: true)
    }
    .padding()
    .preferredColorScheme(.dark)
}

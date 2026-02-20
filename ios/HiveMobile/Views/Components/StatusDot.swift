import SwiftUI

struct StatusDot: View {
    var isStreaming: Bool = false

    var body: some View {
        Circle()
            .fill(isStreaming ? .white : .green)
            .frame(width: 8, height: 8)
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

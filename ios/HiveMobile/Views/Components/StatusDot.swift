import SwiftUI

struct StatusDot: View {
    let status: WorkspaceStatus

    var body: some View {
        Circle()
            .fill(status == .busy ? Color.accentColor : .green)
            .frame(width: 8, height: 8)
            .shadow(
                color: status == .busy ? .accentColor.opacity(0.5) : .green.opacity(0.5),
                radius: 4
            )
    }
}

#Preview {
    HStack(spacing: 20) {
        StatusDot(status: .idle)
        StatusDot(status: .busy)
    }
    .padding()
    .preferredColorScheme(.dark)
}

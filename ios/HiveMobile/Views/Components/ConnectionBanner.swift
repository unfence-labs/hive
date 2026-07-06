import SwiftUI

struct ConnectionBanner: View {
    let monitor: HubStatusMonitor

    var body: some View {
        Group {
            switch monitor.connectionState {
            case .connected:
                EmptyView()
            case .connecting:
                capsule(text: "Connecting…", color: .orange.opacity(0.9))
            case .disconnected:
                Button {
                    monitor.reconnectNow()
                } label: {
                    capsule(text: "Disconnected. Tap to reconnect", color: .red.opacity(0.85))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Reconnects to the server.")
            }
        }
        .padding(.top, 8)
        .transition(.move(edge: .top))
        .animation(.default, value: monitor.connectionState)
    }

    private func capsule(text: String, color: Color) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(color, in: Capsule())
    }
}

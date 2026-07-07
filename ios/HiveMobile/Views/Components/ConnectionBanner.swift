import SwiftUI

struct ConnectionBanner: View {
    let monitor: HubStatusMonitor
    @State private var showDisconnected = false

    var body: some View {
        Group {
            if showDisconnected, monitor.hasEverConnected, monitor.connectionState != .connected {
                Button {
                    monitor.reconnectNow()
                } label: {
                    capsule(text: "Disconnected. Tap to reconnect", color: .red.opacity(0.85))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Reconnects to the server.")
                .padding(.vertical, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: showDisconnected)
        .task(id: monitor.connectionState == .connected) {
            guard monitor.connectionState != .connected else {
                showDisconnected = false
                return
            }
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled {
                showDisconnected = true
            }
        }
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

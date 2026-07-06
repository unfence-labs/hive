import SwiftUI

struct ConnectionBanner: View {
    let monitor: HubStatusMonitor
    @State private var showConnecting = false

    var body: some View {
        Group {
            if monitor.connectionState == .disconnected {
                Button {
                    monitor.reconnectNow()
                } label: {
                    capsule(text: "Disconnected. Tap to reconnect", color: .red.opacity(0.85))
                }
                .buttonStyle(.plain)
                .accessibilityHint("Reconnects to the server.")
                .padding(.vertical, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
            } else if monitor.connectionState == .connecting, showConnecting {
                capsule(text: "Connecting…", color: .orange.opacity(0.9))
                    .padding(.vertical, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: monitor.connectionState)
        .animation(.default, value: showConnecting)
        .task(id: monitor.connectionState) {
            guard monitor.connectionState == .connecting else {
                showConnecting = false
                return
            }
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled {
                showConnecting = true
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

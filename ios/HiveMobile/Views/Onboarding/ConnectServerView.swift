import SwiftUI

/// Onboarding connect screen: the same host/port/token flow as Settings, but
/// styled to match the welcome screen. Connection logic is unchanged; on
/// success it plays a checkmark beat, then hands control back to the app.
struct ConnectServerView: View {
    let onConnect: (ServerConnection) async -> Bool
    let onComplete: () -> Void

    private enum ConnectState { case idle, connecting, success }
    private enum Field: Hashable { case host, port, token }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var host = ""
    @State private var port = String(ServerConnectionStore.defaultPort)
    @State private var token = ""
    @State private var state: ConnectState = .idle
    @State private var connectionFailed = false
    @State private var failCount = 0
    @FocusState private var focusedField: Field?

    private var candidate: ServerConnection? {
        ServerConnection(host: host, port: port, authToken: token)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Connect")
                    .font(.system(size: 34, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(WhisperColor.text)
                Text("Your device must be connected to the server’s private network.")
                    .font(.subheadline)
                    .foregroundStyle(WhisperColor.textSecondary)
                    .padding(.top, 8)
                fieldCard
                    .padding(.top, HiveSpacing.xl)
                    .modifier(ShakeEffect(animatableData: CGFloat(failCount)))
                if connectionFailed {
                    Text("Connection failed")
                        .font(.subheadline)
                        .foregroundStyle(WhisperColor.danger)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, HiveSpacing.md)
        }
        .scrollDismissesKeyboard(.interactively)
        .hiveScreenBackground()
        .safeAreaInset(edge: .bottom) {
            connectButton
                .padding(.horizontal, 20)
                .padding(.bottom, 14)
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(state != .idle)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
    }

    private var fieldCard: some View {
        VStack(spacing: 0) {
            fieldRow("Host") {
                TextField("hostname or IP", text: $host)
                    .focused($focusedField, equals: .host)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            rowDivider
            fieldRow("Port") {
                TextField("port", text: $port)
                    .focused($focusedField, equals: .port)
                    .keyboardType(.numberPad)
            }
            rowDivider
            fieldRow("Token") {
                SecureField("auth token", text: $token)
                    .focused($focusedField, equals: .token)
            }
        }
        .glassCard(cornerRadius: 16)
    }

    private func fieldRow(_ label: String, @ViewBuilder field: () -> some View) -> some View {
        HStack(spacing: HiveSpacing.lg) {
            Text(label)
                .foregroundStyle(WhisperColor.text)
            field()
                .multilineTextAlignment(.trailing)
        }
        .frame(minHeight: 50)
        .padding(.horizontal, HiveSpacing.lg)
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(WhisperColor.separator)
            .frame(height: 0.5)
            .padding(.leading, HiveSpacing.lg)
    }

    private var connectButton: some View {
        Button(action: connect) {
            HStack(spacing: HiveSpacing.sm) {
                switch state {
                case .idle:
                    Text("Connect")
                case .connecting:
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                    Text("Connecting…")
                case .success:
                    Image(systemName: "checkmark")
                        .fontWeight(.bold)
                }
            }
            .onboardingCTA(enabled: candidate != nil || state != .idle)
        }
        .buttonStyle(.plain)
        .disabled(candidate == nil || state != .idle)
    }

    private func connect() {
        guard let candidate else { return }
        focusedField = nil
        withAnimation(.easeInOut(duration: 0.2)) { connectionFailed = false }
        state = .connecting
        Task {
            let connected = await onConnect(candidate)
            if connected {
                state = .success
                Haptics.notify(.success)
                try? await Task.sleep(for: .milliseconds(450))
                onComplete()
            } else {
                state = .idle
                Haptics.notify(.error)
                withAnimation(.easeInOut(duration: 0.2)) { connectionFailed = true }
                if !reduceMotion {
                    withAnimation(.linear(duration: 0.45)) { failCount += 1 }
                }
            }
        }
    }
}

/// Horizontal shake, three full cycles; lands back at rest for whole values.
private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(
            translationX: -5 * sin(animatableData * 3 * 2 * .pi),
            y: 0
        ))
    }
}

#Preview {
    NavigationStack {
        ConnectServerView(onConnect: { _ in false }, onComplete: {})
    }
    .preferredColorScheme(.dark)
}

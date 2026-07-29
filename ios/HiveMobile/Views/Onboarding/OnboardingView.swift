import SwiftUI

/// First-run funnel shown when no server has been configured yet. Guides the user
/// through entering their Hive server address and verifies reachability before
/// dismissing.
struct OnboardingView: View {
    let onDone: () -> Void

    @AppStorage("serverHost") private var host = ""
    @AppStorage("serverPort") private var port = ServerEndpoint.defaultPort
    @AppStorage("authToken") private var token = ""
    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId

    @FocusState private var focused: Field?
    @State private var phase: Phase = .idle

    private enum Field: Hashable { case host, port, token }
    private enum Phase: Equatable { case idle, testing, success, failed }

    private var accent: Color { AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color }

    private var canConnect: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty
            && !port.trimmingCharacters(in: .whitespaces).isEmpty
            && phase != .testing
    }

    var body: some View {
        NavigationStack {
            Form {
                headerSection
                serverSection
                connectionFailureSection
            }
            .scrollContentBackground(.hidden)
            .hiveScreenBackground()
            .scrollDismissesKeyboard(.interactively)
            .onTapGesture { focused = nil }
            .safeAreaInset(edge: .bottom) { connectBar }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Set up later", action: onDone)
                        .foregroundStyle(WhisperColor.textSecondary)
                }
            }
        }
    }

    private var headerSection: some View {
        Section {
            VStack(spacing: HiveSpacing.sm) {
                Image(systemName: "sparkles")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(accent)
                Text("Connect to your Hive server")
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
                Text("Enter the address and credentials for your Hive server.")
                    .font(.subheadline)
                    .foregroundStyle(WhisperColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, HiveSpacing.md)
        }
        .listRowBackground(Color.clear)
    }

    private var serverSection: some View {
        Section("Server") {
            transportSecurityWarning
            LabeledContent("Host") {
                TextField("hostname or IP", text: $host)
                    .focused($focused, equals: .host)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Port") {
                TextField("port", text: $port)
                    .focused($focused, equals: .port)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Token") {
                SecureField("optional", text: $token)
                    .focused($focused, equals: .token)
                    .multilineTextAlignment(.trailing)
            }
        }
        .listRowBackground(WhisperColor.surfaceRaised)
    }

    private var transportSecurityWarning: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.xs) {
            Text("Private network required")
                .font(.footnote.weight(.medium))
                .foregroundStyle(WhisperColor.danger)
            Text(
                "HTTPS is not supported yet. Connect through an encrypted private network such as Tailscale, WireGuard, or another VPN. Never use a public address."
            )
            .font(.caption)
            .foregroundStyle(WhisperColor.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var connectionFailureSection: some View {
        if phase == .failed {
            Section {
                Label(
                    "Couldn't reach \(host):\(port). Check the address and credentials, then try again.",
                    systemImage: "wifi.slash"
                )
                .font(.caption)
                .foregroundStyle(.red)
            }
            .listRowBackground(WhisperColor.surfaceRaised)
        }
    }

    private var connectBar: some View {
        VStack(spacing: 0) {
            Divider().overlay(WhisperColor.separator)
            Button {
                Task { await testAndConnect() }
            } label: {
                HStack(spacing: HiveSpacing.sm) {
                    if phase == .testing {
                        ProgressView().controlSize(.small).tint(.white)
                    } else if phase == .success {
                        Image(systemName: "checkmark.circle.fill")
                    }
                    Text(connectLabel)
                }
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(accent)
                )
                .opacity(canConnect ? 1 : 0.4)
            }
            .buttonStyle(.plain)
            .disabled(!canConnect)
            .padding(.horizontal, HiveSpacing.lg)
            .padding(.vertical, HiveSpacing.md)
        }
        .background(WhisperColor.appBackground)
    }

    private var connectLabel: String {
        switch phase {
        case .testing: "Connecting..."
        case .success: "Connected"
        default: "Connect"
        }
    }

    private func testAndConnect() async {
        focused = nil
        phase = .testing
        HiveHTTP.clearCache()
        if await runHealthCheck() {
            phase = .success
            try? await Task.sleep(for: .milliseconds(500))
            onDone()
        } else {
            phase = .failed
        }
    }

    private func runHealthCheck() async -> Bool {
        await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
            group.addTask { (try? await APIClient().checkHealth()) ?? false }
            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }
            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }
    }
}

#Preview {
    OnboardingView(onDone: {})
        .preferredColorScheme(.dark)
}

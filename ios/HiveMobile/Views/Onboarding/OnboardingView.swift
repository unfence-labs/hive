import SwiftUI

/// First-run funnel shown when no server has been configured yet. Guides the user
/// through entering their Hive server address, hints at VPN/Tailscale state, and
/// verifies reachability before dismissing.
struct OnboardingView: View {
    let onDone: () -> Void

    @AppStorage("serverHost") private var host = ""
    @AppStorage("serverPort") private var port = "3000"
    @AppStorage("authToken") private var token = ""
    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId

    @FocusState private var focused: Field?
    @State private var phase: Phase = .idle
    @State private var vpnActive = NetworkEnvironment.isVPNActive()
    @State private var vpnRefreshSpin = 0.0

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
                statusSection
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
                Text("Enter your server address to get started. If it's behind Tailscale, make sure the VPN is connected first.")
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

    private var statusSection: some View {
        Section {
            HStack(spacing: HiveSpacing.sm) {
                Image(systemName: vpnActive ? "lock.shield.fill" : "lock.shield")
                    .font(.title3)
                    .foregroundStyle(vpnActive ? WhisperColor.success : WhisperColor.textMuted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(vpnActive ? "VPN active" : "No VPN detected")
                        .font(.subheadline.weight(.medium))
                    Text(vpnActive
                        ? "A tunnel is up — good if your server needs Tailscale."
                        : "If your server is behind Tailscale, connect the VPN first.")
                        .font(.caption)
                        .foregroundStyle(WhisperColor.textSecondary)
                }
                Spacer()
                Button {
                    withAnimation(.snappy(duration: 0.5)) { vpnRefreshSpin += 360 }
                    vpnActive = NetworkEnvironment.isVPNActive()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .rotationEffect(.degrees(vpnRefreshSpin))
                }
                .buttonStyle(.plain)
                .foregroundStyle(WhisperColor.textSecondary)
                .accessibilityLabel("Re-check VPN")
            }

            if phase == .failed {
                Label(
                    "Couldn't reach \(host):\(port). Check the address\(vpnActive ? "" : " and your VPN"), then try again.",
                    systemImage: "wifi.slash"
                )
                .font(.caption)
                .foregroundStyle(.red)
            }
        }
        .listRowBackground(WhisperColor.surfaceRaised)
    }

    private var connectBar: some View {
        Button {
            Task { await testAndConnect() }
        } label: {
            HStack(spacing: HiveSpacing.sm) {
                if phase == .testing {
                    ProgressView().controlSize(.small).tint(.white)
                } else if phase == .success {
                    Image(systemName: "checkmark.circle.fill")
                }
                Text(connectLabel).fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, HiveSpacing.xs)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(!canConnect)
        .padding(.horizontal, HiveSpacing.lg)
        .padding(.top, HiveSpacing.sm)
        .padding(.bottom, HiveSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(.bar)
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
        vpnActive = NetworkEnvironment.isVPNActive()
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

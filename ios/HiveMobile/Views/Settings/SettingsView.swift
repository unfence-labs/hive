import SwiftUI

struct SettingsView: View {
    @AppStorage("serverHost") private var host = "localhost"
    @AppStorage("serverPort") private var port = "3000"
    @AppStorage("authToken") private var token = ""

    @State private var healthStatus: HealthStatus = .unknown
    @State private var isChecking = false

    var body: some View {
        NavigationStack {
            Form {
                connectionSection
                healthSection
            }
            .navigationTitle("Settings")
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section("Connection") {
            LabeledContent("Host") {
                TextField("hostname or IP", text: $host)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Port") {
                TextField("port", text: $port)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Token") {
                SecureField("auth token", text: $token)
                    .multilineTextAlignment(.trailing)
            }
        }
    }

    // MARK: - Health Check

    private var healthSection: some View {
        Section("Server") {
            HStack {
                Label {
                    Text("Status")
                } icon: {
                    Circle()
                        .fill(healthStatus.color)
                        .frame(width: 8, height: 8)
                }

                Spacer()

                Text(healthStatus.label)
                    .foregroundStyle(.secondary)
            }

            Button {
                checkHealth()
            } label: {
                HStack {
                    Text("Test Connection")
                    if isChecking {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(isChecking)
        }
    }

    private func checkHealth() {
        isChecking = true
        healthStatus = .checking
        Task {
            do {
                let ok = try await APIClient().checkHealth()
                healthStatus = ok ? .connected : .error("Unexpected response")
            } catch {
                healthStatus = .error(error.localizedDescription)
            }
            isChecking = false
        }
    }
}

// MARK: - Health Status

private enum HealthStatus {
    case unknown
    case checking
    case connected
    case error(String)

    var label: String {
        switch self {
        case .unknown: "Not checked"
        case .checking: "Checking..."
        case .connected: "Connected"
        case .error(let msg): msg
        }
    }

    var color: Color {
        switch self {
        case .unknown: .gray
        case .checking: .yellow
        case .connected: .green
        case .error: .red
        }
    }
}

#Preview {
    SettingsView()
        .preferredColorScheme(.dark)
}

import SwiftUI

struct SettingsView: View {
    @AppStorage("serverHost") private var host = "localhost"
    @AppStorage("serverPort") private var port = "3000"
    @AppStorage("authToken") private var token = ""
    @AppStorage("hiveAccent") private var accentId = AccentOption.defaultId
    @AppStorage("hiveThemeMode") private var themeModeId = HiveThemeMode.system.rawValue

    @FocusState private var focusedField: Field?
    @State private var healthStatus: HealthStatus = .disconnected
    @State private var pollingTask: Task<Void, Never>?
    @State private var debouncedCheckTask: Task<Void, Never>?
    private let accentColumns = [
        GridItem(.adaptive(minimum: 54), spacing: HiveSpacing.md)
    ]

    private enum Field: Hashable {
        case host, port, token
    }

    private var selectedAccent: Color {
        AccentOption(rawValue: accentId)?.color ?? AccentOption.violet.color
    }

    var body: some View {
        Form {
            appearanceSection
            connectionSection
        }
        .scrollContentBackground(.hidden)
        .hiveScreenBackground()
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture { focusedField = nil }
        .onAppear { startConnectionPolling() }
        .onDisappear { stopConnectionPolling() }
        .onChange(of: host) { _, _ in scheduleConnectionCheck() }
        .onChange(of: port) { _, _ in scheduleConnectionCheck() }
        .onChange(of: token) { _, _ in scheduleConnectionCheck() }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        Section("Appearance") {
            VStack(alignment: .leading, spacing: HiveSpacing.md) {
                Text("Theme")
                    .font(.subheadline)
                    .foregroundStyle(WhisperColor.textSecondary)

                HStack(spacing: HiveSpacing.sm) {
                    ForEach(HiveThemeMode.allCases) { mode in
                        let isSelected = mode.rawValue == themeModeId
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                themeModeId = mode.rawValue
                            }
                        } label: {
                            VStack(spacing: HiveSpacing.xs) {
                                Image(systemName: mode.systemImage)
                                    .font(.system(size: 18, weight: .medium))
                                Text(mode.label)
                                    .font(.caption)
                                    .fontWeight(.medium)
                            }
                            .foregroundStyle(isSelected ? selectedAccent : WhisperColor.textSecondary)
                            .frame(maxWidth: .infinity, minHeight: 62)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(isSelected ? selectedAccent.opacity(0.12) : WhisperColor.surfaceSubtle)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(isSelected ? selectedAccent.opacity(0.4) : WhisperColor.borderSubtle, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Theme: \(mode.label)")
                        .accessibilityValue(isSelected ? "Selected" : "")
                    }
                }

                Divider()
                    .padding(.vertical, HiveSpacing.xs)

                Text("Accent Color")
                    .font(.subheadline)
                    .foregroundStyle(WhisperColor.textSecondary)

                LazyVGrid(columns: accentColumns, alignment: .leading, spacing: HiveSpacing.md) {
                    ForEach(AccentOption.allCases) { option in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                accentId = option.rawValue
                            }
                        } label: {
                            VStack(spacing: 6) {
                                ZStack {
                                    Circle()
                                        .fill(option.color)
                                        .frame(width: 36, height: 36)

                                    if option.rawValue == accentId {
                                        Image(systemName: "checkmark")
                                            .font(.caption.bold())
                                            .foregroundStyle(.white)
                                    }

                                    if option.rawValue == accentId {
                                        Circle()
                                            .strokeBorder(option.color, lineWidth: 1.5)
                                            .frame(width: 44, height: 44)
                                    }
                                }
                                .shadow(
                                    color: option.rawValue == accentId ? option.color.opacity(0.4) : .clear,
                                    radius: 8
                                )

                                Text(option.label)
                                    .font(.caption2)
                                    .foregroundStyle(option.rawValue == accentId ? WhisperColor.text : WhisperColor.textSecondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.vertical, HiveSpacing.xs)
        }
        .listRowBackground(WhisperColor.surfaceRaised)
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            LabeledContent("Host") {
                TextField("hostname or IP", text: $host)
                    .focused($focusedField, equals: .host)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Port") {
                TextField("port", text: $port)
                    .focused($focusedField, equals: .port)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Token") {
                SecureField("auth token", text: $token)
                    .focused($focusedField, equals: .token)
                    .multilineTextAlignment(.trailing)
            }
        } header: {
            connectionHeader
        }
        .listRowBackground(WhisperColor.surfaceRaised)
    }

    private var connectionHeader: some View {
        HStack {
            Text("Connection")
            Spacer()
            Text(healthStatus.label)
                .font(.caption2)
                .foregroundStyle(healthStatus.color)
                .accessibilityLabel("Connection status")
                .accessibilityValue(healthStatus.accessibilityValue)
        }
    }

    private func startConnectionPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                await checkHealth()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    private func stopConnectionPolling() {
        pollingTask?.cancel()
        pollingTask = nil
        debouncedCheckTask?.cancel()
        debouncedCheckTask = nil
    }

    private func scheduleConnectionCheck() {
        debouncedCheckTask?.cancel()
        debouncedCheckTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await checkHealth()
        }
    }

    @MainActor
    private func checkHealth() async {
        let isConnected = await runHealthCheck()
        guard !Task.isCancelled else { return }
        healthStatus = isConnected ? .connected : .disconnected
    }

    private func runHealthCheck() async -> Bool {
        await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
            group.addTask {
                do {
                    return try await APIClient().checkHealth()
                } catch {
                    return false
                }
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(4))
                return false
            }

            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }
    }
}

// MARK: - Health Status

private enum HealthStatus {
    case connected
    case disconnected

    var color: Color {
        switch self {
        case .connected: .green
        case .disconnected: .red
        }
    }

    var label: String {
        switch self {
        case .connected: "Connected"
        case .disconnected: "Disconnected"
        }
    }

    var accessibilityValue: String { label }
}

#Preview {
    NavigationStack {
        SettingsView()
    }
    .preferredColorScheme(.dark)
}

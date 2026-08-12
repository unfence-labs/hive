import SwiftUI

struct OnboardingView: View {
    let onConnect: (ServerConnection) async -> Bool

    @State private var host = ""
    @State private var port = String(ServerConnectionStore.defaultPort)
    @State private var token = ""
    @State private var isConnecting = false
    @State private var connectionFailed = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case host, port, token
    }

    private var candidate: ServerConnection? {
        ServerConnection(host: host, port: port, authToken: token)
    }

    var body: some View {
        NavigationStack {
            Form {
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
                    Text("Connect to Hive")
                } footer: {
                    Text("Your device must be connected to the server’s private network.")
                }
                .listRowBackground(WhisperColor.surfaceRaised)

                if connectionFailed {
                    Section {
                        Text("Connection failed")
                            .foregroundStyle(WhisperColor.danger)
                    }
                    .listRowBackground(WhisperColor.surfaceRaised)
                }
            }
            .scrollContentBackground(.hidden)
            .hiveScreenBackground()
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(TapGesture().onEnded { focusedField = nil })
            .navigationTitle("Connect to Hive")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                Button {
                    connect()
                } label: {
                    HStack(spacing: HiveSpacing.sm) {
                        if isConnecting {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(isConnecting ? "Connecting…" : "Connect")
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(Color.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(candidate == nil || isConnecting)
                .opacity(candidate == nil || isConnecting ? 0.4 : 1)
                .padding(HiveSpacing.lg)
                .background(WhisperColor.appBackground)
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focusedField = nil }
                }
            }
        }
    }

    private func connect() {
        guard let candidate else { return }
        focusedField = nil
        connectionFailed = false
        isConnecting = true
        Task {
            let connected = await onConnect(candidate)
            isConnecting = false
            connectionFailed = !connected
        }
    }
}

#Preview {
    OnboardingView(onConnect: { _ in false })
        .preferredColorScheme(.dark)
}

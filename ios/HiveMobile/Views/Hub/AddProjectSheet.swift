import SwiftUI

enum AddProjectMode: String, CaseIterable {
    case clone = "Clone existing"
    case create = "Create new"
}

struct AddProjectSheet: View {
    @Environment(\.dismiss) private var dismiss
    let api: APIClient
    let onClone: (String) async -> String?
    let onCreate: (_ name: String, _ visibility: String?) async -> String?

    @State private var mode: AddProjectMode = .clone

    // Clone state
    @State private var url = ""

    // Create state
    @State private var name = ""
    @State private var visibility = "private"
    @State private var accountStatus: AccountStatusResponse?
    @State private var loadingAccount = false

    @State private var isSubmitting = false
    @State private var submitError: String?

    private var ghConnected: Bool {
        accountStatus?.authenticated == true
    }

    private var canSubmit: Bool {
        switch mode {
        case .clone:
            return !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .create:
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return !trimmed.isEmpty && isValidRepoName(trimmed)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: HiveSpacing.xl) {
                Picker("", selection: $mode) {
                    ForEach(AddProjectMode.allCases, id: \.self) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(isSubmitting)

                Group {
                    if mode == .clone {
                        cloneForm
                    } else {
                        createForm
                    }
                }
                .disabled(isSubmitting)

                Spacer()

                if let submitError {
                    Text(submitError)
                        .font(.footnote)
                        .foregroundStyle(WhisperColor.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    submit()
                } label: {
                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(mode == .clone ? "Add Project" : "Create Project")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.glassProminent)
                .disabled(!canSubmit || isSubmitting)
                .frame(maxWidth: .infinity)
            }
            .padding()
            .hiveScreenBackground()
            .navigationTitle(mode == .clone ? "Add Project" : "Create Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(WhisperColor.appBackground, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSubmitting)
        .onChange(of: mode) { _, newMode in
            if newMode == .create && accountStatus == nil {
                checkAccountStatus()
            }
        }
    }

    // MARK: - Clone form

    private var cloneForm: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.md) {
            Text("Enter the Git repository URL to clone into Hive.")
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextField("https://github.com/user/repo.git", text: $url)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.go)
                .onSubmit { if canSubmit { submit() } }
        }
    }

    // MARK: - Create form

    private var createForm: some View {
        VStack(alignment: .leading, spacing: HiveSpacing.lg) {
            Text("Create a new Git repository and start working.")
                .font(.subheadline)
                .foregroundStyle(WhisperColor.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                Text("Repository name")
                    .font(.caption)
                    .foregroundStyle(WhisperColor.textSecondary)
                TextField("my-new-project", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { if canSubmit { submit() } }
            }

            if ghConnected {
                VStack(alignment: .leading, spacing: HiveSpacing.xs) {
                    Text("Visibility")
                        .font(.caption)
                        .foregroundStyle(WhisperColor.textSecondary)
                    Picker("", selection: $visibility) {
                        Text("Private").tag("private")
                        Text("Public").tag("public")
                    }
                    .pickerStyle(.segmented)
                }
            }

            // GitHub status indicator
            Group {
                if loadingAccount {
                    Text("Checking GitHub connection…")
                        .font(.caption)
                        .foregroundStyle(WhisperColor.textSecondary)
                } else if ghConnected {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(WhisperColor.success)
                            .frame(width: 6, height: 6)
                        Text("Connected as @\(accountStatus?.user?.login ?? "")")
                            .font(.caption)
                            .foregroundStyle(WhisperColor.textSecondary)
                    }
                } else if accountStatus != nil {
                    Text("GitHub not connected — will create local only")
                        .font(.caption)
                        .foregroundStyle(WhisperColor.warningForeground)
                }
            }
        }
    }

    // MARK: - Actions

    private func submit() {
        guard !isSubmitting else { return }
        isSubmitting = true
        submitError = nil
        Task {
            let error: String?
            switch mode {
            case .clone:
                error = await onClone(url.trimmingCharacters(in: .whitespacesAndNewlines))
            case .create:
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                error = await onCreate(trimmed, ghConnected ? visibility : nil)
            }
            isSubmitting = false
            if let error {
                submitError = error
            } else {
                dismiss()
            }
        }
    }

    private func checkAccountStatus() {
        guard !loadingAccount else { return }
        loadingAccount = true
        Task {
            do {
                let status = try await api.fetchAccountStatus()
                await MainActor.run {
                    accountStatus = status
                    loadingAccount = false
                }
            } catch {
                await MainActor.run { loadingAccount = false }
            }
        }
    }

    private func isValidRepoName(_ name: String) -> Bool {
        let pattern = /^[a-z0-9][a-z0-9._-]*$/
        return name.wholeMatch(of: pattern) != nil
    }
}

#Preview {
    Text("Hub")
        .sheet(isPresented: .constant(true)) {
            AddProjectSheet(api: APIClient(), onClone: { _ in nil }, onCreate: { _, _ in nil })
        }
        .preferredColorScheme(.dark)
}

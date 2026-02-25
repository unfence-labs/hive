import SwiftUI

struct AddProjectSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onSubmit: (String) -> Void

    @State private var url = ""

    private var canSubmit: Bool {
        !url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: HiveSpacing.xl) {
                Text("Enter the Git repository URL to clone into Hive.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                TextField("git@github.com:user/repo.git", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .onSubmit { if canSubmit { submit() } }

                Spacer()

                Button("Add Project") { submit() }
                    .buttonStyle(.glassProminent)
                    .disabled(!canSubmit)
                    .frame(maxWidth: .infinity)
            }
            .padding()
            .navigationTitle("Add Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    private func submit() {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
        dismiss()
    }
}

#Preview {
    Text("Hub")
        .sheet(isPresented: .constant(true)) {
            AddProjectSheet { _ in }
        }
        .preferredColorScheme(.dark)
}

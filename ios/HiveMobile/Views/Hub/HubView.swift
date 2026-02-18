import SwiftUI

struct HubView: View {
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var statusMonitor = HubStatusMonitor()

    private let api = APIClient()
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            if isLoading && projects.isEmpty {
                ProgressView()
                    .padding(.top, 80)
            } else if projects.isEmpty {
                ContentUnavailableView(
                    "No Projects",
                    systemImage: "folder",
                    description: Text("Connect to your Hive server in Settings (tap the gear icon).")
                )
                .padding(.top, 40)
            } else {
                projectGrid
            }
        }
        .scrollBounceBehavior(.always)
        .navigationTitle("Hub")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: SettingsRoute()) {
                    Image(systemName: "gear")
                }
            }
        }
        .refreshable {
            // Unstructured Task shields loadProjects() from SwiftUI prematurely
            // cancelling the .refreshable task on ScrollView (known iOS 26 regression).
            await Task { @MainActor in
                await loadProjects()
            }.value
        }
        .task { await loadProjects() }
        .onDisappear { statusMonitor.disconnectAll() }
        .overlay {
            if let errorMessage {
                errorBanner(errorMessage)
            }
        }
    }

    // MARK: - Project Grid

    private var projectGrid: some View {
        LazyVStack(alignment: .leading, spacing: HiveSpacing.xxl) {
            ForEach(projects) { project in
                projectSection(project)
            }
        }
        .padding()
    }

    private func projectSection(_ project: Project) -> some View {
        VStack(alignment: .leading, spacing: HiveSpacing.md) {
            Text(project.name)
                .font(.headline)
                .foregroundStyle(.secondary)

            if project.workspaces.isEmpty {
                Text("No active workspaces")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            } else {
                LazyVGrid(columns: columns, spacing: HiveSpacing.md) {
                    ForEach(project.workspaces) { workspace in
                        NavigationLink(value: workspace) {
                            WorkspaceCard(
                                workspace: workspace,
                                isStreaming: statusMonitor.isStreaming(workspace.id)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        VStack {
            Spacer()
            Text(message)
                .font(.footnote)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.red.opacity(0.85), in: Capsule())
                .padding(.bottom, 8)
        }
        .transition(.move(edge: .bottom))
        .animation(.default, value: errorMessage)
    }

    // MARK: - Data Loading

    private func loadProjects() async {
        isLoading = true
        errorMessage = nil
        do {
            projects = try await api.fetchProjects()
            let allWorkspaceIds = projects.flatMap(\.workspaces).map(\.id)
            statusMonitor.sync(workspaceIds: allWorkspaceIds)
        } catch is CancellationError {
            // Genuine SwiftUI task cancellation (view disappeared) — ignore
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    NavigationStack {
        HubView()
    }
    .preferredColorScheme(.dark)
}
